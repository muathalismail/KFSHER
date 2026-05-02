"""
Unified Claude API name resolution for all specialties.
Routes by 'specialty' param to the correct prompt + column schema.

Receives: { specialty, schedule_rows, contacts, pdf_hash?, force? }
Returns: { rows: [...], _fromCache: bool } or [...] (legacy)
"""
from http.server import BaseHTTPRequestHandler
import json, os, re, urllib.request, urllib.error


# ═══════════════════════════════════════════════════════════════
# CACHE (medicine_on_call only)
# ═══════════════════════════════════════════════════════════════

CACHE_VERSION = 'v1.1'
CACHE_TTL_DAYS = 30

def _cache_enabled():
    return os.environ.get('VERIFICATION_CACHE_ENABLED', '').lower() == 'true'

def _supabase_headers(key):
    return {'apikey': key, 'Authorization': f'Bearer {key}', 'Content-Type': 'application/json'}

def cache_lookup(file_hash, specialty):
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
                    f'&specialty=eq.{specialty}'
                    f'&cache_version=eq.{CACHE_VERSION}'
                    f'&expires_at=gt.{now}'
                    f'&limit=1')
        req = urllib.request.Request(endpoint, headers=_supabase_headers(key))
        with urllib.request.urlopen(req, timeout=2) as resp:
            rows = json.loads(resp.read())
            if rows and len(rows) > 0:
                print(f'[CACHE] HIT {specialty} {file_hash[:12]}...')
                return rows[0]['result']
    except Exception as e:
        print(f'[CACHE] lookup error: {e}')
    return None

def cache_save(file_hash, specialty, result):
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
            'specialty': specialty,
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
            print(f'[CACHE] SAVED {specialty} {file_hash[:12]}...')
    except Exception as e:
        print(f'[CACHE] save error: {e}')


# ═══════════════════════════════════════════════════════════════
# SPECIALTY CONFIGS: prompt builder + column formatter + batch size
# ═══════════════════════════════════════════════════════════════

SPECIALTY_CONFIGS = {}

# ── MEDICINE ON-CALL ──────────────────────────────────────────

def _medicine_prompt(contact_lines, schedule_lines):
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
- Example: "H.Barbari" → Dr. Hassan Sh. Albarbari (phone 0569021663). Do NOT confuse with Hassan Buhmood (different person, different phone).

Data:
{schedule_lines}

## Task
Match each abbreviated name in the schedule to the correct full name from the contact list.

### Matching rules (apply in this priority order):

1. **Bare first name** (single word, no dot, no initial — e.g. "Marwa", "Bushra", "Lama"):
   - Find the contact whose FIRST NAME matches the cell text.
   - If exactly one contact has that first name → use it.
   - If multiple contacts share the same first name: disambiguate using column role (Senior = Resident 3/4, Junior = Resident 1/2).

2. **Initial.Lastname** (e.g. "F.Yaqoub", "H.Darwish", "A.Alsughir"):
   - Match by last name, confirm the initial matches the first letter of the contact's first name.

3. **Name.Name or concatenated** (e.g. "M.Alahmad", "Z.Alsalman"):
   - Same as Initial.Lastname — match last name, confirm initial.

### Additional rules:
- If a cell is empty, return null for that field.
- Always include "Dr." prefix. Strip "Resident", trailing dashes from output.
- If uncertain, return original text with "Dr." prefix AND set "unresolved": true.
- NEVER match by last name alone when a first name is provided.

## Output
Return ONLY a JSON array. Each element:
{{"date":"<date>","jw_day":"Dr. Full Name","jw_night":"Dr. Full Name","jer_day":"Dr. Full Name","jer_night":"Dr. Full Name","sr_day":"Dr. Full Name","sr_night":"Dr. Full Name"}}
Use null for empty cells. No explanation, just the JSON array."""

def _medicine_format_row(r):
    return f'{r.get("date","")}\t{r.get("jw_day","")}\t{r.get("jw_night","")}\t{r.get("jer_day","")}\t{r.get("jer_night","")}\t{r.get("sr_day","")}\t{r.get("sr_night","")}'

SPECIALTY_CONFIGS['medicine_on_call'] = {
    'prompt': _medicine_prompt,
    'format_row': _medicine_format_row,
    'batch_size': 7,
    'use_cache': True,
}

# ── SURGERY ───────────────────────────────────────────────────

def _surgery_prompt(contact_lines, schedule_lines):
    return f"""You are a medical schedule parser for a surgery department.

## Contact List (full names with phone numbers):
{contact_lines}

## Schedule Table (columns: Date, Junior ER, Senior ER, GS Associate, GS Consultant):
{schedule_lines}

## Task
Match each abbreviated name in the schedule to the correct full name from the contact list.
Rules:
- Names may be concatenated without spaces: "OmarB" = "Omar Baasim"
- If a cell is empty, return null for that role
- If two doctors share a cell (separated by / or &), return both names joined with " / "
- Always include "Dr." prefix in the output names
- If you cannot confidently match a name, return the original text with "Dr." prefix

## Output
Return ONLY a JSON array. Each element:
{{"date":"<original date>","jr_er":"Dr. Full Name","sr_er":"Dr. Full Name","gs_assoc":"Dr. Full Name","gs_consult":"Dr. Full Name"}}
Use null for empty cells. No explanation, just the JSON array."""

def _surgery_format_row(r):
    return f'{r.get("date","")}\t{r.get("jr_er","")}\t{r.get("sr_er","")}\t{r.get("gs_assoc","")}\t{r.get("gs_consult","")}'

SPECIALTY_CONFIGS['surgery'] = {
    'prompt': _surgery_prompt,
    'format_row': _surgery_format_row,
    'batch_size': 30,  # surgery has ~30 rows, no batching needed
    'use_cache': False,
}

# ── PEDIATRICS ────────────────────────────────────────────────

def _pediatrics_prompt(contact_lines, schedule_lines):
    return f"""You are a medical schedule parser for the Pediatrics Department duty rota.

## Contact List (full names with phone numbers):
{contact_lines}

## Schedule Table
Columns: Date | 1st OnCall | 2nd OnCall | 3rd OnCall | Hospitalist ER | Hospitalist Ward-E | Hospitalist Ward-E and ER

Data:
{schedule_lines}

## Task
Match each name in the schedule to the correct full name from the contact list.

### Matching rules:
1. **Full name** (e.g. "Tahirah AlGarrous"): match as complete name.
2. **Abbreviated Dr. name** (e.g. "Dr Sherifah"): strip "Dr", match by first name.
3. **Bare first name** (e.g. "Roa"): match by first name. If ambiguous, mark "unresolved": true.
4. **Multi-doctor cells** (e.g. "Dr.Abeer/Dr.Amal"): split on "/" and resolve each.

### Additional rules:
- Empty cells → null. Always include "Dr." prefix.
- If uncertain → return original with "Dr." prefix AND "unresolved": true.
- If cell contains phone numbers/IDs → null.

## Output
Return ONLY a JSON array. Each element:
{{"date":"<date>","first_oncall":"Dr. Full Name","second_oncall":"Dr. Full Name","third_oncall":"Dr. Full Name","hospitalist_er":"Dr. Full Name","hospitalist_ward":"Dr. Full Name","hospitalist_after":"Dr. Full Name"}}
Use null for empty cells. No explanation, just the JSON array."""

def _pediatrics_format_row(r):
    return f'{r.get("date","")}\t{r.get("first_oncall","")}\t{r.get("second_oncall","")}\t{r.get("third_oncall","")}\t{r.get("hospitalist_er","")}\t{r.get("hospitalist_ward","")}\t{r.get("hospitalist_after","")}'

SPECIALTY_CONFIGS['pediatrics'] = {
    'prompt': _pediatrics_prompt,
    'format_row': _pediatrics_format_row,
    'batch_size': 7,
    'use_cache': False,
}

# ── RADIOLOGY ON-CALL ─────────────────────────────────────────

def _radiology_prompt(contact_lines, schedule_lines):
    return f"""You are a medical schedule parser for the Medical Imaging (MISC) On-Call rota.

## Contact List (full names with phone numbers):
{contact_lines}

## Schedule Table
Columns: Date | Shift | 1st On-Call Resident | 2nd On-Call Resident | 3rd On-Call

Role-to-position mapping (CRITICAL for disambiguation):
- 1st On-Call and 2nd On-Call are ALWAYS Residents — never Fellows or Consultants
- 3rd On-Call is a Fellow or Consultant
- Contact list labels like "(F1 - Breast)" mean Fellow; "(ext)" means external/resident

Data:
{schedule_lines}

## Task
Match each name to the correct full name from the contact list.

### Matching rules:
1. **Full name** (e.g. "Mona Awaji"): match as complete name. Spelling variants common.
   CRITICAL: "Khalid Al Zahrani" matches "Khaled Al Zahrani", NOT "Khalid Balawi".
   When full Firstname Lastname given, match by LAST NAME first.
2. **Initial.Lastname** (e.g. "F.AlKhabaz"): match by last name + initial.
3. **Bare first name**: match by first name. If ambiguous, "unresolved": true.

### Additional rules:
- Empty cells → null. Do NOT add "Dr." prefix (imaging uses plain names).
- Strip "(F1 - ...)", "(ext)", role labels from output.
- Preserve "shift" field exactly (am/pm or empty).

## Output
Return ONLY a JSON array. Each element:
{{"date":"<date>","shift":"<am|pm|empty>","first":"Full Name","second":"Full Name","third":"Full Name"}}
Use null for empty cells. No explanation, just the JSON array."""

def _radiology_format_row(r):
    return f'{r.get("date","")}\t{r.get("shift","")}\t{r.get("first","")}\t{r.get("second","")}\t{r.get("third","")}'

SPECIALTY_CONFIGS['radiology_oncall'] = {
    'prompt': _radiology_prompt,
    'format_row': _radiology_format_row,
    'batch_size': 10,
    'use_cache': False,
}

# ── HOSPITALIST ───────────────────────────────────────────────

def _hospitalist_prompt(contact_lines, schedule_lines):
    return f"""You are a medical schedule parser for the Hospitalist Oncology ER duty rota.

## Contact List (full names with phone numbers):
{contact_lines}

## Schedule Table
Columns: Date | Oncology ER Day (08:00-20:00) | Oncology ER Night (20:00-08:00)

Data:
{schedule_lines}

## Task
Match each abbreviated name to the correct full name from the contact list.

### Matching rules:
1. **Full name**: match as complete name.
2. **Last name only** (e.g. "Elrayess"): find the contact whose last name matches.
3. **Abbreviated** (e.g. "Dr. Hassan"): match by first name.

### Additional rules:
- Empty cells → null. Always include "Dr." prefix.
- If uncertain → "unresolved": true.
- Strip role labels from output.

## Output
Return ONLY a JSON array. Each element:
{{"date":"<date>","onc_er_day":"Dr. Full Name","onc_er_night":"Dr. Full Name"}}
Use null for empty cells. No explanation, just the JSON array."""

def _hospitalist_format_row(r):
    return f'{r.get("date","")}\t{r.get("onc_er_day","")}\t{r.get("onc_er_night","")}'

SPECIALTY_CONFIGS['hospitalist'] = {
    'prompt': _hospitalist_prompt,
    'format_row': _hospitalist_format_row,
    'batch_size': 15,
    'use_cache': False,
}


# ═══════════════════════════════════════════════════════════════
# CORE: resolve names via Claude
# ═══════════════════════════════════════════════════════════════

def resolve_names(specialty, schedule_rows, contacts):
    """Call Claude Haiku to resolve abbreviated names. Routes by specialty."""
    import anthropic

    api_key = os.environ.get('ANTHROPIC_API_KEY', '')
    if not api_key:
        return None

    config = SPECIALTY_CONFIGS.get(specialty)
    if not config:
        print(f'[LLM] Unknown specialty: {specialty}')
        return None

    contact_lines = '\n'.join(
        f'- {name}: {phone}' for name, phone in contacts.items() if phone
    ) or '(no contacts extracted)'

    client = anthropic.Anthropic(api_key=api_key)
    all_resolved = []
    batch_size = config['batch_size']

    for i in range(0, len(schedule_rows), batch_size):
        batch = schedule_rows[i:i + batch_size]

        schedule_lines = '\n'.join(config['format_row'](r) for r in batch)
        prompt = config['prompt'](contact_lines, schedule_lines)

        message = client.messages.create(
            model='claude-haiku-4-5-20251001',
            max_tokens=1024,
            messages=[{'role': 'user', 'content': prompt}],
        )

        response_text = message.content[0].text.strip()
        if response_text.startswith('```'):
            response_text = re.sub(r'^```(?:json)?\s*', '', response_text)
            response_text = re.sub(r'\s*```$', '', response_text)

        try:
            batch_result = json.loads(response_text)
            if isinstance(batch_result, list):
                all_resolved.extend(batch_result)
                print(f'[LLM] {specialty} batch {i//batch_size + 1}: {len(batch_result)} rows')
        except json.JSONDecodeError:
            print(f'[LLM] {specialty} batch {i//batch_size + 1}: JSON parse failed')

    return all_resolved


# ═══════════════════════════════════════════════════════════════
# HANDLER
# ═══════════════════════════════════════════════════════════════

class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            length = int(self.headers.get('Content-Length', 0))
            body = json.loads(self.rfile.read(length))
            specialty = body.get('specialty', '')
            schedule_rows = body.get('schedule_rows', [])
            contacts = body.get('contacts', {})
            file_hash = body.get('pdf_hash', '')
            force = body.get('force', False)

            if not schedule_rows or not specialty:
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({'error': 'Missing specialty or schedule_rows'}).encode())
                return

            # Cache check (medicine_on_call only)
            config = SPECIALTY_CONFIGS.get(specialty, {})
            if config.get('use_cache') and file_hash and not force:
                cached = cache_lookup(file_hash, specialty)
                if cached is not None:
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/json')
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.end_headers()
                    self.wfile.write(json.dumps({'rows': cached, '_fromCache': True}).encode())
                    return

            result = resolve_names(specialty, schedule_rows, contacts)

            if result is None:
                self.send_response(503)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({'error': 'No API key or unknown specialty'}).encode())
                return

            # Cache save
            if config.get('use_cache') and file_hash:
                cache_save(file_hash, specialty, result)

            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            # Medicine returns {rows, _fromCache} for compatibility; others return array
            if specialty == 'medicine_on_call':
                self.wfile.write(json.dumps({'rows': result, '_fromCache': False}).encode())
            else:
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
