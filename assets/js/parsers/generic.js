// ═══════════════════════════════════════════════════════════════
// parsers/generic.js — Generic/shared parser functions
// ═══════════════════════════════════════════════════════════════
// Shared helpers: phone parsing, contact map building, dedup.
// Generic parsers: parseEntriesAroundPhones, parseDateTableEntries,
// parseSingleLineDateSplit, parseDaySequence, parseGenericPdfEntries.
// Depends on: core/phone-resolver.js (canonicalName, resolvePhone)
// ═══════════════════════════════════════════════════════════════

// ── Shared month/year detection ───────────────────────────────
const _MONTH_NAMES_FULL = ['january','february','march','april','may','june','july','august','september','october','november','december'];
const _MONTH_ABBRS      = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];

/**
 * Detects the dominant month and year from a PDF's extracted text.
 * Tries multiple formats:
 *   Numeric:  "15/04/2026", "15-04-2026", "15/4/2026"
 *   Text:     "April 2026", "april 2026"
 *   Abbrev:   "Apr-26", "Apr 26", "Apr-2026"
 *
 * Returns { month, year, monthPad, monthName, monthAbbr }
 * Defaults to current month/year if detection fails.
 */
function detectPdfMonthYear(text='') {
  function buildResult(mon, yr) {
    return {
      month:    mon,
      year:     yr,
      monthPad: String(mon).padStart(2, '0'),
      monthName: _MONTH_NAMES_FULL[mon - 1] || '',
      monthAbbr: _MONTH_ABBRS[mon - 1] || '',
    };
  }

  // Strategy 1: Count numeric date patterns DD/MM/YYYY or DD-MM-YYYY
  const numericRe = /\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})\b/g;
  const monthYearCounts = {};
  let m;
  while ((m = numericRe.exec(text)) !== null) {
    const mon = parseInt(m[2], 10);
    const yr  = parseInt(m[3], 10);
    const yr4 = yr < 100 ? 2000 + yr : yr;
    if (mon < 1 || mon > 12 || yr4 < 2025) continue;
    const key = `${mon}:${yr4}`;
    monthYearCounts[key] = (monthYearCounts[key] || 0) + 1;
  }
  let bestMon = 0, bestYr = 0, bestCount = 0;
  for (const [key, count] of Object.entries(monthYearCounts)) {
    if (count > bestCount) { bestCount = count; [bestMon, bestYr] = key.split(':').map(Number); }
  }
  if (bestMon && bestCount >= 10) return buildResult(bestMon, bestYr);

  // Strategy 2: Text month name — "April 2026", "Apr-26", "Apr 2026"
  const textLow = String(text).toLowerCase();
  const fullMonthRe = /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(20\d{2})\b/;
  const fullMatch = textLow.match(fullMonthRe);
  if (fullMatch) return buildResult(_MONTH_NAMES_FULL.indexOf(fullMatch[1]) + 1, parseInt(fullMatch[2], 10));

  const abbrMonthRe = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[- ](20\d{2}|\d{2})\b/;
  const abbrMatch = textLow.match(abbrMonthRe);
  if (abbrMatch) {
    const yr = parseInt(abbrMatch[2], 10);
    return buildResult(_MONTH_ABBRS.indexOf(abbrMatch[1]) + 1, yr < 100 ? 2000 + yr : yr);
  }

  // Strategy 3: Best guess from numeric even with < 10 occurrences
  if (bestMon) return buildResult(bestMon, bestYr);

  // Fallback: current month/year
  const now = new Date();
  return buildResult(now.getMonth() + 1, now.getFullYear());
}

function parsePhoneFromLine(line='') {
  // Match: +966-5x, 05x (10 digits), 5x (9 digits — missing leading 0, common in some PDFs)
  const candidates = line.match(/(?:\+?966[\s-]*)?0?5[\d\s-]{7,16}/g) || [];
  for (const candidate of candidates) {
    let digits = candidate.replace(/[^\d]/g, '');
    if (digits.startsWith('966')) digits = `0${digits.slice(3)}`;
    if (/^5\d{8}$/.test(digits)) digits = `0${digits}`;  // 9-digit: prepend 0
    const phone = digits.match(/^05\d{8}/);
    if (phone) return phone[0];
  }
  return '';
}

function parseDateKeyFromLine(line='') {
  const numeric = line.match(/\b([0-3]?\d)[\/.-]([01]?\d)\b/);
  if (numeric) return `${numeric[1].padStart(2,'0')}/${numeric[2].padStart(2,'0')}`;
  return '';
}

function parseTimeRangeFromLine(line='') {
  const range = line.match(/\b(\d{1,2})(?::(\d{2}))?\s*(?:-|–|to)\s*(\d{1,2})(?::(\d{2}))?\b/i);
  if (!range) return { startTime:'', endTime:'', shiftType:'' };
  const startTime = `${range[1].padStart(2,'0')}:${range[2] || '00'}`;
  const endTime = `${range[3].padStart(2,'0')}:${range[4] || '00'}`;
  const startHour = Number(range[1]);
  const shiftType = startHour >= 7 && startHour < 16 ? 'on-duty' : 'on-call';
  return { startTime, endTime, shiftType };
}

function roleFromLine(line='', fallback='On-Call') {
  const l = line.toLowerCase();
  if (/(1st|first)/.test(l)) return /resident/.test(l) ? '1st On-Call Resident' : '1st On-Call';
  if (/(2nd|second)/.test(l)) return /resident/.test(l) ? '2nd On-Call Resident' : '2nd On-Call';
  if (/(3rd|third)/.test(l)) return /consultant/.test(l) ? '3rd On-Call Consultant' : '3rd On-Call';
  if (/resident/.test(l)) return 'Resident';
  if (/fellow/.test(l)) return 'Fellow';
  if (/consultant/.test(l)) return 'Consultant On-Call';
  return normalizeUploadedRole(fallback);
}

function extractNameNearPhone(line='') {
  const phone = parsePhoneFromLine(line);
  let cleaned = line.replace(phone, ' ')
    .replace(/\b(?:[0-3]?\d[\/.-][01]?\d|sun|mon|tue|wed|thu|fri|sat|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/ig, ' ')
    .replace(/\b(?:1st|2nd|3rd|first|second|third|on|call|resident|fellow|consultant|day|night|after|coverage|duty|rota|taam)\b/ig, ' ')
    .replace(/[^A-Za-z\u0600-\u06FF.' -]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const drIndex = cleaned.search(/\bDr\.?\b/i);
  if (drIndex >= 0) cleaned = cleaned.slice(drIndex).trim();
  return cleaned.split(/\s{2,}/)[0].trim();
}

function compactPdfTextForParsing(text='') {
  return text
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/(\d{2}\/\d{2})(?=\D)/g, '\n$1 ')
    .replace(/(05\d{8})/g, ' $1 ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseEntriesAroundPhones(text='', deptKey='') {
  const compact = compactPdfTextForParsing(text);
  const phoneRe = /(?:\+?966[\s-]*)?0?5[\d\s-]{7,16}/g;
  const entries = [];
  let match;
  while ((match = phoneRe.exec(compact))) {
    const phone = parsePhoneFromLine(match[0]);
    if (!phone) continue;
    const start = Math.max(0, match.index - 160);
    const end = Math.min(compact.length, match.index + match[0].length + 90);
    const context = compact.slice(start, end);
    const date = parseDateKeyFromLine(context);
    const time = parseTimeRangeFromLine(context);
    const name = extractNameNearPhone(context);
    if (!name || name.length < 2 || /\b(on|call|resident|fellow|consultant|date|phone)\b/i.test(name)) continue;
    entries.push({
      specialty: deptKey,
      date,
      role: roleFromLine(context),
      name,
      phone,
      ...time,
      section: normalizeUploadedSpecialtyLabel(ROTAS[deptKey]?.label || specialtyLabelForKey(deptKey)),
      parsedFromPdf: true,
    });
  }
  return dedupeParsedEntries(entries);
}

function dedupeParsedEntries(entries=[]) {
  const seen = new Set();
  return entries.filter(entry => {
    const key = [entry.specialty, entry.date, canonicalName(entry.name), entry.phone, entry.role].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Build a name→phone contact map from any "Name ... Phone" table found in the PDF text.
// Many PDFs (ENT, Medicine, Neurology, etc.) have a staff contact list with names + mobiles.
// We parse this first, then use it to fill phone gaps in the schedule entries.
function buildContactMapFromText(text='') {
  // Returns { canonicalName → phone, lastName → phone, ... }
  // Handles all formats found in KFSH-D PDFs:
  //   • "Dr. Firstname Lastname  phone"          (Orthopedics, Nephrology)
  //   • "Firstname Lastname  role  ext  phone"   (ENT, PICU, Urology)
  //   • "Firstname  Lastname  id  phone  Firstname  Lastname  id  phone"  (Urology multi-column)
  const map = {};           // canonical → phone
  const altMap = {};        // for fuzzy lookup: normalized → phone
  const altMapKeys = {};    // normalized → original name (for display-name expansion)
  const positionMap = {};   // normalized name → { level, raw } from "Resident N" in contact table

  const PHONE_RE = /(?:\+?966[\s-]*)?0?5[\d\s-]{7,16}/g;
  const STOP_WORDS = new Set([
    'consultant','associate','assistant','head','section','chair','director','program',
    'fellow','resident','physician','senior','junior','specialist','coordinator',
    'manager','department','of','the','and','in','head','neck','surgery','rhinology',
    'skull','base','audiology','otology','neurotology','pediatric','otolaryngology',
    'airway','inpatient','outpatient','oncall','on','call','duty','rota','clinical',
    'transplant','nephrology','kidney','liver','cardiology','unit','md','mbbs',
  ]);

  // ── Utility: clean a raw name token ───────────────────────────
  function cleanNameToken(s) {
    // Collapse PDF.js-fractured words: "Al  h azmi" → "Al hazmi"
    // but preserve legitimate double-spaces between separate names
    return s.replace(/\b([A-Z][a-z]*)\s{1,2}([a-z]{1,3})\b/g, '$1$2') // "Al  h azmi" → "Alhazmi"? No – keep readable
             .replace(/\s+/g,' ').trim();
  }

  // ── Normalize name for lookup key ─────────────────────────────
  function normKey(name) {
    return name.toLowerCase()
      .replace(/^dr\.?\s*/,'')
      .replace(/[\s-]+al[\s-]+/g,' al ')     // normalize "Al-" / "Al " prefixes
      .replace(/\bal\b/g,'al')
      .replace(/[^a-z ]/g,' ')
      .replace(/\s+/g,' ')
      .trim();
  }

  // ── Add an entry with all its lookup variants ──────────────────
  function addEntry(rawName, phone) {
    if (!rawName || !phone || rawName.length < 3) return;
    // Collapse obvious PDF spacing artifacts: "Al  k hat  ee  b" → "Alkhateeeb"? 
    // Better: collapse intra-word gaps of 1-2 chars surrounded by alphas
    let name = rawName
      .replace(/([A-Za-z])\s{1,2}([a-z]{1,4})(?=\s|$)/g, '$1$2') // "Al  h azmi" → "Alhazmi"
      .replace(/\s+/g,' ').trim();
    
    // Belt-and-suspenders: strip any trailing role labels (e.g. "Dr. Ahmed Resident" → "Dr. Ahmed")
    {
      const pts = name.split(' ');
      while (pts.length > 1 && STOP_WORDS.has(pts[pts.length - 1].toLowerCase())) pts.pop();
      name = pts.join(' ');
    }
    // Collapse duplicate "Dr." honorifics: "Dr. Dr.Sara" → "Dr. Sara"
    name = name.replace(/^(Dr\.?\s+)Dr\.?\s*/i, '$1').replace(/\s+/g, ' ').trim();
    // Normalize "Dr.Name" → "Dr. Name" (PDF sometimes omits space after Dr.)
    name = name.replace(/\bDr\.([A-Za-z])/gi, 'Dr. $1');

    // Skip entries that are purely role labels
    const lower = name.toLowerCase().replace(/^dr\.?\s*/,'');
    if (lower.split(' ').every(w => STOP_WORDS.has(w))) return;
    // Must have at least one word that's a real name (≥3 chars, not a stop word)
    const nameParts = lower.split(' ').filter(w => w.length >= 3 && !STOP_WORDS.has(w));
    if (!nameParts.length) return;

    const nk = normKey(name);
    if (!altMap[nk]) { altMap[nk] = phone; altMapKeys[nk] = name; }

    // Store full name
    if (!map[name]) map[name] = phone;

    // Store camelCase-split variant to handle PDF rendering artifacts where
    // spaces between name parts are missing: "AnwrAldhakhel" → "Anwr Aldhakhel".
    // This allows "aldhakeel" to match "aldhakhel" as a separate token.
    const camelSplit = name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\s+/g, ' ').trim();
    if (camelSplit !== name) {
      const nkSplit = normKey(camelSplit);
      if (!altMap[nkSplit]) { altMap[nkSplit] = phone; altMapKeys[nkSplit] = camelSplit; }
      if (!map[camelSplit]) map[camelSplit] = phone;
      const bareSplit = camelSplit.replace(/^Dr\.?\s*/i, '').trim();
      if (bareSplit !== camelSplit && !map[bareSplit]) map[bareSplit] = phone;
    }

    // Store without Dr. prefix
    const bare = name.replace(/^Dr\.?\s*/i, '').trim();
    if (bare !== name && !map[bare]) map[bare] = phone;

    // Store last name alone (only if ≥5 chars to avoid false matches)
    const parts = bare.split(' ').filter(Boolean);
    if (parts.length >= 2) {
      const last = parts[parts.length - 1];
      if (last.length >= 5 && !map[last]) map[last] = phone;
      // Store "Al-X" last name variants
      if (parts.length >= 3 && parts[parts.length - 2].toLowerCase() === 'al') {
        const alLast = parts.slice(-2).join(' ');
        if (!map[alLast]) map[alLast] = phone;
      }
    }
  }

  // ── Process each line ─────────────────────────────────────────
  const lines = text.split(/\n/).map(l => l.trim()).filter(Boolean);

  for (const line of lines) {
    // Find all phones in the line
    const allPhones = [...line.matchAll(new RegExp(PHONE_RE.source, 'g'))].map(m => {
      let raw = m[0].replace(/[\s-]/g,'');
      if (raw.startsWith('966')) raw = '0' + raw.slice(3);
      if (/^5\d{8}$/.test(raw)) raw = '0' + raw;
      // When extension numbers merge with phone (e.g. "056 - 056 902 1663" → "0560569021663"),
      // scan from end to find the last valid 05XXXXXXXX pattern (the actual phone, not extension).
      let found = null;
      for (let i = raw.length - 10; i >= 0; i--) {
        if (/^05\d{8}$/.test(raw.substring(i, i + 10))) { found = raw.substring(i, i + 10); break; }
      }
      return found;
    }).filter(Boolean);

    if (!allPhones.length) continue;

    if (allPhones.length === 1) {
      // Single phone: extract name from the line
      const phone = allPhones[0];
      let cleaned = line
        .replace(new RegExp(PHONE_RE.source, 'g'), ' ')
        .replace(/\b\d{4,}\b/g, ' ')       // strip IDs/extensions
        .replace(/\b\d{1,3}\b/g, ' ')       // strip short numbers
        .replace(/\bDr\.?\s*/ig, 'Dr. ')    // normalize Dr prefix
        .replace(/[^A-Za-z\u0600-\u06FF .\'-]+/g, ' ')
        .replace(/\s+/g, ' ').trim();

      // Remove stop words but keep the name structure
      const tokens = cleaned.split(' ');
      const nameTokens = [];
      for (const tok of tokens) {
        const tl = tok.toLowerCase().replace(/^dr\.?$/, 'dr');
        if (tl === 'dr') { nameTokens.push(tok); continue; }
        // Stop at first role label once we have a name — do NOT include it
        if (STOP_WORDS.has(tl)) {
          if (nameTokens.length >= 2) break;
          continue;
        }
        // Strip embedded "Dr." prefix from tokens like "Dr.Sara" → "Sara"
        // (PDF lines sometimes have "Dr." line-prefix AND "Dr.Name" attached together)
        const nameTok = tok.replace(/^Dr\.?\s*/i, '').trim() || tok;
        if (nameTok.length >= 2) nameTokens.push(nameTok);
      }

      if (nameTokens.length >= 2) {
        addEntry(nameTokens.join(' '), phone);
      } else if (nameTokens.length === 1) {
        const solo = nameTokens[0].trim();
        if (solo.length >= 4 && !STOP_WORDS.has(solo.toLowerCase())) addEntry(solo, phone);
      }
      // Detect resident position level from the raw line (e.g. "Resident 3")
      const posMatch = line.match(/\bResident\s+(\d)\b/i);
      if (posMatch && nameTokens.length >= 2) {
        const posNk = normKey(nameTokens.join(' '));
        if (posNk && !positionMap[posNk]) {
          positionMap[posNk] = { level: parseInt(posMatch[1], 10), raw: posMatch[0] };
        }
      }
    } else {
      // Multiple phones: Urology-style packed line — pair each name chunk with its phone
      // Strategy: split by phone positions, take text between consecutive phones as names
      let remaining = line;
      const segments = [];
      let lastIdx = 0;
      for (const match of line.matchAll(new RegExp(PHONE_RE.source, 'g'))) {
        segments.push({ text: line.slice(lastIdx, match.index), phone: allPhones[segments.length] });
        lastIdx = match.index + match[0].length;
      }
      // Last segment after final phone has no phone — skip

      for (const seg of segments) {
        const phone = seg.phone;
        if (!phone) continue;
        let chunk = seg.text
          .replace(/\b\d{4,}\b/g, ' ')
          .replace(/\b\d{1,3}\b/g, ' ')
          .replace(/[^A-Za-z\u0600-\u06FF .\'-]+/g, ' ')
          .replace(/\s+/g, ' ').trim();

        // Take the LAST 2-3 words of chunk as the name (they appear right before the phone)
        const words = chunk.split(' ').filter(Boolean);
        // Skip stop words from end
        while (words.length && STOP_WORDS.has(words[words.length - 1].toLowerCase())) words.pop();
        // Take up to 3 words as the name
        const nameWords = words.slice(-3);
        if (nameWords.length >= 1 && nameWords.join('').length >= 3) {
          addEntry(nameWords.join(' '), phone);
        }
      }
    }
  }

  // ── Second pass: name-on-one-line, phone-on-next-line format ──
  // Some hospital PDFs (e.g. KPTX) render the contact table with the name
  // and phone number on consecutive lines rather than the same line.
  const phoneTestRe = new RegExp(PHONE_RE.source); // non-global copy for .test()
  for (let i = 0; i < lines.length - 1; i++) {
    if (phoneTestRe.test(lines[i])) continue;           // already handled: line has a phone
    const nextLine = lines[i + 1];
    const phoneOnlyMatch = nextLine.match(/^(?:\+?966[\s-]*)?(0?5[\d\s-]{7,16})$/);
    if (!phoneOnlyMatch) continue;                       // next line is not a bare phone
    // Treat lines[i] as a name line
    let cleaned = lines[i]
      .replace(/\bDr\.?\s*/ig, 'Dr. ')
      .replace(/[^A-Za-z\u0600-\u06FF .\'-]+/g, ' ')
      .replace(/\s+/g, ' ').trim();
    const toks = cleaned.split(' ');
    const nameTokens = [];
    for (const tok of toks) {
      const tl = tok.toLowerCase().replace(/^dr\.?$/, 'dr');
      if (tl === 'dr') { nameTokens.push(tok); continue; }
      // Stop at first role label once we have a name — do NOT include it
      if (STOP_WORDS.has(tl)) {
        if (nameTokens.length >= 2) break;
        continue;
      }
      // Strip embedded "Dr." prefix from tokens like "Dr.Sara" → "Sara"
      const nameTok = tok.replace(/^Dr\.?\s*/i, '').trim() || tok;
      if (nameTok.length >= 2) nameTokens.push(nameTok);
    }
    if (nameTokens.length >= 1) {
      let raw = phoneOnlyMatch[1].replace(/[\s-]/g, '');
      if (raw.startsWith('966')) raw = '0' + raw.slice(3);
      if (/^5\d{8}$/.test(raw)) raw = '0' + raw;
      const found = raw.match(/05\d{8}/);
      if (found) addEntry(nameTokens.join(' '), found[0]);
    }
  }

  return { map, altMap, altMapKeys, positionMap };
}

// mergeResolvedContactsIntoDept, hydrateBundledDeptContacts,
// buildPediatricsPage3ContactMap, hydrateBundledPediatricsContacts,
// ensureDeptSupportReady → defined in app.js (removed duplicates from here)

function resolvePhoneFromContactMap(name='', contactResult) {
  // contactResult is now { map, altMap, altMapKeys } from buildContactMapFromText
  // Backwards compatible: also accept plain object (old format)
  const map        = (contactResult && contactResult.map)        || contactResult || {};
  const altMap     = (contactResult && contactResult.altMap)     || {};
  const altMapKeys = (contactResult && contactResult.altMapKeys) || {};
  if (!name || !Object.keys(map).length) return null;

  // Normalize: strip Dr. prefix (with or without trailing space), collapse whitespace
  function normKey(n) {
    return n.toLowerCase()
      .replace(/^dr\.?\s*/,'')       // "Dr. " or "Dr." (no space, e.g. "Dr.Bikheet")
      .replace(/\./g,' ')            // "Dr.Bikheet" → "bikheet" after above; also "Al.Absi" → "al absi"
      .replace(/[\s-]+al[\s-]+/g,' al ')
      .replace(/\bal\b/g,'al')
      .replace(/[^a-z ]/g,' ')
      .replace(/\s+/g,' ')
      .trim();
  }

  // 1. Exact match
  if (map[name]) return { phone: map[name], uncertain: false, matchedName: name };

  // 2. Normalized key match (handles "Dr." prefix differences, spacing)
  const nk = normKey(name);
  if (altMap[nk]) return { phone: altMap[nk], uncertain: false, matchedName: altMapKeys[nk] || null };

  // 3. Fuzzy match — score-based, with strict rules to avoid wrong assignments
  const nameParts = nk.split(' ').filter(p => p.length >= 4);

  // SAFETY: slash-compound names ("Reem S/Alsuwaiket", "Lujain/Faisal") are schedule
  // abbreviations for multiple doctors — never fuzzy-match them to a single contact.
  if (name.includes('/')) return null;

  // Block fuzzy for bare first-name queries ("Fatimah", "Faisal", "Qamar").
  // Expand dots, strip leading "Dr", count remaining words:
  //   "Fatimah"     → 1 word, 7 chars, no Al prefix → block
  //   "Dr Al Absi"  → strip Dr → "Al Absi" → 2 words → allow
  //   "Alhasawi"    → 1 word, starts with Al → allow (family name)
  //   "Dr.Bikheet"  → expand → "Dr Bikheet" → strip Dr → "Bikheet" → 1 word, 7 chars → block
  {
    const drStripped = name.replace(/\./g, ' ').trim().replace(/^Dr\s*/i, '').trim();
    const allWords = drStripped.split(/\s+/).filter(Boolean);
    // "Initial + Lastname" patterns like "S Alaboud", "A Aldhakeel":
    // Instead of hard-blocking, try to resolve via initial + last-name match.
    // Only succeeds if exactly ONE contact matches (safe, no ambiguity).
    if (allWords.length >= 2 && allWords[0].length === 1) {
      const initial = allWords[0].toLowerCase();
      const lastName = allWords[allWords.length - 1].toLowerCase();
      const hits = [];
      for (const [ak, av] of Object.entries(altMap)) {
        const akParts = ak.split(' ').filter(Boolean);
        if (akParts.length < 2) continue;
        const akLast = akParts[akParts.length - 1];
        // Last name must match exactly or within Levenshtein-2 (for transliteration variants)
        const lastMatch = akLast === lastName
          || (akLast.length >= 4 && lastName.length >= 4 && levenshtein(akLast, lastName) <= 2);
        if (!lastMatch) continue;
        // First name initial must match
        if (!akParts[0].startsWith(initial)) continue;
        hits.push({ phone: av, matchedName: altMapKeys[ak] || null });
      }
      // Deduplicate by phone — only resolve if unambiguous
      const byPhone = new Map();
      hits.forEach(h => { if (!byPhone.has(h.phone)) byPhone.set(h.phone, h.matchedName); });
      if (byPhone.size === 1) {
        const [[ph, nm]] = byPhone.entries();
        return { phone: ph, uncertain: false, matchedName: nm };
      }
      return null; // ambiguous or not found
    }
    const rw = allWords.filter(w => w.length >= 2);
    if (rw.length === 0) return null;
    if (rw.length === 1) {
      const w = rw[0].toLowerCase();
      if (!w.startsWith('al') && w.length < 5) return null;
    }
  }

  // Step 2b: token-level edit-distance-1 against single-word altMap keys.
  // Handles the case where the contact table has "Nageeb" (bare) and we look
  // up "Dr. Najeeb Al Musaied" — the altMap exact lookup misses, but token
  // 'najeeb' is edit-distance-1 from 'nageeb'.  Only fires for tokens ≥6 chars
  // to keep false-positive rate very low.  Returns uncertain:true (needs review).
  // Full Levenshtein distance (handles substitutions, insertions, deletions)
  function levenshtein(a, b) {
    const m = a.length, n = b.length;
    if (m === 0) return n; if (n === 0) return m;
    let prev = Array.from({length: n+1}, (_, j) => j);
    for (let i = 1; i <= m; i++) {
      const curr = [i];
      for (let j = 1; j <= n; j++) {
        curr[j] = a[i-1] === b[j-1] ? prev[j-1]
          : 1 + Math.min(prev[j-1], curr[j-1], prev[j]);
      }
      prev = curr;
    }
    return prev[n];
  }
  function editDist1(a, b) { return levenshtein(a,b) <= 1; }

  // Step 2b: single-token edit-distance-1 against altMap keys.
  // For single-word keys: match directly.
  // For multi-word keys: match query token against any token in the key.
  for (const part of nk.split(' ').filter(p => p.length >= 5)) {
    const hits = [];
    for (const [ak, av] of Object.entries(altMap)) {
      const akTokens = ak.split(' ').filter(Boolean);
      const matched = akTokens.some(t => t.length >= 5 && editDist1(part, t));
      if (matched) hits.push({ phone: av, matchedName: altMapKeys[ak] || null });
    }
    // Deduplicate by phone — only resolve if unambiguous
    const byPhone = new Map();
    hits.forEach(h => { if (!byPhone.has(h.phone)) byPhone.set(h.phone, h.matchedName); });
    if (byPhone.size === 1) {
      const [[ph, nm]] = byPhone.entries();
      return { phone: ph, uncertain: false, matchedName: nm };
    }
  }

  // Step 2c: multi-word altMap keys — token-level edit-distance ≤ 2.
  // "Najeeb Al Musaied" vs "Nageeb Al Musaied" (j↔g = 1 edit): all tokens must
  // match (exact OR within 2 edits for tokens ≥4 chars), with ≥1 typo present.
  // This is safe because we require EVERY query token to have a partner.
  {
    const nkParts = nk.split(' ').filter(p => p.length >= 3);
    if (nkParts.length >= 2) {
      for (const [ak, av] of Object.entries(altMap)) {
        if (!ak.includes(' ')) continue;
        const akParts = ak.split(' ').filter(p => p.length >= 3);
        if (akParts.length < 2) continue;
        let typoCount = 0;
        const allMatch = nkParts.every(qp => {
          if (akParts.some(ap => ap === qp)) return true;
          // Allow up to 2-char typos for tokens ≥4 chars
          if (qp.length >= 4 && akParts.some(ap => ap.length >= 4 && levenshtein(qp, ap) <= 2)) {
            typoCount++;
            return true;
          }
          return false;
        });
        if (allMatch && typoCount >= 1) {
          return { phone: av, uncertain: false, matchedName: altMapKeys[ak] || null };
        }
      }
    }
  }

  let bestScore = 0;
  let bestPhone = null;
  let bestKey   = null;
  let bestUncertain = true;

  for (const [key, phone] of Object.entries(map)) {
    const keyNorm = normKey(key);
    const keyParts = keyNorm.split(' ').filter(p => p.length >= 4);
    if (!keyParts.length) continue;

    let score = 0;

    for (const np of nameParts) {
      for (const kp of keyParts) {
        if (np === kp) score += 3;
        else if (kp.startsWith(np) || np.startsWith(kp)) score += 2;
        else if (kp.includes(np) || np.includes(kp)) score += 1;
        else if (np.length >= 4 && kp.length >= 4 && levenshtein(np, kp) <= 2) score += 2; // 2-char typo tolerance
      }
    }

    // Bonus: multi-part match
    if (nameParts.length >= 2 && keyParts.length >= 2 && score >= 4) score += 1;

    // Penalty: key has unmatched parts (wrong person)
    const unmatchedKey = keyParts.filter(kp => !nameParts.some(np => kp.startsWith(np) || np.startsWith(kp))).length;
    if (unmatchedKey >= 2) score -= 2;

    if (score > bestScore) {
      bestScore = score;
      bestPhone = phone;
      bestKey   = key;
      bestUncertain = !(score >= 5 || (nameParts.length >= 2 && score >= 4));
    }
  }

  // Minimum threshold: at least 2 points (one meaningful part matched)
  if (bestScore < 2) return null;

  return { phone: bestPhone, uncertain: bestUncertain, matchedName: bestKey };
}
// Format: "ABBREV(ID) Dr. Fullname Phone"
function buildAbbrLegend(text='') {
  const legend = {};
  const legendRe = /\b([A-Z]{2,6})\s*\([\w]+\)\s*(Dr\.?\s+[\w\u00C0-\u024F\xa0 .'-]+?)\s+(\d{9,10})\b/g;
  let m;
  while ((m = legendRe.exec(text)) !== null) {
    const abbr = m[1].trim();
    const name = m[2].replace(/\xa0/g, ' ').replace(/\s+/g, ' ').trim();
    const phone = m[3].startsWith('5') ? '0' + m[3] : m[3];
    if (abbr && name && phone) legend[abbr] = { name, phone };
  }
  return legend;
}

// Parse Anesthesia-style PDFs which use abbreviations in the schedule but have a legend.

function parseDateTableEntries(text='', deptKey='') {
  const rawLines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const entries = [];
  const dayRe = /^(?:mon|tue|wed|thu|fri|sat|sun)/i;
  // Flexible date regex: handles "08/04/2026", "08 /04/ 2026", "08/0 4" (spaced digit), "1-Apr-26"
  const dateRe = /(\d{1,2})\s*[\/\-]\s*(\d\s*\d|\d{1,2}|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)(?:\s*[\/\-\s]\s*(\d{2,4}))?/i;
  const monthMap = { jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12' };

  const _parseDate = (dm) => {
    const day = dm[1].padStart(2,'0');
    const monRaw = dm[2].replace(/\s/g,''); // collapse "0 4" → "04"
    const mon = monthMap[monRaw.toLowerCase()] || monRaw.padStart(2,'0');
    return `${day}/${mon}`;
  };

  // Detect column roles from PDF header rows
  // Strategy: scan first 15 lines for column role labels; merge fragmented header lines.
  // PDFs often split headers across 2–4 lines due to column layout.
  const HEADER_WINDOW = rawLines.slice(0, Math.min(20, rawLines.length));
  const headerCandidate = HEADER_WINDOW
    .filter(l => /(1st|2nd|3rd|on.?call|on.?duty|resident|consultant|associate|fellow|assistant)/i.test(l)
                 && !dayRe.test(l) && !dateRe.test(l))
    .join(' ');  // merge fragmented header lines

  const roleLabels = [];
  if (headerCandidate) {
    // Orthopedics header: "RESIDENT ON CALL  2ND ON CALL  Pediatric Associate  Consultant"
    // ENT header: "1 ON CALL Resident  2 ON CALL  3rd ON CALL  ENT Consultant"
    // Map in column order left→right
    const h = headerCandidate.toLowerCase();
    // Detect each role tier in order it appears
    const tiers = [
      { re: /1st|first|\b1\s*on.?call|\b1st\s*on/,  label: '1st On-Call' },
      { re: /resident on.?call|resident/,             label: 'Resident On-Call' },
      { re: /2nd|second|\b2\s*on.?call/,             label: '2nd On-Call' },
      { re: /3rd|third|\b3\s*on.?call/,              label: '3rd On-Call' },
      { re: /associate|assistant\s*consultant/,        label: 'Associate Consultant On-Call' },
      { re: /fellow/,                                  label: 'Fellow On-Call' },
      { re: /consultant/,                              label: 'Consultant On-Call' },
    ];

    // Find positions of each tier in the header string and sort by position
    const found = [];
    for (const tier of tiers) {
      const m = tier.re.exec(h);
      if (m) found.push({ pos: m.index, label: tier.label });
    }
    found.sort((a,b) => a.pos - b.pos);
    found.forEach(f => { if (!roleLabels.includes(f.label)) roleLabels.push(f.label); });
  }

  // Specialty-specific overrides for well-known column layouts
  // These are applied when the PDF header is ambiguous or absent.
  const SPECIALTY_ROLE_LAYOUTS = {
    orthopedics:  ['Resident On-Call', '2nd On-Call', 'Associate/Pediatric Consultant', 'Consultant On-Call'],
    ent:          ['1st On-Call', '2nd On-Call', '3rd On-Call', 'Consultant On-Call'],
    urology:      ['Resident On-Call', '2nd On-Call', 'Consultant On-Call', 'Consultant On-Call'],
    hematology:   ['Resident/Fellow On-Call', 'Fellow 2nd On-Call', 'Consultant On-Call', 'Consultant Inpatient'],
    nephrology:   ['1st On-Call', '2nd On-Call', 'Consultant On-Call'],
    surgery:      ['Resident On-Duty (ER)', '2nd On-Duty', 'Consultant On-Duty'],
    neurosurgery: ['Resident On-Duty', '2nd On-Duty', 'Consultant On-Call'],
    neurology:    ['Resident On-Call', 'Consultant On-Call'],
    psychiatry:   ['Resident On-Call', 'Consultant On-Call'],
    dental:       ['1st On-Call', 'Consultant On-Call'],
    spine:        ['Resident On-Call', '2nd On-Call', 'Consultant On-Call'],
    gynecology:   ['Fellow/Resident', 'Resident On-Call', 'Consultant On-Call'],
  };

  // Specialties with fragmented or column-label-only headers where position-based detection
  // produces wrong role order. For these, always use SPECIALTY_ROLE_LAYOUTS.
  const FORCE_SPECIALTY_LAYOUT = new Set([
    'nephrology', 'urology', 'surgery', 'neurosurgery', 'neurology', 'gynecology',
  ]);

  // Use header-detected roles if we got ≥2 AND this specialty doesn't force the layout
  const useHeaderRoles = roleLabels.length >= 2 && !FORCE_SPECIALTY_LAYOUT.has(deptKey);
  const effectiveRoleLabels = useHeaderRoles ? roleLabels
    : (SPECIALTY_ROLE_LAYOUTS[deptKey] || ['1st On-Call', '2nd On-Call', 'Consultant On-Call', 'Consultant On-Call']);

  const defaultRoles = effectiveRoleLabels;

  function extractNamesFromText(src, dateKey) {
    // CRITICAL: strip noise BEFORE splitting, but do NOT collapse whitespace yet.
    // The double-spaces between columns are the only column separator signal.
    // Collapsing them first (via \s+→' ') destroys column boundaries.
    let stripped = src
      .replace(/^(?:mon|tue|wed|thu|fri|sat|sun)\w*\s*/i, '')
      .replace(dateRe, '')
      .replace(/\b\d{4}\b/g, '')
      .replace(/(?:\+?966[\s-]*)?0?5[\d\s-]{7,16}/g, '  ')  // replace phone with double-space to preserve boundary
      .replace(/\([^)]{1,6}\)/g, ' ')
      .replace(/\xa0/g, ' ');
    if (!stripped || stripped.trim().length < 2) return;

    // Split on 2+ spaces (column separator), tabs, or at "Dr " boundaries — BEFORE collapsing
    let parts = stripped.split(/\s{2,}|\t|(?=\bDr\.?\s+[A-Z])/);

    // Now normalize each part individually
    parts = parts.map(s => s.replace(/\s+/g, ' ').trim()).filter(s => {
      if (!s || s.length < 2) return false;
      if (/^\d+$/.test(s)) return false;
      if (/^(on|call|duty|resident|fellow|consultant|rota|role|date|day|name|april|march|may|june|jul|aug)$/i.test(s)) return false;
      // Skip header noise: "1st", "2nd", "(24-HOURS)", "Senior Resident"
      if (/^(?:\d+st|\d+nd|\d+rd|\d+th|\(24.hours?\))$/i.test(s)) return false;
      return true;
    });

    // Merge consecutive single-word parts that form a full name: ['Malak','Alamoudi'] → ['Malak Alamoudi']
    // BUT: do NOT merge if right side starts with "Dr." (it's a separate person)
    // AND: do NOT merge if it would create a Urology-style "Name Dr.X" collision
    const merged = [];
    let mi = 0;
    while (mi < parts.length) {
      const p = parts[mi];
      const next = mi + 1 < parts.length ? parts[mi + 1] : null;
      // Merge only if: both are single words AND neither looks like a Dr. prefix
      if (
        p.split(' ').length === 1 &&
        next !== null &&
        next.split(' ').length === 1 &&
        !/^Dr\.?/i.test(next) &&
        !/^Dr\.?/i.test(p)
      ) {
        merged.push(p + ' ' + next);
        mi += 2;
      } else {
        merged.push(p); mi++;
      }
    }

    merged.forEach((name, idx) => {
      const role = effectiveRoleLabels[idx] || (idx === 0 ? '1st On-Call' : 'On-Call');
      entries.push({ specialty: deptKey, date: dateKey, role, name, phone: '', section: normalizeUploadedSpecialtyLabel(ROTAS[deptKey]?.label || deptKey), parsedFromPdf: true });
    });
  }

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];           // ← BUG WAS HERE: was using undefined `line`
    // Accept lines starting with day name OR starting directly with a date (e.g. "08 /04/ 2026 Name")
    const startsWithDay  = dayRe.test(line);
    const startsWithDate = !startsWithDay && /^\d{1,2}\s*[\/\-]/.test(line.trimStart());
    if (!startsWithDay && !startsWithDate) continue;
    const dm = line.match(dateRe);
    if (!dm) continue;
    const dateKey = _parseDate(dm);

    // Layout A: names on same line as date
    const restOnSameLine = line
      .replace(/^(?:mon|tue|wed|thu|fri|sat|sun)\w*\s*/i, '')
      .replace(dateRe, '').trim();
    const hasNamesOnSameLine = restOnSameLine.length > 3 && /[A-Za-z]{3,}/.test(restOnSameLine);

    if (hasNamesOnSameLine) {
      extractNamesFromText(line, dateKey);
    }

    // Layout B: names on adjacent line (prev or next)
    // Only check adjacent if there are no names on the same line (ENT layout)
    if (!hasNamesOnSameLine) {
      if (i > 0) {
        const prevLine = rawLines[i - 1];
        if (!dayRe.test(prevLine) && !/^\d{1,2}\s*[\/\-]/.test(prevLine) && /[A-Za-z]{3,}/.test(prevLine)) {
          extractNamesFromText(prevLine, dateKey);
        }
      }
      if (i < rawLines.length - 1) {
        const nextLine = rawLines[i + 1];
        if (!dayRe.test(nextLine) && !/^\d{1,2}\s*[\/\-]/.test(nextLine) && /[A-Za-z]{3,}/.test(nextLine)) {
          extractNamesFromText(nextLine, dateKey);
        }
      }
    }
  }
  return dedupeParsedEntries(entries);
}

// ── INLINE DATE-SPLIT PARSER ──────────────────────────────────
// For PDFs that pack the month into a single long line with date separators.
// Handles two formats:
//   Nephrology: "01/04/2026  Name  Consultant  02/04/2026  ..."
//   Neurosurgery: "1-Apr-26  Name  Dr X  2-Apr-26  ..."
function parseSingleLineDateSplit(text='', deptKey='') {
  const entries = [];
  const { monthPad } = detectPdfMonthYear(text);
  const fullDateRe  = /(\d{2}\/\d{2}\/\d{4})/g;
  // Generic abbreviated-month pattern: "1-Apr-26", "15-May-27", etc.
  const shortDateRe = /(\d{1,2}-[A-Za-z]{3}-\d{2,4})/g;

  function parseSegments(line, splitRe, toKey) {
    if ([...line.matchAll(splitRe)].length < 2) return;
    const segs = line.split(splitRe);
    for (let i = 1; i < segs.length - 1; i += 2) {
      const dateKey = toKey(segs[i]);
      const data    = (segs[i + 1] || '').trim();
      if (!data) continue;

      // Rejoin bare "Dr." fragments: "Dr.  Mazen Al Otaibi" → "Dr. Mazen Al Otaibi"
      const rawParts = data.split(/\s{2,}/);
      const parts = [];
      for (let j = 0; j < rawParts.length; j++) {
        const p = rawParts[j].trim();
        if (!p) continue;
        if (/^Dr\.\s*$/.test(p) && j + 1 < rawParts.length) {
          parts.push('Dr. ' + rawParts[++j].trim()); // consume next token
        } else {
          parts.push(p);
        }
      }

      parts.forEach(p => {
        if (/^\d+$/.test(p)) return;
        if (/^(MROD|Tx On Call|On Call|On-Call|mrod|Assistant consultants|Neurovascular|Neurosurgery|Residents|Department|Dammam)$/i.test(p)) return;
        if (/^[\w.]+@[\w.]+$/.test(p)) return;
        if (p.length < 2) return;
        if (/^Dr\.?\s*\w/.test(p) || /^[A-Z][a-z]/.test(p) || /\//.test(p) || /^[A-Z]\.\w/.test(p)) {
          const isConsultant = /^Dr\.?/i.test(p);
          entries.push({ specialty: deptKey, date: dateKey, role: isConsultant ? 'Consultant On-Call' : '1st On-Call', name: p, phone: '', parsedFromPdf: true });
        }
      });
    }
  }

  for (const line of text.split('\n')) {
    // dd/mm/yyyy (Nephrology)
    if ([...line.matchAll(fullDateRe)].length >= 2)
      parseSegments(line, fullDateRe, s => s.slice(0, 5));
    // d/m/yyyy or d/mm/yyyy (Liver Transplant) — use flexible regex
    const flexDateRe = /(\d{1,2}\/\d{1,2}\/\d{4})/g;
    if ([...line.matchAll(flexDateRe)].length >= 2)
      parseSegments(line, flexDateRe, s => {
        const [d, m] = s.split('/');
        return `${d.padStart(2,'0')}/${m.padStart(2,'0')}`;
      });
    // N-Apr-26 (Neurosurgery)
    if ([...line.matchAll(shortDateRe)].length >= 2)
      parseSegments(line, shortDateRe, s => {
        const parts = s.split('-'); // ["15", "Apr", "26"]
        const mon = _MONTH_ABBRS.indexOf((parts[1] || '').toLowerCase()) + 1;
        const mp  = mon > 0 ? String(mon).padStart(2,'0') : monthPad;
        return parts[0].padStart(2,'0') + '/' + mp;
      });
  }
  return dedupeParsedEntries(entries);
}

// ── GYNECOLOGY 24H-BLOCK PARSER ───────────────────────────────
// Gynecology packs all 30 days into one line separated by "24 H" markers.
// Block index maps directly to calendar day (block 0 = Apr 1, block 7 = Apr 8).

function parseDaySequence(text='', deptKey='', monthYear='') {
  const entries = [];
  // Auto-detect month/year from the PDF if not explicitly provided
  let monthStr, yearStr;
  if (monthYear) {
    [monthStr, yearStr] = monthYear.split('/');
  } else {
    const detected = detectPdfMonthYear(text);
    monthStr = detected.monthPad;
    yearStr  = String(detected.year);
  }
  const month = parseInt(monthStr, 10) - 1; // 0-indexed for Date()
  const year  = parseInt(yearStr, 10);
  const dayNames = ['sun','mon','tue','wed','thu','fri','sat'];

  // Build date calendar: dayName → [dd/mm, dd/mm, ...]
  const dayOccurrences = {};
  for (let d = 1; d <= 31; d++) {
    const dt = new Date(year, month, d);
    if (dt.getMonth() !== month) break;
    const key = dayNames[dt.getDay()];
    if (!dayOccurrences[key]) dayOccurrences[key] = [];
    dayOccurrences[key].push(String(d).padStart(2,'0') + '/' + monthStr);
  }

  const dayIdx = {};
  dayNames.forEach(d => dayIdx[d] = 0);

  const rawLines = text.split('\n').map(l => l.trim()).filter(Boolean);
  // Match both abbreviated (wed) and full day names (wednesday) — covers ENT, Surgery, Ophthalmology
  const dayRe     = /^(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun)\b/i;
  const fullToAbbr = {
    monday:'mon', tuesday:'tue', wednesday:'wed', thursday:'thu',
    friday:'fri', saturday:'sat', sunday:'sun',
    mon:'mon', tue:'tue', wed:'wed', thu:'thu', fri:'fri', sat:'sat', sun:'sun',
  };

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    const dm   = line.match(dayRe);
    if (!dm) continue;

    const dayKey = fullToAbbr[dm[1].toLowerCase()] || dm[1].toLowerCase().slice(0, 3);
    if (!dayOccurrences[dayKey]) continue;
    if (dayIdx[dayKey] >= dayOccurrences[dayKey].length) continue;
    const dateKey = dayOccurrences[dayKey][dayIdx[dayKey]++];

    // Names can be on the same line (after day name), the PREVIOUS line, or the NEXT line
    const rawSameLine = line.replace(dayRe, '').trim();
    // If the same line content is only a date or number after removing the day name, treat as empty
    const sameLineIsDateOnly = /^\d{1,2}[\/\-]\d{1,2}([\/\-]\d{2,4})?(\s*$|\s+\d{4}$)/.test(rawSameLine) || /^\d+$/.test(rawSameLine);
    const sameLine = sameLineIsDateOnly ? '' : rawSameLine;
    const prevLine = i > 0 ? (rawLines[i - 1] || '') : '';
    const nextLine = (rawLines[i + 1] || '');
    const nextIsDay = dayRe.test(nextLine);
    const prevIsDay = dayRe.test(prevLine);

    // Priority: same line → prev line (RadOnc layout: names before date) → next line
    const target = sameLine
      || (!prevIsDay && prevLine ? prevLine : '')
      || (!nextIsDay ? nextLine : '');
    if (!target) continue;

    // Split on 2+ spaces — these are already column-separated people; do NOT merge them
    const parts = target.split(/\s{2,}|\t|(?=\bDr\.\s+[A-Z])/).map(s => s.trim()).filter(s =>
      s && s.length >= 2 &&
      !/^\d+$/.test(s) &&
      !/^\d{1,2}[\/\-]\d{1,2}([\/\-]\d{2,4})?$/.test(s) &&   // filter date strings
      !/^(on|call|duty|rota|am|pm|\d+:\d+|Tamadher)$/i.test(s)
    );

    // Each part after the split is a SEPARATE person — no merging of single words
    parts.forEach((name, idx) => {
      const isConsultant = /^Dr\.?\s/i.test(name);
      const role = isConsultant ? 'Consultant On-Call'
                 : (idx === 0 ? '1st On-Call' : '2nd On-Call');
      entries.push({ specialty: deptKey, date: dateKey, role, name, phone: '', parsedFromPdf: true });
    });
  }
  return dedupeParsedEntries(entries);
}


// Specialties with dedicated parsers — generic should NOT run for these
const SPECIALTIES_WITH_DEDICATED_PARSERS = new Set([
  // Claude API parsers
  'medicine_on_call', 'surgery', 'pediatrics', 'radiology_oncall',
  // pdfplumber via extract-table.py
  'hospitalist', 'ent', 'orthopedics', 'neurosurgery', 'spine',
  'hematology', 'kptx', 'liver', 'gynecology', 'psychiatry',
  'picu', 'pediatric_heme_onc', 'neurology', 'urology', 'adult_cardiology',
  // PDF view only
  'critical_care', 'oncology', 'anesthesia',
]);

// Names that should never be treated as doctor names
const NAME_BLACKLIST = new Set([
  'name', 'name id ext', 'see general pediatric rota', 'see general',
  'header', 'footer', 'date', 'doctor', 'specialty', 'phone', 'number',
  'mobile', 'day', 'time', 'shift', 'role', 'position', 'department',
  'on-call', 'on call', 'consultant', 'resident', 'fellow', 'associate',
  'ext', 'id', 'pager', 'office', 'bleep', 'leave', 'annual',
]);

const NAME_BLACKLIST_PATTERNS = [
  /^[A-Z\s]{20,}$/,           // All caps 20+ chars
  /^\d+$/,                     // Pure numbers
  /^[\d\s\-\/]+$/,            // Only digits/separators
  /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat)(day)?$/i,
  /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)$/i,
  /^(1st|2nd|3rd|4th|5th)\s*(on|call|duty)/i,
];

function isValidDoctorName(name) {
  if (!name || typeof name !== 'string') return false;
  const trimmed = name.trim();
  if (trimmed.length < 3 || trimmed.length > 80) return false;
  if (NAME_BLACKLIST.has(trimmed.toLowerCase())) return false;
  for (const p of NAME_BLACKLIST_PATTERNS) { if (p.test(trimmed)) return false; }
  if (!/[a-zA-Z\u0600-\u06FF]/.test(trimmed)) return false;
  return true;
}

function parseGenericPdfEntries(text='', deptKey='') {
  // GUARD: skip generic for specialties with dedicated parsers
  if (SPECIALTIES_WITH_DEDICATED_PARSERS.has(deptKey)) {
    console.log(`[GENERIC_GUARD] Skipping ${deptKey} — has dedicated parser`);
    return [];
  }

  // Step 1: build contact map from the full text (name→phone from staff list)
  const contactMap = buildContactMapFromText(text);

  // Step 2: parse date-table rows (schedule grid)
  const tableEntries = parseDateTableEntries(text, deptKey);

  // Step 3: parse line-by-line for phone-anchored entries
  // NOTE: preserve original line spacing — do NOT collapse \s+ globally here
  // because double-spaces are column separators in table PDFs
  const lines = text.split(/\n/).map(line => line.trimEnd()).filter(Boolean);
  const phoneEntries = [];
  let currentDate = '';
  lines.forEach(line => {
    const date = parseDateKeyFromLine(line);
    if (date) currentDate = date;
    const phone = parsePhoneFromLine(line);
    const hasRole = /(1st|2nd|3rd|first|second|third|resident|fellow|consultant|on[\s-]?call)/i.test(line);
    if (!phone && !hasRole) return;
    const name = extractNameNearPhone(line);
    if (!name || name.length < 2) return;
    phoneEntries.push({
      specialty: deptKey,
      date: date || currentDate,
      role: roleFromLine(line),
      name,
      phone,
      ...parseTimeRangeFromLine(line),
      section: normalizeUploadedSpecialtyLabel(ROTAS[deptKey]?.label || deptKey),
      parsedFromPdf: true,
    });
  });

  // Step 4: also run the around-phones window approach
  const knownPhoneDates = new Set(phoneEntries.map(entry => `${entry.phone}|${entry.date || ''}`));
  const phoneWindowEntries = parseEntriesAroundPhones(text, deptKey)
    .filter(entry => !knownPhoneDates.has(`${entry.phone}|${entry.date || ''}`));

  // Step 5: merge all entries, preferring phone-bearing ones
  const all = dedupeParsedEntries([...phoneEntries, ...phoneWindowEntries, ...tableEntries]);

  // Step 6: fill in phones from contact map for entries that have names but no phone
  return all.map(entry => {
    if (entry.phone) return entry;
    // Try to find phone from contact map by name match
    const resolved = resolvePhoneFromContactMap(entry.name, contactMap);
    if (resolved) return { ...entry, phone: resolved.phone, phoneUncertain: resolved.uncertain };
    return entry;
  });
}



// buildPediatricsPage3ContactMap (duplicate) → in app.js
// buildAbbrLegend (duplicate) → first copy at line ~462 above
// mergeScheduleMaps (duplicate) → in app.js

// Schedule map builder (shared)
function buildScheduleMapFromEntries(entries=[]) {
  return entries.reduce((acc, entry) => {
    const dateKey = entry.date || '';
    if (!dateKey) return acc;
    if (!acc[dateKey]) acc[dateKey] = [];
    acc[dateKey].push({ ...entry });
    return acc;
  }, {});
}

// ═══════════════════════════════════════════════════════════════
// Shared normalization — splitMultiDoctorEntries, normalizeParsedEntries
// ═══════════════════════════════════════════════════════════════

function splitMultiDoctorEntries(entries=[], deptKey='') {
  return entries.flatMap(entry => {
    const parts = splitPossibleNames(entry.name || '');
    if (parts.length <= 1) return [entry];
    return parts.map(name => ({
      ...entry,
      name,
      phone: entry.sharedPhone ? entry.phone : '',
      phoneUncertain: entry.sharedPhone ? true : entry.phoneUncertain,
      splitFrom: entry.name,
      nameUncertain: false,
    }));
  });
}

function normalizeParsedEntries(entries=[]) {
  // Pre-pass 1: split entries where name contains multiple Dr.X patterns (PICU abbreviation style)
  const expanded1 = [];
  for (const entry of entries) {
    const name = (entry.name || '').trim();
    const drParts = name.split(/(?=\bDr\.\w)/g).map(s => s.trim()).filter(Boolean);
    if (drParts.length > 1) {
      drParts.forEach(part => expanded1.push({ ...entry, name: part }));
    } else {
      expanded1.push(entry);
    }
  }

  // Pre-pass 2: split comma-separated names (Neurology: "Batool, Ghady" → "Batool" + "Ghady")
  const expanded2 = [];
  for (const entry of expanded1) {
    const name = (entry.name || '').trim();
    if (name.includes(',')) {
      const parts = name.split(',').map(s => s.trim()).filter(s => s.length >= 2);
      if (parts.length > 1) {
        parts.forEach(part => expanded2.push({ ...entry, name: part }));
        continue;
      }
    }
    expanded2.push(entry);
  }

  const deduped = dedupeParsedEntries(expanded2
    .map(entry => {
      const meta = parseRoleMeta(entry.role || '');
      let name = (entry.name || '').replace(/\bTAAM\b/gi, '').replace(/\s+/g, ' ').trim();
      // Normalize ALL "Dr.Name" → "Dr. Name" (PDF sometimes omits space after dot)
      name = name.replace(/\bDr\.([A-Za-z])/gi, 'Dr. $1');
      // Collapse duplicate "Dr." honorifics: "Dr. Dr. Sara" → "Dr. Sara"
      name = name.replace(/^Dr\.?\s+Dr\.?\s*/i, 'Dr. ').trim();
      // Strip embedded day names left from Urology-style lines (e.g. "Wed Faisal" → "Faisal")
      name = name.replace(/^\s*(mon|tue|wed|thu|fri|sat|sun)\w*\s+/i, '').trim();
      return {
        ...entry,
        role: normalizeUploadedRole(entry.role || ''),
        name,
        shiftType: entry.shiftType || meta.shiftType || '',
        startTime: entry.startTime || meta.startTime || '',
        endTime: entry.endTime || meta.endTime || '',
        section: normalizeUploadedSpecialtyLabel(entry.section || ROTAS[entry.specialty]?.label || entry.specialty || ''),
      };
    })
    .filter(entry => entry.name && entry.name.length >= 2)
    .filter(entry => !/^taam$/i.test(entry.name))
    .filter(entry => !/\b(?:pdf|obj|endobj|stream|endstream|length|xref|trailer|startxref| t[fdj]|bt|et|eof)\b/i.test(entry.name))
    .filter(entry => (entry.name.match(/\bDr\.?\b/gi) || []).length <= 1)
    // Drop pure initials/abbreviations: "AW", "SAH YSF"
    .filter(entry => {
      const words = entry.name.split(' ').filter(Boolean);
      const allShortCaps = words.every(w => w === w.toUpperCase() && w.length <= 3);
      return !(words.length >= 1 && allShortCaps && entry.name.length <= 4);
    })
    // Accept if: known medical placeholder, has phone, has lowercase letters,
    // OR all-caps name with each word ≥4 chars (proper names like "SARA OWIDAH")
    .filter(entry => {
      if (/^SMRO[D]?$/i.test(entry.name.trim())) return true;  // liver SMRO/SMROD placeholder
      if (/^IM\.?\s*Res(?:ident)?$/i.test(entry.name.trim())) return true;  // liver IM.Resident placeholder
      if (entry.phone) return true;
      if (/[a-z]/.test(entry.name)) return true;
      const words = entry.name.split(' ').filter(Boolean);
      return words.length >= 1 && words.every(w => w.length >= 4) && words.some(w => w.length >= 5);
    })
    // Name blacklist filter — remove headers/labels mistakenly extracted as names
    .filter(entry => {
      if (!isValidDoctorName(entry.name)) {
        console.warn(`[NAME_FILTER] Removed invalid: "${entry.name}"`);
        return false;
      }
      return true;
    })
  );

  // Final deduplication: max 3 occurrences of same (name + role + date)
  const dedupSeen = new Map();
  return deduped.filter(entry => {
    const key = `${(entry.name||'').toLowerCase().trim()}|${entry.role||''}|${entry.date||''}`;
    const count = (dedupSeen.get(key) || 0) + 1;
    dedupSeen.set(key, count);
    if (count > 3) {
      console.warn(`[DEDUP] Removed excess duplicate: "${entry.name}" (${count}x)`);
      return false;
    }
    return true;
  });
}
