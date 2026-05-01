"""
Regression test: verifies existing specialty extractions match baseline.
Run: python3 tests/regression_test.py
"""
import json, os, sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from importlib import util

def load_mod(path):
    spec = util.spec_from_file_location('mod_' + os.path.basename(path).replace('.','_'), path)
    mod = util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def get_extractors():
    et = load_mod(os.path.join(ROOT, 'api/extract-table.py'))
    em = load_mod(os.path.join(ROOT, 'api/extract-medicine-oncall.py'))
    er = load_mod(os.path.join(ROOT, 'api/extract-radiology-oncall.py'))
    es = load_mod(os.path.join(ROOT, 'api/extract-surgery.py'))
    return {
        'medicine_on_call': lambda b: em.extract_medicine_oncall_table(b),
        'surgery': lambda b: es.extract_surgery_table(b),
        'radiology_oncall': lambda b: er.extract_radiology_oncall_table(b),
        'hospitalist': lambda b: et.extract_table_rows(b, 'hospitalist')['rows'],
        'ent': lambda b: et.extract_table_rows(b, 'ent')['rows'],
        'orthopedics': lambda b: et.extract_table_rows(b, 'orthopedics')['rows'],
        'neurosurgery': lambda b: et.extract_table_rows(b, 'neurosurgery')['rows'],
        'spine': lambda b: et.extract_table_rows(b, 'spine')['rows'],
        'hematology': lambda b: et.extract_table_rows(b, 'hematology')['rows'],
        'kptx': lambda b: et.extract_table_rows(b, 'kptx')['rows'],
        'liver': lambda b: et.extract_table_rows(b, 'liver')['rows'],
        'pediatrics': lambda b: et.extract_table_rows(b, 'pediatrics')['rows'],
    }

def run():
    with open(os.path.join(ROOT, 'tests/baseline.json')) as f:
        baseline = json.load(f)

    extractors = get_extractors()
    passed = 0
    failed = 0
    skipped = 0

    for key, bl in baseline.items():
        if bl.get('method') == 'rotas_builtin' or bl.get('error'):
            print(f'  ⚪ {key}: skipped (ROTAS only)')
            skipped += 1
            continue

        if key not in extractors:
            print(f'  ⚪ {key}: skipped (no extractor)')
            skipped += 1
            continue

        pdf_path = os.path.join(ROOT, 'assets/pdfs', bl.get('pdf', ''))
        if not os.path.exists(pdf_path):
            print(f'  ⚪ {key}: skipped (PDF not found)')
            skipped += 1
            continue

        try:
            with open(pdf_path, 'rb') as f:
                rows = extractors[key](f.read())

            expected_rows = bl['rows_count']
            actual_rows = len(rows)

            if actual_rows < expected_rows * 0.9:
                print(f'  ❌ {key}: REGRESSION — rows dropped from {expected_rows} to {actual_rows}')
                failed += 1
            elif actual_rows > expected_rows * 1.1:
                print(f'  ⚠️  {key}: rows increased from {expected_rows} to {actual_rows} (check manually)')
                passed += 1
            else:
                print(f'  ✅ {key}: {actual_rows} rows (baseline: {expected_rows})')
                passed += 1
        except Exception as e:
            print(f'  ❌ {key}: ERROR — {e}')
            failed += 1

    print(f'\n{"="*50}')
    print(f'Results: {passed} passed, {failed} failed, {skipped} skipped')
    if failed > 0:
        print('❌ REGRESSION DETECTED — do NOT deploy')
        sys.exit(1)
    else:
        print('✅ All clear — safe to deploy')
        sys.exit(0)

if __name__ == '__main__':
    run()
