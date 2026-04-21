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
    """
    import pdfplumber
    rows_out = []
    day_re = re.compile(r'^(SUN|MON|TUE|WED|THU|FRI|SAT)$', re.IGNORECASE)

    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for page in pdf.pages:
            tables = page.extract_tables()
            if not tables:
                continue
            table = tables[0]  # main schedule table
            for row in table:
                if not row or not row[0]:
                    continue
                day = (row[0] or '').strip()
                if not day_re.match(day):
                    continue
                date_str = (row[1] or '').strip()
                if not date_str:
                    continue
                # Columns: [Day, Date, Jr ER, Jr Ward, Sr ER, Sr Ward, GS Assoc, GS Consult, ...]
                jr_er     = (row[2] or '').strip() if len(row) > 2 else ''
                sr_er     = (row[4] or '').strip() if len(row) > 4 else ''
                gs_assoc  = (row[6] or '').strip() if len(row) > 6 else ''
                gs_consult= (row[7] or '').strip() if len(row) > 7 else ''
                rows_out.append({
                    'date': date_str,
                    'jr_er': jr_er,
                    'sr_er': sr_er,
                    'gs_assoc': gs_assoc,
                    'gs_consult': gs_consult,
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
