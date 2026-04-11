# Regression Fixtures

This directory stores the fixture inventory for audited parser/business-logic bugs.

Rules:
- Prefer a real bundled PDF when the failure came from a real rota layout.
- Use a mock fixture only when a minimal text fragment reproduces the exact failure mode better than the full PDF.
- Every regression id in `regression-fixtures.json` should map to:
  - a named test in `assets/js/auditor.js`
  - a validator in `assets/js/auditor.js`
  - an automatic run through `Auditor.runGoldenTests()`

The current headless regression gate is:
- `tools/webview_regression_tests.swift`
- convenience wrapper: `tools/run_regression_gate.sh`

That runner fails with exit code `1` if any:
- mock/structured golden regression fails
- real-PDF snapshot regression fails
- specialty schedule rule test fails

## Real fixture layer

Minimal real-PDF snapshot fixtures live in:
- `tests/fixtures/real/manifest.json`
- `tests/fixtures/real/*.json`

Each real snapshot should contain:
- `id`
- `specialty`
- `sourcePdf`
- `pages`
- either:
  - `dateKey` + `at` + `expectedRows`
  - or `checks[]` for multiple date/time checks

The snapshot is a stable extracted expectation derived from a real PDF, not a full raw PDF copy.

## Add a new audited regression bug

1. Reproduce the bug from a real rota or uploaded PDF.
2. Add or update the parser/business-logic fix in the proper layer.
3. Add a fast baseline regression:
   - extend `BUG_REGRESSION_FIXTURES`
   - extend `REGRESSION_VALIDATORS`
   - add a named entry in `BUG_REGRESSION_TESTS`
4. If the bug is high-risk, add a real snapshot:
   - create `tests/fixtures/real/<bug-id>.json`
   - add it to `tests/fixtures/real/manifest.json`
5. If a tiny text fragment reproduces the bug better than a whole PDF page, add a mock in:
   - `tests/fixtures/mocks/`
6. Run the gate:
   - `tools/run_regression_gate.sh`

Bug workflow:
- bug found -> fixture added -> expected output added -> validator/test added -> regression gate passes
