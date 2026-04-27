"""
Vercel serverless function: Use Claude API to resolve abbreviated doctor names
from the medicine on-call schedule table against the contact list.

Receives: pdfplumber-extracted schedule rows + contact list (full names + phones)
Returns: schedule rows with abbreviated names replaced by full names
"""
from http.server import BaseHTTPRequestHandler
import json, os, re


def resolve_names_with_llm(schedule_rows, contacts):
    """Call Claude Haiku to resolve abbreviated names to full names."""
    import anthropic

    api_key = os.environ.get('ANTHROPIC_API_KEY', '')
    if not api_key:
        return None  # no API key -> caller falls back to client-side

    # Format contacts for the prompt
    contact_lines = '\n'.join(
        f'- {name}: {phone}' for name, phone in contacts.items()
    ) or '(no contacts extracted)'

    # Format schedule rows as tab-separated table
    schedule_lines = '\n'.join(
        f'{r.get("date","")}\t{r.get("jw_day","")}\t{r.get("jw_night","")}\t{r.get("jer_day","")}\t{r.get("jer_night","")}\t{r.get("sr_day","")}\t{r.get("sr_night","")}'
        for r in schedule_rows
    )

    prompt = f"""You are a medical schedule parser for the Department of Medicine in-house on-call rota.

## Contact List (full names with phone numbers):
{contact_lines}

## Schedule Table
Columns: Date | JW Day | JW Night | JER Day | JER Night | Sr Day | Sr Night

- JW = Junior Ward (7:30 AM - 9:00 PM day, 9:00 PM - 7:30 AM night)
- JER = Junior ER (same shift times)
- Sr = Senior ER (same shift times)

Seniority mapping:
- Senior columns (sr_day, sr_night) are staffed by Resident 3 or Resident 4 level doctors
- Junior columns (jer_day, jer_night, jw_day, jw_night) are staffed by Resident 1 or Resident 2 level doctors
- Use this to disambiguate when multiple contacts share the same first name

Data:
{schedule_lines}

## Task
Match each abbreviated name in the schedule to the correct full name from the contact list.
Rules:
- Names like "M.Alahmad" match "Mahdi Alahmad" or similar — pick the best match
- "Bushra" matches a contact containing "Bushra" in their name
- Initial.Lastname patterns: "H.Darwish" = "Hussain Ali Aldarwish", "F.Alsaeed" = "Fatimah Alsaeed"
- CRITICAL: When multiple contacts share the same first name (e.g. three doctors named "Lama"), use the column position to pick the correct one. A "Lama" in sr_day/sr_night is a senior resident, not a junior one.
- If a cell is empty, return null for that field
- Always include "Dr." prefix in the output names
- If you cannot confidently match a name, return the original text with "Dr." prefix AND set "unresolved": true on that row

## Output
Return ONLY a JSON array. Each element:
{{"date":"<original date>","jw_day":"Dr. Full Name","jw_night":"Dr. Full Name","jer_day":"Dr. Full Name","jer_night":"Dr. Full Name","sr_day":"Dr. Full Name","sr_night":"Dr. Full Name"}}
Use null for empty cells. Add "unresolved": true to any row where you are not confident about a match. No explanation, just the JSON array."""

    client = anthropic.Anthropic(api_key=api_key)
    message = client.messages.create(
        model='claude-haiku-4-5-20251001',
        max_tokens=8192,
        messages=[{'role': 'user', 'content': prompt}],
    )

    # Extract JSON from response
    response_text = message.content[0].text.strip()
    # Handle case where response is wrapped in ```json ... ```
    if response_text.startswith('```'):
        response_text = re.sub(r'^```(?:json)?\s*', '', response_text)
        response_text = re.sub(r'\s*```$', '', response_text)

    return json.loads(response_text)


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
