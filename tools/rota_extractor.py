#!/usr/bin/env python3
"""
MISC Imaging Duty Rota Extractor — coordinate-based parsing via pdfplumber.

Extracts 4 targets from the weekly MISC DUTY ROTA PDF:
  NEURO:    CT (In-Patient & ER)
  BODY:     Ultrasound
  BODY:     CT (In-Patient & ER)
  THORACIC: CT/MRI (In-Pt & ER)
"""

import pdfplumber
import re
from collections import defaultdict

SEARCH_ALIASES = {
    ('NEURO', 'CT'): ['ct brain', 'ct head', 'ct neuro', 'neuro ct', 'ct in-patient neuro'],
    ('BODY', 'Ultrasound'): ['us abdomen', 'us abdominal', 'us body', 'body', 'dvt', 'ultrasound'],
    ('BODY', 'CT'): ['ct abdomen', 'ct abdominal', 'ct body', 'body ct', 'body-ct'],
    ('THORACIC', 'CT/MRI'): ['ct chest', 'chest', 'ct pe', 'pe', 'pulmonary embolism', 'thoracic ct'],
}

TARGETS = [
    {'section': 'NEURO', 'match': lambda m: 'ct' in m and ('in-pa' in m or 'er' in m) and 'out' not in m and 'mri' not in m},
    {'section': 'BODY', 'match': lambda m: 'ultrasound' in m},
    {'section': 'BODY', 'match': lambda m: 'ct' in m and ('in-pa' in m or 'er' in m) and 'out' not in m and 'mri' not in m},
    {'section': 'THORACIC', 'match': lambda m: ('ct' in m or 'mri' in m) and ('in-pt' in m or 'er' in m) and 'out' not in m and 'cardiac' not in m},
]

SECTION_NAMES = ['NEURO', 'BODY', 'THORACIC', 'PEDIA', 'MSK', 'BREAST',
                 'MOLECULAR', 'INTERVENTIONAL', 'IR']


def _normalize(s):
    return re.sub(r'[^a-z0-9/ ]', ' ', (s or '').lower()).strip()


def _parse_names(raw):
    if not raw or raw.strip() in ('-', '--', ''):
        return []
    parts = re.split(r'[|/,]', raw)
    result, seen = [], set()
    for p in parts:
        p = p.strip()
        if p and p not in ('-', '--', '') and p not in seen:
            result.append(p)
            seen.add(p)
    return result


def _get_aliases(section, modality):
    norm = _normalize(modality)
    for (sec, mod_key), aliases in SEARCH_ALIASES.items():
        if sec == section and mod_key.lower() in norm:
            return aliases
    return []


def _extract_words(page):
    return sorted(
        page.extract_words(keep_blank_chars=False, use_text_flow=False),
        key=lambda w: (round(w['top'], 0), w['x0'])
    )


def _group_into_rows(words, x_min, x_max, y_min=55, y_max=900, y_gap=5):
    """Group words in an x-range into rows by y-proximity."""
    filtered = sorted(
        [w for w in words if x_min <= w['x0'] < x_max and y_min < w['top'] < y_max],
        key=lambda w: w['top']
    )
    rows = []
    cur, cur_y = [], None
    for w in filtered:
        if cur_y is not None and abs(w['top'] - cur_y) > y_gap:
            if cur:
                rows.append({'y': cur_y, 'text': ' '.join(ww['text'] for ww in cur)})
            cur = []
        cur.append(w)
        cur_y = w['top']
    if cur:
        rows.append({'y': cur_y, 'text': ' '.join(ww['text'] for ww in cur)})
    return rows


def _build_column_map(words):
    """Build day→(AM, PM) x-ranges from header words."""
    day_words = sorted(
        [w for w in words if w['top'] < 52 and w['text'] in
         ('Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday')],
        key=lambda w: w['x0']
    )
    date_words = sorted(
        [w for w in words if w['top'] < 52 and re.match(r'\d{1,2}-\w{3}', w['text'])],
        key=lambda w: w['x0']
    )
    am_words = sorted([w for w in words if w['text'] == 'AM' and w['top'] < 60], key=lambda w: w['x0'])
    pm_words = sorted([w for w in words if w['text'] == 'PM' and w['top'] < 60], key=lambda w: w['x0'])

    if len(am_words) != 5 or len(pm_words) != 5:
        return []

    days = []
    for i in range(5):
        day_name = day_words[i]['text'] if i < len(day_words) else f'Day{i}'
        date_text = date_words[i]['text'] if i < len(date_words) else ''
        m = re.match(r'(\d{1,2})-(\w{3})', date_text)
        if m:
            dn = int(m.group(1))
            mon = {'jan':1,'feb':2,'mar':3,'apr':4,'may':5,'jun':6,
                   'jul':7,'aug':8,'sep':9,'oct':10,'nov':11,'dec':12}.get(m.group(2).lower(), 4)
            date_str = f'2026-{mon:02d}-{dn:02d}'
        else:
            date_str = date_text

        am_x, pm_x = am_words[i]['x0'], pm_words[i]['x0']
        am_end = (am_x + pm_x) / 2 + 15
        pm_end = ((pm_x + am_words[i + 1]['x0']) / 2 + 10) if i < 4 else 850

        days.append({
            'day': day_name, 'date': date_str,
            'am': (am_x - 15, am_end), 'pm': (am_end, pm_end),
        })
    return days


def _get_cell_text(words, y_lo, y_hi, x_lo, x_hi):
    """
    Get text from words in a y/x box.
    Words on different y-lines (>3 units apart) are joined with ' | '
    to preserve multi-line cell structure (e.g. two consultants on separate lines).
    Words on the same y-line are joined with ' '.
    """
    matches = sorted(
        [w for w in words if y_lo <= w['top'] < y_hi and x_lo <= w['x0'] < x_hi],
        key=lambda w: (round(w['top'], 0), w['x0'])
    )
    if not matches:
        return ''
    lines = []
    cur_line, cur_y = [], None
    for w in matches:
        if cur_y is not None and abs(w['top'] - cur_y) > 3:
            lines.append(' '.join(cur_line))
            cur_line = []
        cur_line.append(w['text'])
        cur_y = w['top']
    if cur_line:
        lines.append(' '.join(cur_line))
    return ' | '.join(lines)


def _detect_sections(words):
    """
    Find section headers and their y-ranges on a page.

    Section labels sit in a left column (x < 50) at the VERTICAL CENTER
    of their section span — not at the top. So "NEURO" at y=156 means
    NEURO rows span roughly from the top of the page to the midpoint
    between NEURO and the next section (BODY).

    Strategy: use midpoints between consecutive section labels as boundaries,
    and extend the first section up to the page top and the last down to page bottom.
    """
    section_words = sorted(
        [w for w in words if w['x0'] < 50 and w['top'] > 50
         and w['text'].upper() in SECTION_NAMES],
        key=lambda w: w['top']
    )
    if not section_words:
        return [{'name': None, 'y_start': 50, 'y_end': 900}]

    sections = []
    for i, sw in enumerate(section_words):
        # Start: midpoint between previous section and this one (or page top)
        if i == 0:
            y_start = 50
        else:
            y_start = (section_words[i - 1]['top'] + sw['top']) / 2

        # End: midpoint between this section and next one (or page bottom)
        if i < len(section_words) - 1:
            y_end = (sw['top'] + section_words[i + 1]['top']) / 2
        else:
            y_end = 900

        sections.append({'name': sw['text'].upper(), 'y_start': y_start, 'y_end': y_end})

    return sections


def _get_section_at(y, sections):
    """Which section does a y-position belong to?"""
    for s in sections:
        if s['y_start'] <= y <= s['y_end']:
            return s['name']
    return None


def _extract_page_targets(page, column_map):
    """Extract target records from one page."""
    words = _extract_words(page)
    if not column_map:
        return []

    sections = _detect_sections(words)

    # Group specialty column words into rows
    # Use narrower x-range (50-145) to avoid data words that start near x=160+
    spec_rows = _group_into_rows(words, 50, 145)

    records = []
    current_specialty = None
    current_specialty_y = None

    for row in spec_rows:
        text = row['text']
        text_lower = text.lower()
        section = _get_section_at(row['y'], sections)

        # Detect row type
        if text_lower.startswith('resident'):
            row_type = 'residents'
        elif text_lower.startswith('fellow'):
            row_type = 'fellow'
        elif text_lower.startswith('assistant') or text_lower.startswith('associate'):
            row_type = 'assistant'
        elif len(text) > 3 and not text.isdigit():
            row_type = 'specialty'
        else:
            continue

        if row_type == 'specialty':
            current_specialty = text
            current_specialty_y = row['y']

            # Find the NEXT row's y to use as boundary (instead of fixed +12)
            row_idx = spec_rows.index(row)
            next_y = spec_rows[row_idx + 1]['y'] if row_idx < len(spec_rows) - 1 else row['y'] + 15
            y_hi = min(row['y'] + 15, next_y - 1)

            if section:
                norm_mod = _normalize(current_specialty)
                for target in TARGETS:
                    if target['section'] == section and target['match'](norm_mod):
                        aliases = _get_aliases(section, current_specialty)
                        for d in column_map:
                            for shift, (xlo, xhi) in [('AM', d['am']), ('PM', d['pm'])]:
                                # Consultant names can appear slightly ABOVE the specialty label
                                cell = _get_cell_text(words, row['y'] - 8, y_hi, xlo, xhi)
                                names = _parse_names(cell)
                                key = (d['date'], shift, section, current_specialty)
                                records.append({
                                    '_key': key, 'date': d['date'], 'day': d['day'],
                                    'shift': shift, 'section': section,
                                    'modality': current_specialty,
                                    'search_aliases': aliases,
                                    'consultant': names, 'residents': [],
                                    'fellow': [], 'assistant_associate': [],
                                    'phones': {},
                                })
                        break

        elif row_type in ('residents', 'fellow', 'assistant') and current_specialty and section:
            role_key = {'residents': 'residents', 'fellow': 'fellow', 'assistant': 'assistant_associate'}[row_type]
            norm_mod = _normalize(current_specialty)

            row_idx = spec_rows.index(row)
            next_y = spec_rows[row_idx + 1]['y'] if row_idx < len(spec_rows) - 1 else row['y'] + 15
            y_hi = min(row['y'] + 15, next_y - 1)

            for target in TARGETS:
                if target['section'] == section and target['match'](norm_mod):
                    for d in column_map:
                        for shift, (xlo, xhi) in [('AM', d['am']), ('PM', d['pm'])]:
                            cell = _get_cell_text(words, row['y'] - 3, y_hi, xlo, xhi)
                            names = _parse_names(cell)
                            key = (d['date'], shift, section, current_specialty)
                            rec = next((r for r in records if r['_key'] == key), None)
                            if rec:
                                rec[role_key] = names
                    break

    return records


def _extract_contacts(pdf):
    """Extract name→phone from all contact sub-tables."""
    contacts = {}
    phone_re = re.compile(r'^0?5\d{8}$')

    for page in pdf.pages:
        words = _extract_words(page)
        for w in words:
            raw = w['text'].replace(' ', '').replace('-', '')
            if not phone_re.match(raw):
                continue
            phone = ('0' + raw[-9:]) if not raw.startswith('0') else raw[:10]
            if not re.match(r'^05\d{8}$', phone):
                continue
            # Find name words at same y, to the left
            name_words = sorted(
                [nw for nw in words
                 if abs(nw['top'] - w['top']) < 4
                 and nw['x0'] < w['x0'] - 20
                 and len(nw['text']) > 1
                 and not nw['text'].isdigit()
                 and not re.match(r'^\d', nw['text'])],
                key=lambda nw: nw['x0']
            )
            if name_words:
                name = ' '.join(nw['text'] for nw in name_words)
                name = re.sub(r'\s*\([^)]*\)\s*$', '', name).strip()
                if name and len(name) > 2:
                    contacts[name] = phone
    return contacts


def _resolve_phone(name, contacts):
    def norm(n):
        return re.sub(r'^dr\.?\s*', '', n.lower().strip())

    def last_core(n):
        parts = norm(n).split()
        meaningful = [p for p in parts if p not in ('al', 'al-', 'el')]
        return meaningful[-1] if meaningful else (parts[-1] if parts else '')

    # Exact
    nn = norm(name)
    for cn, ph in contacts.items():
        if norm(cn) == nn:
            return ph

    # Last name
    tgt = last_core(name)
    if len(tgt) >= 3:
        matches = [(cn, ph) for cn, ph in contacts.items() if last_core(cn) == tgt]
        if len(matches) == 1:
            return matches[0][1]

    # Initial + last
    m = re.match(r'^([A-Z])\.?\s*(.+)$', name.strip())
    if m:
        initial, rest = m.group(1).lower(), norm(m.group(2))
        rest_core = re.sub(r'^al[- ]?', '', rest)
        if len(rest_core) >= 3:
            matches = []
            for cn, ph in contacts.items():
                cn_parts = norm(cn).split()
                cn_core = re.sub(r'^al[- ]?', '', last_core(cn))
                if cn_parts and cn_parts[0].startswith(initial) and (
                        rest_core in cn_core or cn_core in rest_core):
                    matches.append((cn, ph))
            if len(matches) == 1:
                return matches[0][1]

    return ''


def extract_rota(pdf_path):
    """Main entry point."""
    with pdfplumber.open(pdf_path) as pdf:
        first_words = _extract_words(pdf.pages[0])
        column_map = _build_column_map(first_words)
        if not column_map:
            raise ValueError("Could not detect day/AM/PM column structure")

        contacts = _extract_contacts(pdf)

        all_records = []
        for page in pdf.pages:
            all_records.extend(_extract_page_targets(page, column_map))

        # Dedupe
        seen = set()
        deduped = []
        for r in all_records:
            if r['_key'] not in seen:
                seen.add(r['_key'])
                deduped.append(r)

        # Resolve phones + enforce role exclusivity
        for rec in deduped:
            all_names = set()
            for role in ['consultant', 'residents', 'fellow', 'assistant_associate']:
                all_names.update(rec[role])
            for name in all_names:
                rec['phones'][name] = _resolve_phone(name, contacts)

            # Exclusivity: each name appears in at most one role
            # Priority: consultant > residents > fellow > assistant_associate
            used = set(rec['consultant'])
            for role in ['residents', 'fellow', 'assistant_associate']:
                rec[role] = [n for n in rec[role] if n not in used]
                used.update(rec[role])

            del rec['_key']

        return deduped


if __name__ == '__main__':
    import sys, json
    pdf = sys.argv[1] if len(sys.argv) > 1 else \
        '/Users/Muath/Downloads/MISC DUTY ROTA 12-16 April 2026 (Week 2) 1.pdf'
    records = extract_rota(pdf)
    print(json.dumps(records, indent=2, ensure_ascii=False))
    print(f"\n=== VALIDATION ===")
    print(f"Total records: {len(records)}")
    for s in sorted({r['section'] for r in records}):
        mods = {r['modality'] for r in records if r['section'] == s}
        for m in mods:
            cnt = sum(1 for r in records if r['section'] == s and r['modality'] == m)
            print(f"  {s} / {m}: {cnt} records")
    ec = sum(1 for r in records if not r['consultant'])
    print(f"Empty consultant: {ec}")
    phones = {}
    for r in records:
        phones.update(r.get('phones', {}))
    np = sum(1 for v in phones.values() if not v)
    print(f"No phone: {np}/{len(phones)}")
