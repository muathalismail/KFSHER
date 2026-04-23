"""
Vercel Python serverless function: extract contacts from imaging on-call PDF.
Called by client ONLY for radiology_oncall specialty.
Returns {name: phone} map extracted via pdfplumber.
"""

from http.server import BaseHTTPRequestHandler
import json
import re
import base64
import io


def extract_contacts(pdf_bytes):
    """Extract name→phone map from imaging on-call PDF using pdfplumber."""
    import pdfplumber

    contacts = {}
    phone_re = re.compile(r'\b(5\d{8})\b')

    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for page in pdf.pages:
            text = page.extract_text() or ''
            for line in text.split('\n'):
                if re.search(r'\d{1,2}/\d{1,2}/\d{4}', line):
                    continue
                if re.match(r'^(DAY|DATE|MEDICAL|APRIL|NAME|EXTENSION|ON-CALL GENERAL)', line.strip(), re.I):
                    continue

                phones = [(m.group(1), m.start()) for m in phone_re.finditer(line)]
                if not phones:
                    continue

                for i, (ph, idx) in enumerate(phones):
                    start = 0 if i == 0 else phones[i - 1][1] + len(phones[i - 1][0])
                    name_text = line[start:idx].strip()
                    name = re.sub(r'\b\d{4}\b', ' ', name_text)
                    name = re.sub(r'\([^)]*\)', '', name)
                    name = re.sub(r'\b(ext\.?|on training)\b', '', name, flags=re.I)
                    name = re.sub(r'^Dr\.?\s*', '', name)
                    name = re.sub(r'\s+', ' ', name).strip()

                    if name and len(name) >= 3 and not re.match(r'^\d+$', name):
                        contacts[name] = '0' + ph

    return contacts


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            body = json.loads(self.rfile.read(content_length))
            pdf_base64 = body.get('pdf_base64', '')

            if not pdf_base64:
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'error': 'No PDF data'}).encode())
                return

            pdf_bytes = base64.b64decode(pdf_base64)
            contacts = extract_contacts(pdf_bytes)

            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps(contacts).encode())
        except Exception as e:
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'error': str(e)}).encode())

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()
