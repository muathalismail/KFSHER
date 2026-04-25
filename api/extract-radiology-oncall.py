"""
Vercel serverless function: Extract radiology on-call schedule using pdfplumber.
Returns structured rows with proper column alignment — handles empty cells
(None) without column drift, unlike client-side whitespace splitting.

Columns extracted:
  - 1st On-Call Resident
  - 2nd On-Call Resident
  - 3rd On-Call (General)

All other columns (Weekend X-Ray, Abdomen, Chest/MSK, Neuro, Nuclear) are
intentionally excluded per display rules.
"""
from http.server import BaseHTTPRequestHandler
import json, base64, io, re


def extract_radiology_oncall_table(pdf_bytes):
    """Extract radiology on-call schedule rows from PDF bytes.
    Returns list of dicts with date, day, 1st/2nd/3rd on-call names,
    and optional shift time range for weekend AM/PM splits.
    """
    import pdfplumber
    rows_out = []

    date_re = re.compile(r'(\d{1,2})/(\d{1,2})/(\d{4})')
    day_re = re.compile(
        r'^(Sun|Mon|Tues?|Wed|Thurs?|Fri|Sat)\w*$', re.IGNORECASE
    )
    time_re = re.compile(
        r'(\d{1,2}:\d{2}\s*[ap]m)\s*[-–]\s*(\d{1,2}:\d{2}\s*[ap]m)', re.I
    )

    # Column header patterns for dynamic detection
    COL_PATTERNS = {
        'first':  re.compile(r'1\s*st\s*on.?call', re.I),
        'second': re.compile(r'2\s*nd\s*on.?call', re.I),
        'third':  re.compile(r'3\s*rd\s*on.?call(?!.*neuro)', re.I),
    }
    # Fallback column indices (typical layout)
    FALLBACK = {'first': 2, 'second': 3, 'third': 4}

    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for page in pdf.pages:
            tables = page.extract_tables()
            if not tables:
                continue

            # Use the largest table on the page (the schedule)
            table = max(tables, key=lambda t: len(t))

            # Detect column indices from header rows
            col_map = {}
            for row in table:
                if not row:
                    continue
                cells = [(c or '').strip() for c in row]
                matched = {}
                for key, pattern in COL_PATTERNS.items():
                    for ci, cell in enumerate(cells):
                        if cell and pattern.search(cell):
                            matched[key] = ci
                            break
                if len(matched) >= 2:
                    col_map = matched
                    break
            if not col_map:
                col_map = FALLBACK

            for row in table:
                if not row:
                    continue

                # Find the date cell
                date_cell = None
                date_col = -1
                for ci, cell in enumerate(row):
                    val = (cell or '').strip()
                    if date_re.search(val):
                        date_cell = val
                        date_col = ci
                        break

                if not date_cell:
                    continue

                dm = date_re.search(date_cell)
                if not dm:
                    continue

                day_num = int(dm.group(1))
                month = int(dm.group(2))
                date_key = f'{day_num:02d}/{month:02d}'

                # Detect weekend AM/PM time range
                shift = None
                tm = time_re.search(date_cell)
                if tm:
                    start_t = tm.group(1).strip().lower()
                    end_t = tm.group(2).strip().lower()
                    if 'am' in start_t:
                        shift = 'am'
                    else:
                        shift = 'pm'

                # Detect day name
                day_name = ''
                for ci, cell in enumerate(row):
                    val = (cell or '').strip()
                    if day_re.match(val):
                        day_name = val
                        break

                def _cell(key):
                    idx = col_map.get(key)
                    if idx is not None and idx < len(row):
                        val = (row[idx] or '').strip()
                        # Skip if it looks like a header/label
                        if re.match(r'^(residents?|general|on.?call|date|day)$',
                                    val, re.I):
                            return ''
                        return val
                    return ''

                entry = {
                    'date': date_key,
                    'day': day_name,
                    'first': _cell('first'),
                    'second': _cell('second'),
                    'third': _cell('third'),
                }
                if shift:
                    entry['shift'] = shift

                # Skip rows where all on-call fields are empty
                if entry['first'] or entry['second'] or entry['third']:
                    rows_out.append(entry)

    return rows_out


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            length = int(self.headers.get('Content-Length', 0))
            body = json.loads(self.rfile.read(length))
            pdf_b64 = body.get('pdf_base64', '')
            pdf_bytes = base64.b64decode(pdf_b64)
            result = extract_radiology_oncall_table(pdf_bytes)
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps(result).encode())
        except Exception as e:
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({'error': str(e)}).encode())

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()
