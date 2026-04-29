"""
Vercel Python serverless function: extract contacts from any rota PDF.
Called for ALL specialty uploads — returns {name: phone} map via pdfplumber.
"""

from http.server import BaseHTTPRequestHandler
import json
import re
import base64
import io


def _normalize_phone(ph):
    """Normalize extracted phone to standard 05XXXXXXXX (10-digit) format."""
    digits = re.sub(r'\D', '', ph)
    if digits.startswith('966'):
        digits = '0' + digits[3:]
    if not digits.startswith('0'):
        digits = '0' + digits
    return digits if re.match(r'^05\d{8}$', digits) else None


def _clean_name(raw):
    """Strip noise from a candidate name string."""
    name = re.sub(r'\b\d+\b', ' ', raw)
    name = re.sub(r'\([^)]*\)', '', name)
    name = re.sub(r'\b(ext\.?|on training|pager|mobile|phone)\b', '', name, flags=re.I)
    name = re.sub(r'^\s*Dr\.?\s*', '', name)  # handle leading whitespace from digit removal
    # Strip trailing role labels (Resident, Consultant, etc.) and everything after
    name = re.sub(r'\s*\b(Resident|Consultant|Fellow|Associate|Physician|Specialist)\b.*$', '', name, flags=re.I)
    name = re.sub(r'\s+', ' ', name).strip()
    return name


# Labels that should never be treated as doctor names
_SKIP_LABEL_RE = re.compile(
    r'^(day|date|name|extension|ext|phone|mobile|no\.?|pager|on.?call|general|'
    r'medical|consultant|resident|fellow|associate|section|head|chair|director|'
    r'program|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s*$',
    re.I
)

# Matches Saudi mobile numbers in multiple formats:
#   05XXXXXXXX (10 digits, leading 0)   ← standard format
#   5XXXXXXXX  (9 digits, no leading 0) ← short format used in some PDFs
#   056 902 1663 / 056-902-1663         ← spaced/dashed format in some PDFs
_PHONE_RE = re.compile(r'(?<!\d)(0?5[\d\s-]{8,14})(?!\d)')


def extract_contacts(pdf_bytes):
    """
    Extract name→phone map from any rota PDF using pdfplumber.
    Applies to ALL specialties (not just radiology).

    Strategy:
      1. Table extraction — handles multi-column contact tables correctly.
         pdfplumber.extract_tables() preserves row/column structure so names
         and phones stay properly paired even when columns are side-by-side.
      2. Text extraction fallback — handles simple same-line "Name ... Phone" format.
         Used for pages without tables or when table extraction yields nothing.
    """
    import pdfplumber

    contacts = {}

    def _add(name_raw, ph_raw):
        phone = _normalize_phone(ph_raw)
        if not phone:
            return
        name = _clean_name(name_raw)
        if not name or len(name) < 3 or re.match(r'^\d+$', name) or _SKIP_LABEL_RE.match(name):
            return
        # Don't overwrite a longer/better name for the same phone
        existing = {v: k for k, v in contacts.items()}
        if phone not in existing or len(name) > len(existing[phone]):
            contacts[name] = phone

    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:

        # ── Pass 1: table extraction (multi-column contact tables) ────────────
        for page in pdf.pages:
            try:
                tables = page.extract_tables() or []
                for table in tables:
                    for row in (table or []):
                        if not row:
                            continue
                        cells = [str(c or '').strip() for c in row]
                        for ci, cell in enumerate(cells):
                            m = _PHONE_RE.search(cell)
                            if not m:
                                continue
                            ph = m.group(0)
                            # Name is in the nearest non-empty cell to the LEFT of the phone cell
                            name_raw = ''
                            for j in range(ci - 1, max(-1, ci - 4), -1):
                                if cells[j] and len(cells[j]) >= 3:
                                    name_raw = cells[j]
                                    break
                            # Fallback: text in the same cell before the phone
                            if not name_raw:
                                name_raw = cell[:m.start()].strip()
                            _add(name_raw, ph)
            except Exception:
                pass

        # ── Pass 2: text extraction (same-line "Name Phone" format) ───────────
        for page in pdf.pages:
            text = page.extract_text() or ''
            lines = text.split('\n')
            for li, line in enumerate(lines):
                # Skip schedule date rows (dd/mm/yyyy or dd/mm/yy)
                if re.search(r'\b\d{1,2}/\d{1,2}/\d{2,4}\b', line):
                    continue

                phones_in_line = [(m.group(0), m.start()) for m in _PHONE_RE.finditer(line)]
                if phones_in_line:
                    for i, (ph, idx) in enumerate(phones_in_line):
                        start = 0 if i == 0 else phones_in_line[i - 1][1] + len(phones_in_line[i - 1][0])
                        _add(line[start:idx], ph)
                else:
                    # Name-on-one-line, phone-on-next-line format
                    if li + 1 < len(lines):
                        next_line = lines[li + 1].strip()
                        nm = _PHONE_RE.fullmatch(next_line) or \
                             re.fullmatch(r'\+?966[\s-]*(0?5\d{8})', next_line)
                        if nm:
                            _add(line, nm.group(0))

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
