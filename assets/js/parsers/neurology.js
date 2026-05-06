// ═══════════════════════════════════════════════════════════════
// parsers/neurology.js — Neurology PDF parser
// ═══════════════════════════════════════════════════════════════
// Depends on: core/phone-resolver.js, parsers/generic.js
// ═══════════════════════════════════════════════════════════════

function buildNeurologyUploadContactMap(text='') {
  const map = { ...(ROTAS.neurology?.contacts || {}) };
  const lines = text.split(/\n/).map(line => line.trim()).filter(Boolean);
  const addPhone = (rawName='', rawPhone='') => {
    const cleanedName = rawName.replace(/\s+/g, ' ').replace(/^Dr\.?\s*/i, 'Dr. ').trim();
    let phone = String(rawPhone || '').replace(/[^\d]/g, '');
    if (/^5\d{8}$/.test(phone)) phone = `0${phone}`;
    if (!/^05\d{8}$/.test(phone) || !cleanedName) return;
    map[cleanedName] = phone;
  };

  lines.forEach(line => {
    const directMatch = line.match(/(Dr\.?\s*[A-Za-z][A-Za-z.'-]*(?:\s+[A-Za-z][A-Za-z.'-]*){0,4}).*?\b(05\d{8}|5\d{8})\b/);
    if (directMatch) {
      addPhone(directMatch[1], directMatch[2]);
      return;
    }
    const residentMatch = line.match(/^(?:Dr\.?\s*)?([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,3})\s+(05\d{8}|5\d{8})\b/);
    if (residentMatch) addPhone(residentMatch[1], residentMatch[2]);
  });

  const firstNameMatches = new Map();
  Object.entries(map).forEach(([name, phone]) => {
    const bare = name.replace(/^Dr\.?\s*/i, '').trim();
    const first = bare.split(/\s+/)[0];
    if (!first) return;
    if (!firstNameMatches.has(first)) firstNameMatches.set(first, []);
    firstNameMatches.get(first).push({ name, phone });
  });
  firstNameMatches.forEach((matches, first) => {
    if (matches.length === 1) map[first] = matches[0].phone;
  });
  return map;
}

function resolveNeurologyTemplatePerson(alias='', contactMap={}) {
  const trimmed = alias.replace(/\s+/g, ' ').trim();
  if (!trimmed) return { name:'', phone:'' };
  const hinted = NEUROLOGY_ALIAS_HINTS[trimmed] || trimmed;
  const normalizedHint = hinted.replace(/^Dr\.?\s*/i, '').toLowerCase();
  const exactKey = Object.keys(contactMap).find(key => key.replace(/^Dr\.?\s*/i, '').toLowerCase() === normalizedHint);
  const firstToken = normalizedHint.split(/\s+/)[0];
  const firstTokenKey = !exactKey
    ? Object.keys(contactMap).find(key => key.replace(/^Dr\.?\s*/i, '').toLowerCase().startsWith(`${firstToken} `))
    : '';
  const name = exactKey || firstTokenKey || hinted;
  return {
    name,
    phone: contactMap[name] || contactMap[trimmed] || '',
  };
}

function parseNeurologyResidentAliases(prefix='') {
  const tokens = prefix.split(/\s+/).filter(Boolean);
  if (!tokens.length) return { junior:'', senior:'' };
  if (tokens.length === 1) return { junior:tokens[0], senior:'' };
  return {
    junior: tokens.slice(0, -1).join(' '),
    senior: tokens.slice(-1).join(' '),
  };
}

function parseNeurologyPdfEntries(text='', deptKey='neurology') {
  const entries = [];
  const templateDetected = isNeurologyDutyTemplate(text);
  const contactMap = buildNeurologyUploadContactMap(text);
  const lines = text.split(/\n/).map(line => line.trim()).filter(Boolean);
  // Detect month/year from PDF — matches any abbreviated month + 2-digit year
  const { month: detectedMon, year: detectedYr, monthPad, monthAbbr } = detectPdfMonthYear(text);
  const detectedYr2 = detectedYr % 100; // 2-digit year for "Apr-26" style
  const rowRe = /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat)\s+(\d{1,2})-([A-Za-z]{3})-(\d{2,4})\s+(.+)$/i;
  let inOnCallTable = false;

  lines.forEach(line => {
    if (/Junior Resident\s+Senior Resident/i.test(line)) {
      inOnCallTable = true;
      return;
    }
    if (/Approved by:|Neurology OPD schedule|Stroke pager/i.test(line)) {
      inOnCallTable = false;
    }
    if (!inOnCallTable) return;
    const match = line.match(rowRe);
    if (!match) return;
    // Filter: only rows matching the detected month/year
    const rowMonIdx = _MONTH_ABBRS.indexOf(match[3].toLowerCase());
    const rowMon = rowMonIdx + 1;
    const rowYr  = parseInt(match[4], 10);
    const rowYr4 = rowYr < 100 ? 2000 + rowYr : rowYr;
    if (rowMon !== detectedMon || rowYr4 !== detectedYr) return;
    let tail = (match[5] || '').replace(/\s+\d{6,}(?:\s+\d{6,})*$/, '').trim();
    if (!tail) return;
    const firstDrIndex = tail.search(/Dr\.?\s*/i);
    if (firstDrIndex <= 0) return;
    const prefix = tail.slice(0, firstDrIndex).trim();
    if (!prefix || prefix.split(/\s+/).length > 3) return;
    const doctorSegments = tail.slice(firstDrIndex)
      .split(/(?=Dr\.?\s*)/i)
      .map(item => item.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    if (doctorSegments.length < 2) return;

    const { junior, senior } = parseNeurologyResidentAliases(prefix);
    const dateKey = `${String(parseInt(match[2], 10)).padStart(2, '0')}/${monthPad}`;

    const pushEntry = (nameAlias, role) => {
      if (!nameAlias || /associate consultants|residents/i.test(nameAlias)) return;
      const resolved = resolveNeurologyTemplatePerson(nameAlias, contactMap);
      if (!resolved.name) return;
      entries.push({
        specialty: deptKey,
        date: dateKey,
        role,
        name: resolved.name,
        phone: resolved.phone || '',
        shiftType: 'on-call',
        startTime: '16:30',
        endTime: '07:30',
        section: normalizeUploadedSpecialtyLabel(ROTAS[deptKey]?.label || deptKey),
        parsedFromPdf: true,
      });
    };

    pushEntry(junior, '1st On-Call Resident');
    pushEntry(senior, '2nd On-Call Senior Resident');
    // Assign doctor segments by count to prevent drift when Associate cell is empty:
    // 3 segments: Associate, Consultant, Stroke
    // 2 segments: (no Associate), Consultant, Stroke
    // 1 segment:  (no Associate), Consultant, (no Stroke)
    if (doctorSegments.length >= 3) {
      pushEntry(doctorSegments[0], 'Associate Consultant On-Call');
      pushEntry(doctorSegments[1], 'Consultant On-Call');
      pushEntry(doctorSegments[2], 'Stroke On-Call Consultant');
    } else if (doctorSegments.length === 2) {
      pushEntry(doctorSegments[0], 'Consultant On-Call');
      pushEntry(doctorSegments[1], 'Stroke On-Call Consultant');
    } else if (doctorSegments.length === 1) {
      pushEntry(doctorSegments[0], 'Consultant On-Call');
    }
  });

  const deduped = dedupeParsedEntries(entries);
  deduped._templateDetected = templateDetected;
  deduped._templateName = templateDetected ? `neurology-${monthPad}-${detectedYr}` : '';
  return deduped;
}

