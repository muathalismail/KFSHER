# Verification Cache System

## Overview
File-hash-based caching layer that prevents redundant Claude API calls when the same PDF is uploaded again. The cache stores Claude's resolved name results in Supabase, keyed by SHA-256 hash of the PDF file + specialty + cache version.

## How It Works

```
Upload PDF → pdfplumber extracts table → compute SHA-256 hash
  ↓
Check cache (hash + specialty + version)
  ├─ HIT  → return cached result (skip Claude) → 🔵 نتيجة محفوظة
  └─ MISS → call Claude API → save result to cache → 🟢 تم التحقق الآن
```

## When It Works / Doesn't Work

| Scenario | Cache behavior |
|---|---|
| Same PDF uploaded again | **HIT** — instant, no API call |
| Different PDF (new month/block) | **MISS** — calls Claude, saves result |
| Same PDF after VERSION bump | **MISS** — old cache invalidated |
| Same PDF after 30 days | **MISS** — TTL expired |
| VERIFICATION_CACHE_ENABLED=false | **BYPASS** — always calls Claude |
| Supabase down | **BYPASS** — calls Claude, no error |
| Non-enabled specialty | **BYPASS** — calls Claude directly |

## Enabled Specialties
Currently: `medicine_on_call` only.

To add more, edit `api/cache-config.js`:
```javascript
ENABLED_SPECIALTIES: ['medicine_on_call', 'pediatrics'],
```
Then add cache logic to the corresponding `api/llm-parse-*.py` file (copy the pattern from `llm-parse-medicine-oncall.py`).

## When to Bump VERSION

Edit `CACHE_VERSION` in `api/llm-parse-medicine-oncall.py` AND `VERSION` in `api/cache-config.js`:

1. **Claude prompt changed** — different prompt = different results
2. **Contact list format changed** — affects name resolution
3. **New disambiguation rules added** — e.g., Resident level logic
4. **Bug fix in name resolution** — old cached results may be wrong
5. **New block/month started** — not needed (different file = different hash)

## Architecture

```
Browser (app.js)
  ├─ computes SHA-256 hash of PDF bytes
  ├─ sends {schedule_rows, contacts, pdf_hash} to server
  │
Server (llm-parse-medicine-oncall.py)
  ├─ cache_lookup(hash) → Supabase SELECT (anon key, 2s timeout)
  │   ├─ HIT → return {rows, _fromCache: true}
  │   └─ MISS → continue
  ├─ resolve_names_with_llm() → Claude API (4 batches)
  ├─ cache_save(hash, result) → Supabase POST (service key)
  └─ return {rows, _fromCache: false}
```

## Security
- **Reads**: anon key (same as pdf_records)
- **Writes**: SUPABASE_SERVICE_KEY only (server-side, no public endpoint)
- **No public POST endpoint** for cache writes — prevents cache poisoning

## Environment Variables
- `VERIFICATION_CACHE_ENABLED` — `true` to enable, anything else to disable
- `SUPABASE_URL` — existing
- `SUPABASE_PUBLISHABLE_KEY` — existing (for reads)
- `SUPABASE_SERVICE_KEY` — existing (for writes)

## Force Re-verify (Development)
The Python handler accepts `force: true` in the request body to bypass cache. No UI button — use browser console or curl:
```javascript
// From browser console during upload:
// Add to the fetch body: force: true
```

## Rollback
See `ROLLBACK.md` in project root.
