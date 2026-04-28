"""
Vercel serverless function: Use Claude API to resolve abbreviated doctor names
from the medicine on-call schedule table against the contact list.

Receives: pdfplumber-extracted schedule rows + contact list (full names + phones)
Returns: schedule rows with abbreviated names replaced by full names
"""
from http.server import BaseHTTPRequestHandler
import json, os, re, hashlib, time, urllib.request, urllib.error


# ── Cache helpers (server-side only — writes use SUPABASE_SERVICE_KEY) ──

CACHE_VERSION = 'v1.0'
CACHE_TTL_DAYS = 30
CACHE_SPECIALTY = 'medicine_on_call'


def _cache_enabled():
    return os.environ.get('VERIFICATION_CACHE_ENABLED', '').lower() == 'true'


def _supabase_headers(key):
    return {'apikey': key, 'Authorization': f'Bearer {key}', 'Content-Type': 'application/json'}


def cache_lookup(file_hash):
    """Look up cached result by file hash. Returns parsed result or None."""
    if not file_hash or not _cache_enabled():
        return None
    url = os.environ.get('SUPABASE_URL', '')
    key = os.environ.get('SUPABASE_PUBLISHABLE_KEY', '') or os.environ.get('SUPABASE_SERVICE_KEY', '')
    if not url or not key:
        return None
    try:
        from datetime import datetime
        now = datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%S+00:00')
        endpoint = (f'{url}/rest/v1/verification_cache?select=result'
                    f'&file_hash=eq.{file_hash}'
                    f'&specialty=eq.{CACHE_SPECIALTY}'
                    f'&cache_version=eq.{CACHE_VERSION}'
                    f'&expires_at=gt.{now}'
                    f'&limit=1')
        req = urllib.request.Request(endpoint, headers=_supabase_headers(key))
        with urllib.request.urlopen(req, timeout=2) as resp:
            rows = json.loads(resp.read())
            if rows and len(rows) > 0:
                print(f'[CACHE] HIT medicine_on_call {file_hash[:12]}...')
                return rows[0]['result']
    except Exception as e:
        print(f'[CACHE] lookup error: {e}')
    return None


def cache_save(file_hash, result):
    """Save result to cache. Fire-and-forget — errors are logged, never raised."""
    if not file_hash or not _cache_enabled():
        return
    url = os.environ.get('SUPABASE_URL', '')
    key = os.environ.get('SUPABASE_SERVICE_KEY', '')
    if not url or not key:
        return
    try:
        from datetime import datetime, timedelta
        expires = (datetime.utcnow() + timedelta(days=CACHE_TTL_DAYS)).strftime('%Y-%m-%dT%H:%M:%S+00:00')
        body = json.dumps({
            'file_hash': file_hash,
            'specialty': CACHE_SPECIALTY,
            'cache_version': CACHE_VERSION,
            'result': result,
            'expires_at': expires,
        }).encode()
        req = urllib.request.Request(
            f'{url}/rest/v1/verification_cache',
            data=body,
            headers={**_supabase_headers(key), 'Prefer': 'resolution=merge-duplicates,return=minimal'},
            method='POST',
        )
        with urllib.request.urlopen(req, timeout=3) as resp:
            print(f'[CACHE] SAVED medicine_on_call {file_hash[:12]}...')
    except Exception as e:
        print(f'[CACHE] save error: {e}')


def _clean_contact_name(name):
    """Strip 'Resident', 'Resident -', trailing dashes from contact names."""
    name = re.sub(r'\s*\bResident\b\s*\d*\s*', ' ', name, flags=re.I)
    name = re.sub(r'\s*-\s*$', '', name)
    name = re.sub(r'\s+', ' ', name).strip()
    return name


_BATCH_SIZE = 7


def _build_prompt(contact_lines, schedule_lines):
    """Build the Claude prompt for a batch of schedule rows."""
    return f"""You are a medical schedule parser for the Department of Medicine in-house on-call rota.

## Contact List (full names with phone numbers):
{contact_lines}

## Schedule Table
Columns: Date | JW Day | JW Night | JER Day | JER Night | Sr Day | Sr Night

- JW = Junior Ward (7:30 AM - 9:00 PM day, 9:00 PM - 7:30 AM night)
- JER = Junior ER (same shift times)
- Sr = Senior ER (same shift times)

Seniority mapping (use the Resident level shown in the contact list to disambiguate):
- Senior columns (sr_day, sr_night) are staffed by Resident 3 or Resident 4 level doctors
- Junior columns (jer_day, jer_night, jw_day, jw_night) are staffed by Resident 1 or Resident 2 level doctors
- Example: "Lama" in sr_night → must be a Resident 3 (Lama Almubarak), NOT Resident 1 (Lama Alkunaizi)

Data:
{schedule_lines}

## Task
Match each abbreviated name in the schedule to the correct full name from the contact list.

### Matching rules (apply in this priority order):

1. **Bare first name** (single word, no dot, no initial — e.g. "Marwa", "Bushra", "Lama"):
   - Find the contact whose FIRST NAME matches the cell text. "Marwa" matches "Dr. Marwa Alibrahim", NOT "Dr. Elaf Alibrahim" even though they share the last name "Alibrahim".
   - If exactly one contact has that first name → use it.
   - If multiple contacts share the same first name (e.g. three "Lama"s): disambiguate using ALL context — column role (Senior = Resident 3/4, Junior = Resident 1/2), position in contact list.

2. **Initial.Lastname** (e.g. "F.Yaqoub", "H.Darwish", "A.Alsughir"):
   - Match by last name, confirm the initial matches the first letter of the contact's first name.
   - "F.Alsaeed" = "Dr. Fatimah Alsaeed" (F matches Fatimah, Alsaeed matches).
   - "H.Darwish" = "Dr. Hussain Ali Aldarwish" (H matches Hussain, Darwish ≈ Aldarwish).

3. **Name.Name or concatenated** (e.g. "M.Alahmad", "Z.Alsalman"):
   - Same as Initial.Lastname — match last name, confirm initial.

### Additional rules:
- If a cell is empty, return null for that field.
- Always include "Dr." prefix in the output names. Strip "Resident", "Resident 1/2/3/4", and trailing dashes from the output — output clean names only (e.g. "Dr. Lama Almubarak" not "Dr. Lama Almubarak Resident 3").
- If you cannot confidently match a name, return the original text with "Dr." prefix AND set "unresolved": true on that row.
- NEVER match by last name alone when the schedule provides a clear first name.

## Output
Return ONLY a JSON array. Each element:
{{"date":"<original date>","jw_day":"Dr. Full Name","jw_night":"Dr. Full Name","jer_day":"Dr. Full Name","jer_night":"Dr. Full Name","sr_day":"Dr. Full Name","sr_night":"Dr. Full Name"}}
Use null for empty cells. Add "unresolved": true to any row where you are not confident about a match. No explanation, just the JSON array."""


def resolve_names_with_llm(schedule_rows, contacts):
    """Call Claude Haiku to resolve abbreviated names to full names.
    Splits into batches of _BATCH_SIZE rows to keep output reliable."""
    import anthropic

    api_key = os.environ.get('ANTHROPIC_API_KEY', '')
    if not api_key:
        return None  # no API key -> caller falls back to client-side

    # Format contacts for the prompt using ORIGINAL names (with Resident level visible
    # for disambiguation), but clean the output names for display.
    contact_lines = '\n'.join(
        f'- {name}: {phone}' for name, phone in contacts.items() if phone
    ) or '(no contacts extracted)'

    client = anthropic.Anthropic(api_key=api_key)
    all_resolved = []

    # Process in batches of _BATCH_SIZE rows
    for i in range(0, len(schedule_rows), _BATCH_SIZE):
        batch = schedule_rows[i:i + _BATCH_SIZE]

        schedule_lines = '\n'.join(
            f'{r.get("date","")}\t{r.get("jw_day","")}\t{r.get("jw_night","")}\t{r.get("jer_day","")}\t{r.get("jer_night","")}\t{r.get("sr_day","")}\t{r.get("sr_night","")}'
            for r in batch
        )

        prompt = _build_prompt(contact_lines, schedule_lines)

        message = client.messages.create(
            model='claude-haiku-4-5-20251001',
            max_tokens=1024,
            messages=[{'role': 'user', 'content': prompt}],
        )

        # Extract JSON from response
        response_text = message.content[0].text.strip()
        if response_text.startswith('```'):
            response_text = re.sub(r'^```(?:json)?\s*', '', response_text)
            response_text = re.sub(r'\s*```$', '', response_text)

        batch_result = json.loads(response_text)
        if isinstance(batch_result, list):
            all_resolved.extend(batch_result)

    return all_resolved


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            length = int(self.headers.get('Content-Length', 0))
            body = json.loads(self.rfile.read(length))
            schedule_rows = body.get('schedule_rows', [])
            contacts = body.get('contacts', {})
            file_hash = body.get('pdf_hash', '')
            force = body.get('force', False)

            if not schedule_rows:
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({'error': 'No schedule rows'}).encode())
                return

            # ── Cache lookup (skip if force=true) ──
            if file_hash and not force:
                cached = cache_lookup(file_hash)
                if cached is not None:
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/json')
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.end_headers()
                    self.wfile.write(json.dumps({'rows': cached, '_fromCache': True}).encode())
                    return

            result = resolve_names_with_llm(schedule_rows, contacts)

            if result is None:
                self.send_response(503)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({'error': 'No API key configured'}).encode())
                return

            # ── Cache save (fire-and-forget) ──
            if file_hash:
                cache_save(file_hash, result)

            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({'rows': result, '_fromCache': False}).encode())
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
