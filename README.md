# KFSH-D On-Call Lookup — April 2026

Single-page hospital on-call lookup app for King Fahad Specialist Hospital - Dammam.
No server required. Open `index.html` directly in any modern browser.

---

## Quick Start

1. Unzip this archive
2. Open `index.html` in Chrome, Edge, or Firefox
3. The app loads — today's on-call doctors are shown immediately from built-in data
4. To upload a new PDF rota: tap a specialty tag → "Upload PDF"

---

## File Structure

```
on_call_look_up/
├── index.html                        ← Open this in a browser
├── README.md
├── assets/
│   ├── css/
│   │   └── styles.css                ← All UI styles
│   ├── js/
│   │   ├── app.js                    ← Main application (2 847 lines)
│   │   │                               Includes: PDF parsing, phone resolution,
│   │   │                               role detection, IndexedDB storage, UI logic
│   │   ├── auditor.js                ← Validation layer (479 lines)
│   │   │                               Runs after every PDF upload, flags issues
│   │   ├── data/
│   │   │   └── rotas.js              ← Static specialty schedules (1 217 lines)
│   │   │                               Fallback data for all 36 specialties
│   │   └── lib/                      ← (Optional) Place bundled PDF.js here
│   │       └── (pdf.min.js)          ← See "Offline / Intranet Use" below
│   │       └── (pdf.worker.min.js)
│   └── pdfs/                         ← 42 pre-loaded April 2026 rota PDFs
│       └── *.pdf
```

---

## Key Modules Inside app.js

| Function | Purpose |
|---|---|
| `buildContactMapFromText(text)` | Extracts name→phone pairs from any PDF contact table format (with or without Dr. prefix, single or multi-phone lines) |
| `resolvePhoneFromContactMap(name, map)` | Fuzzy-matches schedule names to contacts. Blocks bare first names, slash-compounds, and ambiguous single words |
| `parseGenericPdfEntries(text, deptKey)` | Generic date-table parser (ENT, Orthopedics, Hematology, etc.) |
| `parseSingleLineDateSplit(text, deptKey)` | Inline date parser for packed lines (Nephrology `dd/mm/yyyy`, Neurosurgery `N-Apr-26`, Liver `d/m/yyyy`) |
| `parseGynecologyPdfEntries(text, deptKey)` | 24H-block separator parser |
| `parseDaySequence(text, deptKey, monthYear)` | Day-name sequence parser (Surgery `WED/THU`, Ophthalmology `Wednesday`) |
| `parseAnesthesiaPdfEntries(text, deptKey)` | Abbreviation-legend parser |
| `parseMedicinePdfEntries(text, deptKey)` | Multi-subspecialty column parser |
| `parseUploadedPdf(file, deptKey)` | Routes each PDF to the correct parser based on specialty |
| `normalizeParsedEntries(entries)` | Cleans parsed names: splits Dr.X abbreviations, comma-separated names, strips day-name artifacts |

---

## Role Detection

Roles are read from each PDF's column headers when possible:
- **Header detected (≥2 roles found)**: Orthopedics, ENT, Hematology use the PDF's own labels
- **Forced layout** (fragmented headers): Nephrology, Urology, Surgery, Neurosurgery, Neurology, Gynecology always use `SPECIALTY_ROLE_LAYOUTS`

Role layouts defined in `app.js → SPECIALTY_ROLE_LAYOUTS`:
```
orthopedics:  Resident On-Call | 2nd On-Call | Associate/Pediatric | Consultant On-Call
ent:          1st On-Call | 2nd On-Call | 3rd On-Call | Consultant On-Call
urology:      Resident On-Call | 2nd On-Call | Consultant On-Call
hematology:   Resident/Fellow | Fellow 2nd | Consultant On-Call | Consultant Inpatient
nephrology:   1st On-Call | 2nd On-Call | Consultant On-Call
surgery:      Resident On-Duty (ER) | 2nd On-Duty | Consultant On-Duty
...
```

---

## Phone Resolution Rules

1. **Exact match** — name appears verbatim in contact map → `uncertain: false`
2. **Normalized key match** — same name after stripping Dr., dots, Al- variants → `uncertain: false`
3. **Fuzzy score match** — part-by-part comparison with scoring:
   - Exact part match: +3 pts
   - Prefix match: +2 pts
   - Substring: +1 pt
   - Unmatched key parts (≥2): −2 pts penalty
   - Threshold: score ≥ 2 to resolve; `uncertain: true` if score < 5

**Never resolves:**
- Slash-compound names (`Reem S/Alsuwaiket`) — schedule abbreviations for multiple doctors
- Bare single first names with < 8 chars and no `Al-` prefix (`Fatimah`, `Faisal`, `Qamar`)
- Names whose phone is not present in the PDF contact table

---

## Offline / Intranet Use

The app loads PDF.js from CDN when first parsing a PDF. To run fully offline:

1. Download these two files from cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/:
   - `pdf.min.js`
   - `pdf.worker.min.js`
2. Place them in `assets/js/lib/`
3. The app will automatically use the local copies

---

## Specialties Covered (36)

adult_cardiology, anesthesia, clinical_lab, dental, dermatology, endocrinology, ent,
gastroenterology, gynecology, hematology, hospitalist, infectious, kptx, liver,
nephrology, neuro_ir, neurology, neurosurgery, ophthalmology, orthopedics, palliative,
pediatric_cardiology, pediatric_heme_onc, pediatric_neurology, pediatrics,
physical_medicine_rehabilitation, picu, psychiatry, pulmonary, radiology_duty,
radiology_oncall, radonc, rheumatology, spine, surgery, urology

---

## Browser Requirements

- Chrome 90+ / Edge 90+ / Firefox 88+ / Safari 15+
- IndexedDB support (for storing uploaded PDFs across sessions)
- Internet connection only needed for: PDF.js CDN load (first PDF upload), Google Fonts
- All schedule data and search works offline after first load

---

*Built for KFSH-D internal use. April 2026.*
