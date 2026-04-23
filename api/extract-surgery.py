"""
Vercel serverless function: Extract surgery schedule table using pdfplumber.
Returns the 4 required columns (Jr ER, Sr ER, GS Associate, GS Consultant)
from the surgery on-duty PDF, using pdfplumber's table extraction which
correctly handles empty cells (None) without column drift.
"""
from http.server import BaseHTTPRequestHandler
import json, base64, io, re

def extract_surgery_table(pdf_bytes):
    """Extract surgery schedule rows from PDF bytes.
    Returns list of {date, jr_er, sr_er, gs_assoc, gs_consult} dicts.
    Detects column positions dynamically from the header row.
    """
    import pdfplumber
    rows_out = []
    day_re = re.compile(r'^(SUN|MON|TUE|WED|THU|FRI|SAT)$', re.IGNORECASE)

    # Column header patterns — matched case-insensitively against header cells
    COL_PATTERNS = {
        'jr_er':      re.compile(r'jr\.?\s*er|junior\s*er', re.I),
        'sr_er':      re.compile(r'sr\.?\s*er|senior\s*er', re.I),
        'gs_assoc':   re.compile(r'gs\s*assoc|associate', re.I),
        'gs_consult': re.compile(r'gs\s*consult|consultant', re.I),
    }
    # Fallback indices if no header detected (legacy layout)
    FALLBACK = {'jr_er': 2, 'sr_er': 4, 'gs_assoc': 6, 'gs_consult': 7}

    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for page in pdf.pages:
            tables = page.extract_tables()
            if not tables:
                continue
            table = tables[0]  # main schedule table

            # Detect column indices from header row
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
                if len(matched) >= 3:  # found at least 3 of 4 target columns
                    col_map = matched
                    break
            if not col_map:
                col_map = FALLBACK

            for row in table:
                if not row or not row[0]:
                    continue
                day = (row[0] or '').strip()
                if not day_re.match(day):
                    continue
                date_str = (row[1] or '').strip()
                if not date_str:
                    continue
                def _cell(key):
                    idx = col_map.get(key)
                    if idx is not None and idx < len(row):
                        return (row[idx] or '').strip()
                    return ''
                rows_out.append({
                    'date': date_str,
                    'jr_er': _cell('jr_er'),
                    'sr_er': _cell('sr_er'),
                    'gs_assoc': _cell('gs_assoc'),
                    'gs_consult': _cell('gs_consult'),
                })
    return rows_out


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            length = int(self.headers.get('Content-Length', 0))
            body = json.loads(self.rfile.read(length))
            pdf_b64 = body.get('pdf_base64', '')
            pdf_bytes = base64.b64decode(pdf_b64)
            result = extract_surgery_table(pdf_bytes)
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
