"""
Vercel serverless function: Generic pdfplumber table extractor.
Accepts a specialty key and returns structured schedule rows with
proper column alignment — handles empty cells without column drift.

Usage: POST { pdf_base64, specialty }
Returns: { rows: [{date, day, ...columns}], columns: [...] }
"""
from http.server import BaseHTTPRequestHandler
import json, base64, io, re


# ── Specialty column configurations ──────────────────────────────
# Each config defines:
#   columns:       ordered list of output field names
#   headers:       regex patterns to detect column positions from header row
#   date_pattern:  regex to find dates in rows
#   fallback_cols: fixed column indices if header detection fails (0-based, after date)
#   min_headers:   minimum header matches required before using detected positions

SPECIALTY_CONFIGS = {
    'hospitalist': {
        'columns': ['onc_er_day', 'onc_er_night'],
        'headers': {},
        'date_pattern': re.compile(r'(\d{1,2})/(\d{1,2})/(\d{4})'),
        'day_pattern': re.compile(r'^(Sun|Mon|Tue|Wed|Thu|Fri|Sat)', re.I),
        # Only Oncology ER columns: day=col 7, night=col 8
        'fallback_cols': [7, 8],
        'min_headers': 99,  # always use fallback — headers are too complex for auto-detection
    },
    'orthopedics': {
        'columns': ['resident', 'second_oncall', 'pediatric_assoc', 'adult_consultant'],
        'headers': {},
        'date_pattern': re.compile(r'(\d{1,2})/(\d{1,2})/(\d{4})'),
        'day_pattern': None,
        'fallback_cols': [3, 6, 9, 15],
        'min_headers': 99,  # merged headers — always use fallback
        'date_col_offset': True,  # weekends shift date to col 1, data shifts +1
    },
    'pediatrics': {
        'columns': ['first_oncall', 'second_oncall', 'third_oncall', 'hospitalist_er',
                     'hospitalist_ward', 'hospitalist_after'],
        'headers': {
            'first_oncall': re.compile(r'1st\s*oncall|1st\s*on.?call', re.I),
            'second_oncall': re.compile(r'2nd\s*oncall|2nd\s*on.?call', re.I),
            'third_oncall': re.compile(r'3rd\s*on\s*call', re.I),
            'hospitalist_er': re.compile(r'hospitalist.*er|kfsh\s*er', re.I),
            'hospitalist_ward': re.compile(r'hospitalist.*ward|ward.?e\b', re.I),
            'hospitalist_after': re.compile(r'hospitalist.*ward.*er.*4:30|ward.?e\s*and\s*er', re.I),
        },
        'date_pattern': re.compile(r'(\d{1,2})/(\d{1,2})/(\d{4})'),
        'day_pattern': re.compile(r'^(Sun|Mon|Tue|Wed|Thu|Fri|Sat)', re.I),
        'fallback_cols': [2, 3, 4, 5, 6, 7],
        'min_headers': 3,
    },
    'hematology': {
        'columns': ['oncall1_resident', 'oncall2_fellow', 'second_rounder',
                     'oncall4_consultant', 'er_fellow', 'consultation_consultant'],
        'headers': {
            'oncall1_resident': re.compile(r'oncall\s*1|resident', re.I),
            'oncall2_fellow': re.compile(r'oncall\s*2', re.I),
            'second_rounder': re.compile(r'2nd\s*rounder|associate', re.I),
            'oncall4_consultant': re.compile(r'oncall\s*4', re.I),
            'er_fellow': re.compile(r'er\s*/\s*consult', re.I),
            'consultation_consultant': re.compile(r'consultation\s*cover', re.I),
        },
        'date_pattern': re.compile(r'(\d{1,2})[/\-](\d{1,2})[/\-](\d{4})'),
        'day_pattern': re.compile(r'^(Sun|Mon|Tue|Wed|Thu|Fri|Sat)', re.I),
        # Weekday cols (date at col 2): data at 7, 13, 16, 19, 22, 25
        # Weekend cols shift +1 (date at col 3): 8, 14(~11 for oncall2), 17, 20, 23, 26
        'fallback_cols': [7, 13, 16, 19, 22, 25],
        'min_headers': 99,  # always use fallback — merged header cells break auto-detection
        'date_col_offset': True,  # adjust columns when date shifts (weekends)
        'base_date_col': 2,  # weekday dates at col 2, weekends at col 3
    },
    'ent': {
        'columns': ['first_oncall', 'second_oncall', 'third_oncall'],
        'headers': {
            'first_oncall': re.compile(r'1st\s*on\s*call', re.I),
            'second_oncall': re.compile(r'2nd\s*on\s*call', re.I),
            'third_oncall': re.compile(r'3rd\s*on\s*call', re.I),
        },
        'date_pattern': re.compile(r'(\d{1,2})/(\d{1,2})/(\d{4})'),
        'day_pattern': re.compile(r'^(Sun|Mon|Tue|Wed|Thu|Fri|Sat)', re.I),
        'fallback_cols': [6, 9, 12],
        'min_headers': 2,
    },
    'neurosurgery': {
        'columns': ['resident_day', 'resident_night', 'fellow_assistant',
                     'associate_consultant', 'neurosurgeon_consultant'],
        'headers': {},
        'date_pattern': re.compile(r'(\d{1,2})-([A-Za-z]{3})-(\d{2,4})'),
        'date_format': 'dMONyy',
        'day_pattern': re.compile(r'^(Sun|Mon|Tue|Wed|Thu|Fri|Sat)', re.I),
        'fallback_cols': [3, 4, 5, 6, 7],
        'min_headers': 99,  # merged headers — always use fallback
    },
    'spine': {
        'columns': ['resident_onduty', 'fellow_second', 'consultant'],
        'headers': {
            'resident_onduty': re.compile(r'resident|1st\s*on.?duty', re.I),
            'fellow_second': re.compile(r'fellow|2nd\s*on.?duty|assistant', re.I),
            'consultant': re.compile(r'spine.*consult|consultant', re.I),
        },
        'date_pattern': re.compile(r'(\d{1,2})-([A-Za-z]{3})-(\d{2,4})'),
        'date_format': 'dMONyy',
        'day_pattern': re.compile(r'^(Sun|Mon|Tue|Wed|Thu|Fri|Sat)', re.I),
        'fallback_cols': [3, 5, 6],
        'min_headers': 2,
    },
    'kptx': {
        'columns': ['inpatient', 'first_oncall', 'second_oncall',
                     'consultant_oncall', 'consultant_scot', 'coordinator'],
        'headers': {
            'inpatient': re.compile(r'inpatient|consultation', re.I),
            'first_oncall': re.compile(r'1st\s*on.?call', re.I),
            'second_oncall': re.compile(r'2nd\s*on.?call', re.I),
            'consultant_oncall': re.compile(r'consultant\s*on.?call', re.I),
            'consultant_scot': re.compile(r'scot|consultant.*scot', re.I),
            'coordinator': re.compile(r'coord|transplant.*clin', re.I),
        },
        'date_pattern': re.compile(r'(\d{1,2})/(\d{1,2})/(\d{4})'),
        'day_pattern': re.compile(r'^(Sun|Mon|Tue|Wed|Thu|Fri|Sat|Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)', re.I),
        'fallback_cols': [2, 3, 4, 5, 6, 7],
        'min_headers': 99,  # headers span 2 rows — always use fallback
    },
    'liver': {
        'columns': ['day_coverage', 'after_duty', 'second_oncall',
                     'consultant_oncall', 'coordinator'],
        'headers': {
            'day_coverage': re.compile(r'day\s*coverage|1st\s*on.?call.*day', re.I),
            'after_duty': re.compile(r'after\s*duty|1st\s*on.?call.*after', re.I),
            'second_oncall': re.compile(r'2nd\s*on.?call', re.I),
            'consultant_oncall': re.compile(r'3rd\s*on.?call|consultant.*adult', re.I),
            'coordinator': re.compile(r'coordinator|clinical.*coord', re.I),
        },
        'date_pattern': re.compile(r'(\d{1,2})/(\d{1,2})/(\d{4})'),
        'day_pattern': re.compile(r'^(Sun|Mon|Tue|Wed|Thu|Fri|Sat|Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)', re.I),
        'fallback_cols': [2, 3, 4, 5, 6],
        'min_headers': 3,
    },
}

MONTH_MAP = {
    'jan': 1, 'feb': 2, 'mar': 3, 'apr': 4, 'may': 5, 'jun': 6,
    'jul': 7, 'aug': 8, 'sep': 9, 'oct': 10, 'nov': 11, 'dec': 12,
}

SKIP_LABELS = re.compile(
    r'^(day|date|resident|fellow|consultant|senior|junior|on.?call|on.?duty|'
    r'am\s*shift|pm\s*shift|hours|associate|hospitalist|coverage|floor|'
    r'inpatient|er|ward|coordinator|scot|team\s|oncall\s*\d|'
    r'1st\s*on|2nd\s*on|3rd\s*on|\d{1,2}:\d{2})',
    re.I
)


def parse_date_key(match, config):
    """Convert a regex match to DD/MM date key."""
    fmt = config.get('date_format', '')
    if fmt == 'dMONyy':
        day = int(match.group(1))
        mon_str = match.group(2).lower()[:3]
        month = MONTH_MAP.get(mon_str, 0)
        if not month:
            return None
        return f'{day:02d}/{month:02d}'
    else:
        day = int(match.group(1))
        month = int(match.group(2))
        return f'{day:02d}/{month:02d}'


def detect_columns(table, config):
    """Detect column positions from header rows."""
    headers = config.get('headers', {})
    columns = config['columns']
    min_headers = config.get('min_headers', 2)
    skip_rows = config.get('skip_header_rows', 0)

    col_map = {}
    for ri, row in enumerate(table):
        if not row:
            continue
        if skip_rows and ri >= skip_rows:
            break
        cells = [(c or '').strip() for c in row]
        matched = {}
        for key, pattern in headers.items():
            for ci, cell in enumerate(cells):
                if cell and pattern.search(cell) and ci not in matched.values():
                    matched[key] = ci
                    break
        if len(matched) >= min_headers:
            col_map = matched
            break

    if not col_map:
        # Use fallback column indices
        fallback = config.get('fallback_cols', [])
        for i, col_name in enumerate(columns):
            if i < len(fallback):
                col_map[col_name] = fallback[i]
    else:
        # Fill missing columns by interpolation from detected ones
        detected = sorted(col_map.items(), key=lambda x: x[1])
        for col_name in columns:
            if col_name not in col_map:
                # Try to find it in headers that weren't matched
                pass  # Will be filled by fallback below

    return col_map


def extract_table_rows(pdf_bytes, specialty):
    """Extract schedule rows from a PDF using pdfplumber."""
    import pdfplumber

    config = SPECIALTY_CONFIGS.get(specialty)
    if not config:
        return {'error': f'Unknown specialty: {specialty}', 'rows': []}

    columns = config['columns']
    date_pattern = config['date_pattern']
    day_pattern = config.get('day_pattern')
    rows_out = []

    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for page in pdf.pages:
            tables = page.extract_tables()
            if not tables:
                continue

            # Use the largest table on this page
            table = max(tables, key=lambda t: len(t))

            # Detect column positions
            col_map = detect_columns(table, config)

            # Extract data rows
            for row in table:
                if not row:
                    continue

                # Find date in the row
                date_match = None
                date_col = -1
                for ci, cell in enumerate(row):
                    val = (cell or '').strip()
                    m = date_pattern.search(val)
                    if m:
                        date_match = m
                        date_col = ci
                        break

                if not date_match:
                    continue

                date_key = parse_date_key(date_match, config)
                if not date_key:
                    continue

                # Detect day name
                day_name = ''
                if day_pattern:
                    for ci, cell in enumerate(row):
                        val = (cell or '').strip()
                        dm = day_pattern.match(val)
                        if dm:
                            day_name = dm.group(1)
                            break

                # For tables with shifting columns (e.g. hematology weekends),
                # offset fallback cols relative to date column position
                active_col_map = col_map
                if config.get('date_col_offset') and date_col >= 0:
                    fallback = config.get('fallback_cols', [])
                    if fallback and col_map == {columns[i]: fallback[i] for i in range(min(len(columns), len(fallback)))}:
                        # Using fallback cols — adjust for date column shift
                        base_date_col = config.get('base_date_col', 0)
                        offset = date_col - base_date_col
                        if offset != 0:
                            active_col_map = {k: v + offset for k, v in col_map.items()}

                # Extract column values
                entry = {'date': date_key, 'day': day_name}
                has_data = False
                for col_name in columns:
                    idx = active_col_map.get(col_name)
                    if idx is not None and idx < len(row):
                        val = (row[idx] or '').strip()
                        # Skip header/label values
                        if val and SKIP_LABELS.match(val):
                            val = ''
                        # Clean multi-line values (pdfplumber returns \n for line breaks)
                        if val:
                            val = val.replace('\n', ' ').strip()
                        entry[col_name] = val
                        if val:
                            has_data = True
                    else:
                        entry[col_name] = ''

                if has_data:
                    rows_out.append(entry)

    return {'rows': rows_out, 'columns': columns, 'specialty': specialty}


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            length = int(self.headers.get('Content-Length', 0))
            body = json.loads(self.rfile.read(length))
            pdf_b64 = body.get('pdf_base64', '')
            specialty = body.get('specialty', '')
            pdf_bytes = base64.b64decode(pdf_b64)
            result = extract_table_rows(pdf_bytes, specialty)
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
