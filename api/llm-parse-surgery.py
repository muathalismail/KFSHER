"""
Vercel serverless function: Use Claude API to resolve abbreviated doctor names
from the surgery schedule table against the contact list.

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
        return None  # no API key → caller falls back to regex

    # Format contacts for the prompt
    contact_lines = '\n'.join(
        f'- {name}: {phone}' for name, phone in contacts.items()
    ) or '(no contacts extracted)'

    # Format schedule rows
    schedule_lines = '\n'.join(
        f'{r.get("date","")}\t{r.get("jr_er","")}\t{r.get("sr_er","")}\t{r.get("gs_assoc","")}\t{r.get("gs_consult","")}'
        for r in schedule_rows
    )

    prompt = f"""You are a medical schedule parser for a surgery department.

## Contact List (full names with phone numbers):
{contact_lines}

## Schedule Table (columns: Date, Junior ER, Senior ER, GS Associate, GS Consultant):
{schedule_lines}

## Task
Match each abbreviated name in the schedule to the correct full name from the contact list.
Rules:
- "AhmadS" likely matches "Ahmad Saeed" or "Ahmad Shami" — pick the best match
- Names may be concatenated without spaces: "OmarB" = "Omar Baasim"
- If a cell is empty, return null for that role
- If two doctors share a cell (separated by / or &), return both names joined with " / "
- Always include "Dr." prefix in the output names
- If you cannot confidently match a name, return the original text with "Dr." prefix

## Output
Return ONLY a JSON array. Each element:
{{"date":"<original date>","jr_er":"Dr. Full Name","sr_er":"Dr. Full Name","gs_assoc":"Dr. Full Name","gs_consult":"Dr. Full Name"}}
Use null for empty cells. No explanation, just the JSON array."""

    client = anthropic.Anthropic(api_key=api_key)
    message = client.messages.create(
        model='claude-haiku-4-5-20251001',
        max_tokens=4096,
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
