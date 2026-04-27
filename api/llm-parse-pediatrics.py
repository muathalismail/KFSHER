"""
Vercel serverless function: Use Claude API to resolve abbreviated doctor names
from the pediatrics schedule table against the contact list.

Receives: pdfplumber-extracted schedule rows + contact list (full names + phones)
Returns: schedule rows with abbreviated names replaced by full names
"""
from http.server import BaseHTTPRequestHandler
import json, os, re


def _clean_contact_name(name):
    """Strip 'Resident', 'Consultant', trailing dashes/noise from contact names."""
    name = re.sub(r'\s*\b(Resident|Consultant|Fellow|Associate)\b\s*\d*\s*', ' ', name, flags=re.I)
    name = re.sub(r'\s*-\s*$', '', name)
    name = re.sub(r'\s+', ' ', name).strip()
    return name


_BATCH_SIZE = 7


def _build_prompt(contact_lines, schedule_lines):
    """Build the Claude prompt for a batch of schedule rows."""
    return f"""You are a medical schedule parser for the Pediatrics Department duty rota.

## Contact List (full names with phone numbers):
{contact_lines}

## Schedule Table
Columns: Date | 1st OnCall | 2nd OnCall | 3rd OnCall | Hospitalist ER | Hospitalist Ward-E | Hospitalist Ward-E and ER

- 1st OnCall: Resident on-call 3:30 PM - 7:30 AM
- 2nd OnCall: Resident on-call 24 hours (7:30 AM - 7:30 AM)
- 3rd OnCall: Consultant on-call (may be empty on many dates)
- Hospitalist ER: KFSH ER coverage 7:30 AM - 4:30 PM
- Hospitalist Ward-E: Ward-E only 7:30 AM - 4:30 PM
- Hospitalist Ward-E and ER: Ward-E and ER coverage 4:30 PM - 7:30 AM

Data:
{schedule_lines}

## Task
Match each name in the schedule to the correct full name from the contact list.

### Matching rules (apply in this priority order):

1. **Full name already present** (e.g. "Tahirah AlGarrous", "Manal Samater", "Ahmed Abuelazz"):
   - Match as a COMPLETE name — find the contact whose full name matches.
   - Do NOT split the name or use only the first word.
   - "Tahirah AlGarrous" matches a contact with "Tahirah" AND "AlGarrous" (or similar spelling).

2. **Abbreviated Dr. name** (e.g. "Dr Sherifah", "Dr Reem", "Dr Alaa", "Dr Abdulrahim"):
   - Strip the "Dr" / "Dr." prefix, then match the remaining name as a first name.
   - "Dr Sherifah" → find a contact whose first name is "Sherifah".
   - "Dr Abdulazeem" → find a contact whose first name is "Abdulazeem" or similar.

3. **Bare first name only** (e.g. "Roa", "Lamia"):
   - Match by first name — find the contact whose FIRST NAME matches.
   - If multiple contacts share that first name, mark as "unresolved": true.

4. **Multi-doctor cells** (e.g. "Dr.Abeer/Dr.Amal"):
   - Split on "/" and resolve each name separately.
   - Return both names joined with " / " in the output.

### Additional rules:
- If a cell is empty, return null for that field.
- Always include "Dr." prefix in the output names.
- If you cannot confidently match a name, return the original text with "Dr." prefix AND set "unresolved": true on that row.
- NEVER guess — unresolved is safer than wrong.
- If a cell contains phone numbers or IDs instead of names, return null for that field.

## Output
Return ONLY a JSON array. Each element:
{{"date":"<original date>","first_oncall":"Dr. Full Name","second_oncall":"Dr. Full Name","third_oncall":"Dr. Full Name","hospitalist_er":"Dr. Full Name","hospitalist_ward":"Dr. Full Name","hospitalist_after":"Dr. Full Name"}}
Use null for empty cells. Add "unresolved": true to any row where you are not confident about a match. No explanation, just the JSON array."""


def resolve_names_with_llm(schedule_rows, contacts):
    """Call Claude Haiku to resolve abbreviated names to full names.
    Splits into batches of _BATCH_SIZE rows to keep output reliable."""
    import anthropic

    api_key = os.environ.get('ANTHROPIC_API_KEY', '')
    if not api_key:
        return None  # no API key -> caller falls back to client-side

    # Clean contact names: strip "Resident", "Consultant", trailing dashes
    cleaned_contacts = {}
    for name, phone in contacts.items():
        cleaned = _clean_contact_name(name)
        if cleaned and phone:
            cleaned_contacts[cleaned] = phone

    # Format contacts for the prompt (shared across all batches)
    contact_lines = '\n'.join(
        f'- {name}: {phone}' for name, phone in cleaned_contacts.items()
    ) or '(no contacts extracted)'

    client = anthropic.Anthropic(api_key=api_key)
    all_resolved = []

    # Process in batches of _BATCH_SIZE rows
    for i in range(0, len(schedule_rows), _BATCH_SIZE):
        batch = schedule_rows[i:i + _BATCH_SIZE]

        schedule_lines = '\n'.join(
            f'{r.get("date","")}\t{r.get("first_oncall","")}\t{r.get("second_oncall","")}\t{r.get("third_oncall","")}\t{r.get("hospitalist_er","")}\t{r.get("hospitalist_ward","")}\t{r.get("hospitalist_after","")}'
            for r in batch
        )

        prompt = _build_prompt(contact_lines, schedule_lines)

        message = client.messages.create(
            model='claude-haiku-4-5-20251001',
            max_tokens=4096,
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

            if not schedule_rows:
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({'error': 'No schedule rows'}).encode())
                return

            result = resolve_names_with_llm(schedule_rows, contacts)

            if result is None:
                self.send_response(503)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({'error': 'No API key configured'}).encode())
                return

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
