"""
Vercel serverless function: Extract medicine on-call schedule using pdfplumber.
Returns structured rows with proper column alignment — handles empty cells
without column drift, unlike client-side whitespace splitting.

Columns extracted from "In House on call rota - Department of Medicine":
  - Junior Ward Day   (7:30 AM – 9:00 PM)
  - Junior Ward Night (9:00 PM – 7:30 AM)
  - Junior ER Day     (7:30 AM – 9:00 PM)
  - Junior ER Night   (9:00 PM – 7:30 AM)
  - Senior Day        (7:30 AM – 9:00 PM)
  - Senior Night      (9:00 PM – 7:30 AM)
"""
from http.server import BaseHTTPRequestHandler
import json, base64, io, re


def extract_medicine_oncall_table(pdf_bytes):
    """Extract medicine on-call schedule rows from PDF bytes.
    Returns list of dicts with date + 6 name fields.
    """
    import pdfplumber
    rows_out = []

    day_re = re.compile(
        r'(Sun|Mon|Tue|Wed|Wen|Thu|Fri|Sat)\s+(\d{1,2})/(\d{1,2})',
        re.IGNORECASE
    )

    # Column header patterns for dynamic detection
    COL_PATTERNS = {
        'jw_day':   re.compile(r'7:30\s*AM\s*[-–]\s*9:00\s*PM', re.I),
        'jw_night': re.compile(r'9:00\s*PM\s*[-–]\s*7:30\s*AM', re.I),
    }

    # Header keywords to identify column groups
    GROUP_PATTERNS = {
        'junior_ward': re.compile(r'junior\s*ward', re.I),
        'junior_er':   re.compile(r'junior\s*er', re.I),
        'senior':      re.compile(r'senior', re.I),
    }

    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for page in pdf.pages:
            tables = page.extract_tables()
            if not tables:
                continue

            # Use the largest table (the schedule)
            table = max(tables, key=lambda t: len(t))

            # Detect column indices from header rows
            # The table has: Day/Date | JW Day | JW Night | JER Day | JER Night | Sr Day | Sr Night
            # We need to find the 6 data columns
            col_map = None

            for ri, row in enumerate(table):
                if not row:
                    continue
                cells = [(c or '').strip() for c in row]
                joined = ' '.join(cells).lower()

                # Look for a row that mentions both "junior ward" and "senior"
                has_jw = any(GROUP_PATTERNS['junior_ward'].search(c) for c in cells if c)
                has_sr = any(GROUP_PATTERNS['senior'].search(c) for c in cells if c)

                if has_jw and has_sr:
                    # Found the header row — detect column positions
                    # Find the group boundaries
                    jw_cols = []
                    jer_cols = []
                    sr_cols = []
                    current_group = None

                    for ci, cell in enumerate(cells):
                        if GROUP_PATTERNS['junior_ward'].search(cell or ''):
                            current_group = 'jw'
                        elif GROUP_PATTERNS['junior_er'].search(cell or ''):
                            current_group = 'jer'
                        elif GROUP_PATTERNS['senior'].search(cell or ''):
                            current_group = 'sr'

                    # Now check the NEXT row for time range sub-headers
                    if ri + 1 < len(table):
                        subrow = table[ri + 1]
                        if subrow:
                            subcells = [(c or '').strip() for c in subrow]
                            time_cols = []
                            for ci, cell in enumerate(subcells):
                                if re.search(r'\d:\d{2}\s*(AM|PM)', cell or '', re.I):
                                    time_cols.append(ci)

                            if len(time_cols) >= 6:
                                col_map = {
                                    'jw_day': time_cols[0],
                                    'jw_night': time_cols[1],
                                    'jer_day': time_cols[2],
                                    'jer_night': time_cols[3],
                                    'sr_day': time_cols[4],
                                    'sr_night': time_cols[5],
                                }
                    break

            # Fallback: assume standard positions if header detection failed
            if not col_map:
                # Try a simpler approach: find a data row pattern and work backwards
                # Typically: col 0 = Day/Date, cols 1-6 = the 6 name slots
                # But some tables have merged header cells, so cols might shift
                # Use a safe fallback based on common layouts
                for row in table:
                    if not row:
                        continue
                    cells = [(c or '').strip() for c in row]
                    dm = None
                    date_col = -1
                    for ci, cell in enumerate(cells):
                        dm = day_re.search(cell or '')
                        if dm:
                            date_col = ci
                            break
                    if dm and date_col >= 0:
                        # Count how many columns after the date have data
                        data_cols = [ci for ci in range(date_col + 1, len(cells))
                                     if cells[ci] and not day_re.search(cells[ci])]
                        if len(data_cols) >= 6:
                            col_map = {
                                'jw_day': data_cols[0],
                                'jw_night': data_cols[1],
                                'jer_day': data_cols[2],
                                'jer_night': data_cols[3],
                                'sr_day': data_cols[4],
                                'sr_night': data_cols[5],
                            }
                            break

            if not col_map:
                # Last resort: fixed positions
                col_map = {
                    'jw_day': 1, 'jw_night': 2,
                    'jer_day': 3, 'jer_night': 4,
                    'sr_day': 5, 'sr_night': 6,
                }

            # Extract data rows
            for row in table:
                if not row:
                    continue

                # Find date in the row
                date_cell = None
                for ci, cell in enumerate(row):
                    val = (cell or '').strip()
                    dm = day_re.search(val)
                    if dm:
                        date_cell = dm
                        break

                if not date_cell:
                    continue

                day_num = int(date_cell.group(2))
                month = int(date_cell.group(3))
                date_key = f'{day_num:02d}/{month:02d}'
                day_name = date_cell.group(1)

                def _cell(key):
                    idx = col_map.get(key)
                    if idx is not None and idx < len(row):
                        val = (row[idx] or '').strip()
                        # Skip headers/labels
                        if re.match(
                            r'^(junior|senior|ward|er|day|night|fellow|consultant|7:30|9:00|date)',
                            val, re.I
                        ):
                            return ''
                        return val
                    return ''

                entry = {
                    'date': date_key,
                    'day': day_name,
                    'jw_day': _cell('jw_day'),
                    'jw_night': _cell('jw_night'),
                    'jer_day': _cell('jer_day'),
                    'jer_night': _cell('jer_night'),
                    'sr_day': _cell('sr_day'),
                    'sr_night': _cell('sr_night'),
                }

                # Skip rows where all fields are empty
                if any(entry[k] for k in ['jw_day', 'jw_night', 'jer_day', 'jer_night', 'sr_day', 'sr_night']):
                    rows_out.append(entry)

    return rows_out


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            length = int(self.headers.get('Content-Length', 0))
            body = json.loads(self.rfile.read(length))
            pdf_b64 = body.get('pdf_base64', '')
            pdf_bytes = base64.b64decode(pdf_b64)
            result = extract_medicine_oncall_table(pdf_bytes)
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
