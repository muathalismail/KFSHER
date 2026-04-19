#!/usr/bin/env python3
"""
Imaging On-Duty Validator — pdfplumber cross-check for MISC Duty Rota.
SCOPED TO: Imaging On-Duty (radiology_duty) ONLY.

Usage:
    from imaging_on_duty_validator import validate_with_pdfplumber
    corrected = validate_with_pdfplumber(pdf_path, current_extraction)

Or standalone:
    python3 imaging_on_duty_validator.py <pdf_path>
"""

import pdfplumber
import re
import json
import sys
import os

# Section-locked doctors
SECTION_LOCKS = {
    'a. dhafiri': 'MSK',
    'ahmed al dhafiri': 'MSK',
    'fatimah albahhar': 'MSK',
    'hassan ghafouri': 'MSK',
}

INVALID_FRAGMENTS = {'F.', 'A.', 'N.', 'H.', 'M.', 'S.', 'K.', 'R.', 'T.', 'E.',
                     'Al', 'Al-', 'Dr.', 'Dr'}


def _is_imaging_duty_pdf(pdf_path):
    """Detect if PDF is an Imaging On-Duty rota."""
    name = os.path.basename(pdf_path).upper()
    return any(k in name for k in ['MISC', 'IMAGING', 'WEEKLY DUTY ROTA', 'MISC DUTY'])


def validate_with_pdfplumber(pdf_path, current_extraction):
    """
    Cross-check and correct Imaging On-Duty extraction using pdfplumber.
    Returns corrected data in the SAME format as input.
    """
    if not _is_imaging_duty_pdf(pdf_path):
        return current_extraction

    corrections = []

    try:
        # Import the extractor for ground-truth comparison
        sys.path.insert(0, os.path.dirname(__file__))
        from rota_extractor import extract_rota
        ground_truth = extract_rota(pdf_path)
    except Exception as e:
        print(f"[IMAGING VALIDATOR] pdfplumber extraction failed: {e}")
        return current_extraction

    # Build lookup from ground truth: (date, shift, section) → record
    gt_lookup = {}
    for r in ground_truth:
        key = (r['date'], r['shift'], r['section'])
        gt_lookup[key] = r

    corrected = []
    for record in current_extraction:
        r = dict(record)

        # 1. Section boundary check
        name_lower = (r.get('name', '') or '').lower()
        section = (r.get('section', '') or '').upper()
        for doc_name, locked_section in SECTION_LOCKS.items():
            if doc_name in name_lower and section != locked_section.upper():
                corrections.append({
                    'type': 'section_leak',
                    'name': r.get('name'),
                    'found_in': section,
                    'belongs_to': locked_section,
                })
                r['name'] = ''

        # 2. Name fragment cleanup
        name = (r.get('name', '') or '').strip()
        if name in INVALID_FRAGMENTS:
            corrections.append({
                'type': 'name_fragment',
                'fragment': name,
            })
            r['name'] = ''

        # 3. Phone format check
        phone = (r.get('phone', '') or '').replace('-', '').replace(' ', '')
        if phone and not re.match(r'^05\d{8}$', phone):
            corrections.append({
                'type': 'bad_phone',
                'name': r.get('name'),
                'phone': r.get('phone'),
            })
            r['phone'] = ''
            r['phoneUncertain'] = True

        if (r.get('name', '') or '').strip():
            corrected.append(r)

    if corrections:
        print(f"\n[IMAGING VALIDATOR] {len(corrections)} correction(s):")
        for c in corrections[:10]:
            print(f"  {c['type']}: {c}")

    return corrected


if __name__ == '__main__':
    pdf_path = sys.argv[1] if len(sys.argv) > 1 else None
    if not pdf_path:
        print("Usage: python3 imaging_on_duty_validator.py <pdf_path>")
        sys.exit(1)

    # Simulate: run both extractors and compare
    sys.path.insert(0, os.path.dirname(__file__))
    from rota_extractor import extract_rota

    print("=== Running pdfplumber extraction ===")
    records = extract_rota(pdf_path)

    print(f"\n=== Validation Results ===")
    print(f"Records extracted: {len(records)}")
    sections = {r['section'] for r in records}
    for s in sorted(sections):
        mods = {r['modality'] for r in records if r['section'] == s}
        for m in mods:
            cnt = sum(1 for r in records if r['section'] == s and r['modality'] == m)
            print(f"  {s} / {m}: {cnt}")

    # Check role exclusivity
    violations = 0
    for r in records:
        all_names = r['consultant'] + r['residents'] + r['fellow'] + r['assistant_associate']
        if len(all_names) != len(set(all_names)):
            violations += 1
            dups = [n for n in all_names if all_names.count(n) > 1]
            print(f"  ROLE DUP: {r['date']} {r['shift']} {r['section']}: {set(dups)}")

    # Check section locks
    for r in records:
        for role in ['consultant', 'residents', 'fellow', 'assistant_associate']:
            for name in r[role]:
                for doc, locked in SECTION_LOCKS.items():
                    if doc in name.lower() and r['section'] != locked:
                        print(f"  SECTION LEAK: {name} in {r['section']} (should be {locked})")

    print(f"\nRole violations: {violations}")
    print(f"Phone coverage: {sum(1 for r in records for p in r['phones'].values() if p)}/{sum(len(r['phones']) for r in records)}")
