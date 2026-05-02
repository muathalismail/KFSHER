// ═══════════════════════════════════════════════════════════════
// parsers/medicine.js — Medicine On-Call + subspecialty parsers
// ═══════════════════════════════════════════════════════════════
// Depends on: core/phone-resolver.js, parsers/generic.js
// ═══════════════════════════════════════════════════════════════

function parseMedicineOnCallDateBlocks(lines=[]) {
  const dayLineRe = /\b(?:Sun|Mon|Tue|Wed|Wen|Thu|Fri|Sat)\s+\d{1,2}\/\d{1,2}\b/gi;
  return (lines || [])
    .filter(line => line.match(dayLineRe))
    .map(line => Array.from(line.matchAll(/(?:Sun|Mon|Tue|Wed|Wen|Thu|Fri|Sat)\s+(\d{1,2})\/(\d{1,2})/gi)).map(match => ({
      dateKey: `${String(parseInt(match[1], 10)).padStart(2, '0')}/${String(parseInt(match[2], 10)).padStart(2, '0')}`,
    })))
    .filter(group => group.length >= 3);
}

function compactMedicineAlias(value='') {
  return String(value || '')
    .toLowerCase()
    .replace(/^dr\.?\s*/i, '')
    .replace(/[^a-z0-9]+/g, '');
}

function cleanMedicineOnCallResolvedName(name='') {
  return String(name || '')
    .replace(/\bDr\.([A-Za-z])/gi, 'Dr. $1')  // "Dr.Bushra" → "Dr. Bushra"
    .replace(/\bResiden\s*t?\b.*$/i, '')
    .replace(/\bResident\b.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildMedicineOnCallAliasIndex(contactResult=null) {
  const dept = ROTAS.medicine_on_call || { contacts:{} };
  const phoneToFullName = new Map();
  Object.entries(contactResult?.map || {}).forEach(([name, phone]) => {
    if (/^Dr/i.test(name || '') && phone) phoneToFullName.set(cleanPhone(phone), name);
  });
  const aliasIndex = new Map();
  Object.entries(dept.contacts || {}).forEach(([alias, phone]) => {
    const compact = compactMedicineAlias(alias);
    if (!compact) return;
    const canonical = phoneToFullName.get(cleanPhone(phone || '')) || (/^Dr/i.test(alias) ? alias : `Dr. ${alias}`);
    aliasIndex.set(compact, cleanMedicineOnCallResolvedName(canonical.replace(/\s+/g, ' ').trim()));
  });
  Object.keys(contactResult?.map || {}).forEach(name => {
    const compact = compactMedicineAlias(name);
    if (!compact) return;
    aliasIndex.set(compact, cleanMedicineOnCallResolvedName(name.replace(/\s+/g, ' ').trim()));
  });
  return aliasIndex;
}

function splitMedicineOnCallRowNames(body='', aliasIndex=null, expectedCount=MEDICINE_ON_CALL_ROLE_SEQUENCE.length) {
  // Pre-process tokens:
  // 1. Normalize "Dr.Bushra" → "Dr. Bushra" (PDF sometimes omits the space)
  // 2. Merge standalone "Dr." / "Dr" tokens with the following token
  //    so "Dr." doesn't consume a slot by itself in the DP split.
  // 3. Merge single-letter initial tokens ("F.", "A.", "S.", "Z.", "M.", "H.")
  //    with the following token.  PDF.js sometimes inserts a space after the
  //    dot in "F.Yaqoub" → "F." + "Yaqoub", which breaks the 6-slot DP split
  //    (7 tokens for 6 slots → tie-breaking picks the wrong grouping).
  const rawTokens = String(body || '').trim()
    .replace(/\bDr\.([A-Za-z])/gi, 'Dr. $1')  // "Dr.Bushra" → "Dr. Bushra"
    .split(/\s+/).filter(Boolean);
  const tokens = [];
  for (let i = 0; i < rawTokens.length; i++) {
    if (/^Dr\.?$/i.test(rawTokens[i]) && i + 1 < rawTokens.length && !/^Dr\.?$/i.test(rawTokens[i + 1])) {
      tokens.push(`${rawTokens[i]} ${rawTokens[i + 1]}`);
      i++; // skip next token — already merged
    } else if (/^[A-Za-z]\.?$/.test(rawTokens[i]) && i + 1 < rawTokens.length && /^[A-Za-z]{2,}/.test(rawTokens[i + 1])) {
      // Single-letter initial like "F." or "S" followed by a name token — merge them
      // so "F." + "Yaqoub" → "F.Yaqoub" (reconstruct the Initial.Name pattern)
      const initial = rawTokens[i].replace(/\.?$/, '');  // strip trailing dot if present
      tokens.push(`${initial}.${rawTokens[i + 1]}`);
      i++; // skip next token — already merged
    } else {
      tokens.push(rawTokens[i]);
    }
  }
  const memo = new Map();
  const maxWidth = 4;

  function solve(index, slot) {
    const key = `${index}|${slot}`;
    if (memo.has(key)) return memo.get(key);
    const remainingTokens = tokens.length - index;
    const remainingSlots = expectedCount - slot;
    if (remainingSlots === 0) return index === tokens.length ? { score:0, groups:[] } : null;
    if (remainingTokens < remainingSlots || remainingTokens > remainingSlots * maxWidth) return null;

    let best = null;
    for (let width = 1; width <= Math.min(maxWidth, remainingTokens); width += 1) {
      const raw = tokens.slice(index, index + width).join(' ');
      const compact = compactMedicineAlias(raw);
      const canonical = aliasIndex?.get(compact) || '';
      const tail = solve(index + width, slot + 1);
      if (!tail) continue;
      const score = tail.score + (canonical ? 4 : 0) + width;
      const candidate = { score, groups:[canonical || raw, ...tail.groups] };
      if (!best || candidate.score > best.score) best = candidate;
    }
    memo.set(key, best);
    return best;
  }

  return solve(0, 0)?.groups || [];
}

function resolveMedicineOnCallName(raw='', contactResult=null, section='') {
  // Normalize "Dr.Name" → "Dr. Name" early — PDF sometimes omits the space
  const token = String(raw || '').trim().replace(/^[.-]+|[.-]+$/g, '').replace(/^Dr\.([A-Za-z])/i, 'Dr. $1');
  if (!token) return '';
  // If name is already fully resolved (starts with "Dr."), skip fuzzy matching.
  if (/^Dr\.?\s/i.test(token)) return token;
  const dept = ROTAS.medicine_on_call || { contacts:{} };
  const directCandidates = [
    token,
    token.replace(/\s+/g, ''),
    token.replace(/\s+/g, '.'),
  ];
  for (const candidate of directCandidates) {
    if (dept.contacts?.[candidate]) {
      if (/^dr\.?/i.test(candidate)) return candidate;
      // Non-Dr alias matched — reverse-lookup full name by phone
      const aliasPhone = dept.contacts[candidate];
      const fullEntry = Object.entries(dept.contacts).find(([cn, cp]) =>
        cp === aliasPhone && /^Dr\.?\s/i.test(cn)
      );
      if (fullEntry) return fullEntry[0];
    }
  }
  const normalizedToken = normalizeText(token.replace(/\./g, ' '));
  const bareToken = normalizedToken.replace(/^dr\b/, '').trim();
  let best = null;
  Object.keys(contactResult?.map || {}).forEach(name => {
    const candidateNorm = normalizeText(String(name || '').replace(/^Dr\.?\s*/i, '').replace(/\./g, ' '));
    if (!candidateNorm) return;
    const candidateTokens = candidateNorm.split(' ').filter(Boolean);
    const tokenBits = bareToken.split(' ').filter(Boolean);
    if (!tokenBits.length) return;
    const firstBit = tokenBits[0];
    const lastBit = tokenBits[tokenBits.length - 1];
    const firstMatch = firstBit.length === 1
      ? !!candidateTokens[0]?.startsWith(firstBit)
      : candidateTokens.some(bit => bit === firstBit || bit.startsWith(firstBit)
          || (firstBit.length >= 5 && bit.length >= 5 && levenshtein(firstBit, bit) <= 1));
    // lastMatch: exact/prefix OR Levenshtein ≤ 2 for tokens ≥ 5 chars.
    // Handles transliteration variants like "aldhakeel" ≈ "aldhakhel" (dist 1).
    const lastMatch = lastBit.length >= 3
      ? candidateTokens.some(bit =>
          bit === lastBit ||
          bit.startsWith(lastBit) ||
          (lastBit.length >= 5 && bit.length >= 5 && levenshtein(lastBit, bit) <= 2)
        )
      : true;
    if (!firstMatch || !lastMatch) return;
    const score = scoreNameMatch(token, name) || scoreNameMatch(`Dr. ${token}`, name);
    if (!score) return;
    // Prefer names already in ROTAS contacts over PDF-extracted-only names when scores tie
    const inRotas = name in (dept.contacts || {});
    let effectiveScore = score.score + (inRotas ? 1 : 0);
    // Position-based disambiguation: prefer candidates whose resident level matches the column
    if (section && contactResult?.positionMap) {
      const posNk = (name || '').toLowerCase().replace(/^dr\.?\s*/, '').replace(/\./g, ' ').replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
      const pos = contactResult.positionMap[posNk];
      if (pos) {
        const isSeniorCol = /senior/i.test(section);
        const isSeniorRes = pos.level >= 3;
        if (isSeniorCol === isSeniorRes) effectiveScore += 2;
      }
    }
    if (!best || effectiveScore > best.score) best = { name, score: effectiveScore };
  });
  if (best?.name) {
    const resolved = cleanMedicineOnCallResolvedName(best.name);
    // Always display with "Dr." prefix — the match may come from PDF contact map
    // entries that lack the honorific (e.g. "Bushra Alshehri" stored without "Dr.").
    return /^Dr\.?\s/i.test(resolved) ? resolved : `Dr. ${resolved}`;
  }
  const fallback = token.replace(/\b([A-Z])\./g, '$1. ').replace(/\s+/g, ' ').trim();
  return cleanMedicineOnCallResolvedName(/^dr\.?/i.test(fallback) ? fallback : `Dr. ${fallback}`.trim());
}

function buildMedicineOnCallRow(dateKey='', roleMeta={}, rawName='', contactResult=null, deptKey='medicine_on_call') {
  const name = resolveMedicineOnCallName(rawName, contactResult, roleMeta.section);
  // Evaluate both sources independently — do NOT short-circuit on uncertain results.
  // "Ali" is 3 chars and gets filtered from nameParts (threshold ≥ 4), so the fuzzy
  // step in resolvePhoneFromContactMap returns uncertain=true even when it finds the
  // correct phone.  The ROTAS exact-key lookup would give uncertain=false but is
  // never reached because the truthy uncertain result blocks the || chain.
  const pdfPhone   = resolvePhoneFromContactMap(name, contactResult);
  const rotasPhone = resolvePhone(ROTAS[deptKey] || { contacts:{} }, { name, phone:'' });
  // Prefer certain over uncertain; among equals prefer PDF (more current).
  const phoneMeta = (pdfPhone   && !pdfPhone.uncertain   ? pdfPhone   : null)
                 || (rotasPhone  && !rotasPhone.uncertain  ? rotasPhone  : null)
                 || pdfPhone || rotasPhone
                 || { phone:'', uncertain:true };
  // If phone resolution found a fuller name (e.g. "Dr. Sara Alaboud" for "S.Alaboud"),
  // use it — but only if it is a real expanded name (not just "Dr.", a role label, or garbage).
  // A valid matchedName must have ≥1 real name token (≥3 chars, not a role word) after stripping "Dr.".
  const _rawMatched = phoneMeta.matchedName;
  const _bareMatched = _rawMatched ? cleanMedicineOnCallResolvedName(_rawMatched).replace(/^Dr\.?\s*/i, '').trim() : '';
  const _matchedRealTokens = _bareMatched
    ? _bareMatched.split(/\s+/).filter(t => t.length >= 3 && !/^(resident|consultant|associate|fellow|senior|junior|physician|specialist)$/i.test(t))
    : [];
  const _resolvedDisplay = (_matchedRealTokens.length >= 1 && _bareMatched.length > name.replace(/^Dr\.?\s*/i,'').trim().length)
    ? cleanMedicineOnCallResolvedName(_rawMatched)
    : name;
  // Normalize "Dr.Name" → "Dr. Name" before prefix check — PDF sometimes omits space
  const _normalized = (_resolvedDisplay || '').replace(/^Dr\.([A-Za-z])/i, 'Dr. $1');
  // Always ensure "Dr." prefix — matchedName from PDF map may lack the honorific
  let displayName = _normalized && _normalized.replace(/^Dr\.?\s*/i,'').trim().length > 1 && !/^Dr\.?\s/i.test(_normalized)
    ? `Dr. ${_normalized}` : _normalized;
  // Safety net: if displayName is just "Dr." (bare honorific with no real name),
  // try to recover the real name from ROTAS contacts by phone number reverse lookup.
  if (displayName && displayName.replace(/^Dr\.?\s*/i,'').trim().length <= 1 && phoneMeta.phone) {
    const dept = ROTAS[deptKey] || { contacts:{} };
    for (const [cn, cp] of Object.entries(dept.contacts || {})) {
      if (cp === phoneMeta.phone && cn.replace(/^Dr\.?\s*/i,'').trim().length >= 2) {
        displayName = /^Dr\.?\s/i.test(cn) ? cn : `Dr. ${cn}`;
        break;
      }
    }
  }
  return {
    specialty: deptKey,
    date: dateKey,
    role: roleMeta.role,
    name: displayName,
    phone: phoneMeta.phone || '',
    phoneUncertain: !phoneMeta.phone || !!phoneMeta.uncertain,
    section: roleMeta.section,
    shiftType: roleMeta.shiftType,
    startTime: roleMeta.startTime,
    endTime: roleMeta.endTime,
    parsedFromPdf: true,
  };
}

function parseMedicineOnCallWeekendBlocks(lines=[], contactResult=null, deptKey='medicine_on_call') {
  const entries = [];
  const headerRe = /^(Fri|Sat)\s+(\d{1,2})\/(\d{1,2})$/i;
  for (let i = 0; i < lines.length; i += 1) {
    const match = String(lines[i] || '').trim().match(headerRe);
    if (!match) continue;
    const dateKey = `${String(parseInt(match[2], 10)).padStart(2, '0')}/${String(parseInt(match[3], 10)).padStart(2, '0')}`;
    const rawNames = [];
    let cursor = i + 1;
    while (cursor < lines.length && rawNames.length < MEDICINE_ON_CALL_ROLE_SEQUENCE.length) {
      const candidate = String(lines[cursor] || '').trim();
      if (!candidate) {
        cursor += 1;
        continue;
      }
      if (headerRe.test(candidate)) break;
      rawNames.push(candidate);
      cursor += 1;
    }
    if (rawNames.length === MEDICINE_ON_CALL_ROLE_SEQUENCE.length) {
      rawNames.forEach((rawName, index) => {
        entries.push(buildMedicineOnCallRow(dateKey, MEDICINE_ON_CALL_ROLE_SEQUENCE[index], rawName, contactResult, deptKey));
      });
    }
    i = cursor - 1;
  }
  return entries;
}

function parseMedicineOnCallPdfEntries(text='', deptKey='medicine_on_call') {
  const contactResult = buildContactMapFromText(text);
  const entries = [];

  // ── PRIMARY PATH: server-side pdfplumber schedule (accurate column extraction) ──
  const serverSchedule = parseMedicineOnCallPdfEntries._serverSchedule;
  if (Array.isArray(serverSchedule) && serverSchedule.length) {
    console.log(`[MEDICINE_ONCALL] Using server-extracted schedule (${serverSchedule.length} rows)`);
    const FIELD_TO_ROLE = [
      { field: 'jw_day',    role: MEDICINE_ON_CALL_ROLE_SEQUENCE[0] },
      { field: 'jw_night',  role: MEDICINE_ON_CALL_ROLE_SEQUENCE[1] },
      { field: 'jer_day',   role: MEDICINE_ON_CALL_ROLE_SEQUENCE[2] },
      { field: 'jer_night', role: MEDICINE_ON_CALL_ROLE_SEQUENCE[3] },
      { field: 'sr_day',    role: MEDICINE_ON_CALL_ROLE_SEQUENCE[4] },
      { field: 'sr_night',  role: MEDICINE_ON_CALL_ROLE_SEQUENCE[5] },
    ];
    for (const row of serverSchedule) {
      const dateKey = row.date || '';
      if (!dateKey) continue;
      for (const { field, role } of FIELD_TO_ROLE) {
        const rawName = (row[field] || '').trim();
        if (rawName) {
          entries.push(buildMedicineOnCallRow(dateKey, role, rawName, contactResult, deptKey));
        }
      }
    }
    const deduped = dedupeParsedEntries(entries);
    deduped._templateDetected = deduped.length >= 60;
    deduped._templateName = deduped._templateDetected ? 'medicine-on-call-grid' : '';
    deduped._coreSectionsFound = Array.from(new Set(deduped.map(entry => entry.section).filter(Boolean)));
    deduped._serverExtracted = true;
    return deduped;
  }

  // ── FALLBACK: client-side text parsing (DP token splitting) ──
  console.log('[MEDICINE_ONCALL] No server schedule — falling back to client-side text parsing');
  const aliasIndex = buildMedicineOnCallAliasIndex(contactResult);
  const lines = String(text || '').split(/\n/).map(line => line.trim()).filter(Boolean);
  // Track filled slots: "dateKey|section|shiftType" → true
  // Prevents duplicate entries when a date row appears twice in the PDF
  // (e.g. table header repeats at a page break).
  const filledSlots = new Set();
  const dayRowRe = /^(Sun|Mon|Tue|Wed|Wen|Thu|Fri|Sat)\s+(\d{1,2})\/(\d{1,2})\s+(.+)$/i;

  lines.forEach(line => {
    const match = line.match(dayRowRe);
    if (!match) return;
    if (/Day\s*\/\s*Date/i.test(line) || /Junior\s+Ward/i.test(line)) return;
    const dateKey = `${String(parseInt(match[2], 10)).padStart(2, '0')}/${String(parseInt(match[3], 10)).padStart(2, '0')}`;
    // Skip this line entirely if the first slot for this date is already filled —
    // it's a repeated header row (page break) not a new date.
    const firstRole = MEDICINE_ON_CALL_ROLE_SEQUENCE[0];
    const firstSlot = `${dateKey}|${firstRole.section}|${firstRole.shiftType}`;
    if (filledSlots.has(firstSlot)) return;
    const groups = splitMedicineOnCallRowNames(match[4], aliasIndex, MEDICINE_ON_CALL_ROLE_SEQUENCE.length);
    if (groups.length !== MEDICINE_ON_CALL_ROLE_SEQUENCE.length) return;
    groups.forEach((rawName, index) => {
      const roleMeta = MEDICINE_ON_CALL_ROLE_SEQUENCE[index];
      filledSlots.add(`${dateKey}|${roleMeta.section}|${roleMeta.shiftType}`);
      entries.push(buildMedicineOnCallRow(dateKey, roleMeta, rawName, contactResult, deptKey));
    });
  });

  const deduped = dedupeParsedEntries(entries);
  deduped._templateDetected = deduped.length >= 60;
  deduped._templateName = deduped._templateDetected ? 'medicine-on-call-grid' : '';
  deduped._coreSectionsFound = Array.from(new Set(deduped.map(entry => entry.section).filter(Boolean)));
  return deduped;
}

function isLegacyHospitalistRecord(record) {
  if (!record || record.deptKey !== 'hospitalist' || !Array.isArray(record.entries) || !record.entries.length) return false;
  const oncologyStructured = record.entries.filter(entry =>
    normalizeText(entry.section || '') === 'oncology er'
    && !!entry.startTime
    && !!entry.endTime
  ).length;
  const oncologyNames = record.entries.filter(entry =>
    normalizeText(entry.section || '') === 'oncology er'
    && !!(entry.name || '').trim()
  ).length;
  return oncologyStructured < 2 || oncologyNames < 2;
}

function getHospitalistEntries(schedKey, now) {
  const dept = ROTAS.hospitalist;
  if (!dept) return [];
  const entries = (dept.schedule[schedKey] || []).map(entry => ({ ...entry }));
  if (!entries.length) return [];
  const oncologyOnly = entries.filter(entry => (entry.section || '') === 'Oncology ER');
  const source = oncologyOnly.length ? oncologyOnly : entries;
  const mins = now.getHours() * 60 + now.getMinutes();
  const active = source.filter(entry => {
    const start = parseTimeMinutes(entry.startTime || '');
    const end = parseTimeMinutes(entry.endTime || '');
    if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
    if (end > start) return mins >= start && mins < end;
    return mins >= start || mins < end;
  });
  return active;
}


function parseMedicinePdfEntries(text='', targetDeptKey='medicine') {
  const specialtyMap = [
    ['endocrinology', /endocrinology|endocrine|diabetes/i],
    ['dermatology', /dermatology|derma\b|skin\b/i],
    ['rheumatology', /rheumatology|rheuma/i],
    ['gastroenterology', /gastroenterology|\bgi\b|ercp/i],
    ['pulmonary', /pulmonary|pulmonology|respiratory|chest/i],
    ['infectious', /infectious|infection|\bid\b/i],
  ];

  // Build contact map from full text (staff table with names + mobiles)
  const contactMap = buildContactMapFromText(text);

  const lines = text.split(/\n/).map(line => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const entries = [];
  let currentSpecialty = null;
  let currentDate = '';

  // Pre-scan: detect specialty section headers
  // Medicine PDFs often list specialty in contact table: "Dr. X Consultant – Dermatology ... phone"
  const contactEntries = [];
  for (const line of lines) {
    const phone = parsePhoneFromLine(line);
    if (!phone) continue;
    const spec = specialtyMap.find(([, re]) => re.test(line));
    if (!spec) continue;
    const deptKey = spec[0];
    // Extract name from line
    const namePart = line.replace(/(?:\+?966[\s-]*)?0?5[\d\s-]{7,16}/g, ' ')
      .replace(/\b\d{3,}\b/g, ' ')
      .replace(/consultant|fellow|resident|associate|section|head|chair|director|program/gi, ' ')
      .replace(/[^A-Za-z\u0600-\u06FF .'-]+/g, ' ')
      .replace(/\s+/g, ' ').trim();
    const drMatch = namePart.match(/(?:Dr\.?\s+)?([A-Z][a-z]+(?: [A-Z][a-z'-]+){1,3})/);
    const name = drMatch ? drMatch[0].replace(/\s+/, ' ').trim() : '';
    if (!name || name.length < 4) continue;
    // Determine role from line
    const roleLow = line.toLowerCase();
    let role = 'Consultant On-Call';
    if (/fellow/i.test(roleLow)) role = 'Fellow';
    else if (/resident/i.test(roleLow)) role = '1st On-Call Resident';
    else if (/associate/i.test(roleLow)) role = 'Consultant On-Call';
    contactEntries.push({ specialty: deptKey, date: '', role, name, phone, section: ROTAS[deptKey]?.label || deptKey, parsedFromPdf: true, coverageType: 'on-call' });
  }

  // Parse schedule rows line by line
  lines.forEach(line => {
    const spec = specialtyMap.find(([, re]) => re.test(line));
    if (spec) currentSpecialty = spec[0];
    const date = parseDateKeyFromLine(line);
    if (date) currentDate = date;
    const phone = parsePhoneFromLine(line);
    const hasRole = /(1st|2nd|3rd|first|second|third|resident|fellow|consultant|on[\s-]?call|after\s+\d)/i.test(line);
    if (!phone && !hasRole) return;
    if (!currentSpecialty) {
      // Try to detect specialty from the line itself even without a header
      const inlineSpec = specialtyMap.find(([, re]) => re.test(line));
      if (inlineSpec) currentSpecialty = inlineSpec[0];
    }
    if (!currentSpecialty) return;
    const name = phone ? extractNameNearPhone(line) : '';
    if (phone && (!name || name.length < 2)) return;
    const entry = {
      specialty: currentSpecialty,
      date: date || currentDate,
      role: roleFromLine(line, 'On-Call'),
      name: name || '',
      phone: phone || '',
      ...parseTimeRangeFromLine(line),
      section: ROTAS[currentSpecialty]?.label || currentSpecialty,
      parsedFromPdf: true,
    };
    entry.coverageType = medicineCoverageType(entry);
    // Fill phone from contact map if missing
    if (!entry.phone && entry.name) {
      const resolved = resolvePhoneFromContactMap(entry.name, contactMap);
      if (resolved) { entry.phone = resolved.phone; entry.phoneUncertain = resolved.uncertain; }
    }
    entries.push(entry);
  });

  // Merge contact entries and schedule entries; prefer schedule entries with dates
  const all = dedupeParsedEntries([...entries, ...contactEntries]);
  if (targetDeptKey !== 'medicine') return all.filter(entry => entry.specialty === targetDeptKey);
  return all;
}

// normalizeParsedEntries → moved to parsers/generic.js (shared)

