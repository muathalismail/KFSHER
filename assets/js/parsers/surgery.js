// ═══════════════════════════════════════════════════════════════
// parsers/surgery.js — General Surgery PDF parser
// ═══════════════════════════════════════════════════════════════
// Depends on: core/phone-resolver.js, parsers/generic.js
// ═══════════════════════════════════════════════════════════════

function extractSurgeryResidentPhones(text='') {
  const map = {};
  const patterns = [
    /([A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+){1,3})\s+R\d\s+(\d{2})\s+(\d{2})\s+(\d{5})/g,
    /([A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+){1,3})\s+R\d\s+(05\d{8})/g,
  ];
  patterns.forEach(pattern => {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const rawName = match[1].replace(/\s+/g, ' ').trim();
      const phone = match[4] ? `0${match[2]}${match[3]}${match[4]}` : match[2];
      if (/^05\d{8}$/.test(phone)) {
        map[canonicalName(rawName)] = phone;
        map[canonicalName(SURGERY_NAME_HINTS[canonicalName(rawName)] || rawName)] = phone;
      }
    }
  });
  return map;
}

function extractSurgeryConsultantPhones(text='') {
  const map = {};
  const compact = text.replace(/\r/g, '\n');
  const phoneOnlyLines = compact.split('\n')
    .map(line => line.trim())
    .filter(line => /^\d{2}\s*\d{2}\s*\d{5}$/.test(line) || /^05\d{8}$/.test(line))
    .map(line => {
      const digits = line.replace(/[^\d]/g, '');
      return digits.length === 9 ? `0${digits}` : digits;
    })
    .filter(phone => /^05\d{8}$/.test(phone));

  const consultantMatches = [...compact.matchAll(/(Dr\.?\s+[A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,4})\s+Consultant/gi)]
    .map(match => match[1].replace(/\s+/g, ' ').trim());

  consultantMatches.forEach((name, index) => {
    const phone = phoneOnlyLines[index] || '';
    if (!phone) return;
    map[canonicalName(name)] = phone;
    map[canonicalName(SURGERY_NAME_HINTS[canonicalName(name)] || name)] = phone;
  });

  const directMatches = [...compact.matchAll(/(Dr\.?\s+[A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,4}).{0,40}?\b(05\d{8}|\d{2}\s*\d{2}\s*\d{5})\b/gi)];
  directMatches.forEach(match => {
    const name = match[1].replace(/\s+/g, ' ').trim();
    const digits = match[2].replace(/[^\d]/g, '');
    const phone = digits.length === 9 ? `0${digits}` : digits;
    if (!/^05\d{8}$/.test(phone)) return;
    map[canonicalName(name)] = phone;
    map[canonicalName(SURGERY_NAME_HINTS[canonicalName(name)] || name)] = phone;
  });
  return map;
}

function parseSurgeryPdfEntries(text='', deptKey='surgery') {
  const entries = [];
  const contactMap = buildContactMapFromText(text);
  const residentPhones = extractSurgeryResidentPhones(text);
  const consultantPhones = extractSurgeryConsultantPhones(text);
  const { month: detectedMon, year: detectedYr, monthPad } = detectPdfMonthYear(text);
  const section = normalizeUploadedSpecialtyLabel(ROTAS[deptKey]?.label || deptKey);
  const isColumnar = text.includes('\t');
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  // Tab-separated format: "1 April 2026\tJrER\tSrER\tGSAssoc\tGSConsult"
  const tabDateRe = /^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/;
  // Plain text format: "WED 1 April 2026 ..."
  const plainDateRe = /^(SUN|MON|TUE|WED|THU|FRI|SAT)\s+(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})\s+(.+)$/i;
  let rowCount = 0;

  const pushEntry = (dateKey, alias, role) => {
    if (!alias || /^GS\s/i.test(alias)) return;
    const resolved = resolveSurgeryTemplateName(alias, contactMap);
    if (!resolved.name) return;
    const phone = resolved.phone
      || residentPhones[canonicalName(resolved.name)]
      || consultantPhones[canonicalName(resolved.name)]
      || resolvePhone(ROTAS[deptKey], { name: resolved.name, phone: '' })?.phone
      || '';
    entries.push({
      specialty: deptKey, date: dateKey, role, name: resolved.name,
      phone, phoneUncertain: !phone,
      shiftType: '24h', startTime: '07:30', endTime: '07:30',
      section, parsedFromPdf: true,
    });
  };

  for (const line of lines) {
    if (isColumnar && line.includes('\t')) {
      // Server-extracted tab-separated: date \t jr_er \t sr_er \t gs_assoc \t gs_consult
      const cols = line.split('\t');
      const dateMatch = (cols[0] || '').trim().match(tabDateRe);
      if (!dateMatch) continue;
      const rowMon = _MONTH_NAMES_FULL.indexOf(dateMatch[2].toLowerCase()) + 1;
      const rowYr = parseInt(dateMatch[3], 10);
      if (rowMon !== detectedMon || rowYr !== detectedYr) continue;
      const dateKey = `${String(parseInt(dateMatch[1], 10)).padStart(2, '0')}/${monthPad}`;
      pushEntry(dateKey, (cols[1] || '').trim(), 'Junior ER');
      pushEntry(dateKey, (cols[2] || '').trim(), 'Senior ER');
      pushEntry(dateKey, (cols[3] || '').trim(), 'Associate On-Call');
      pushEntry(dateKey, (cols[4] || '').trim(), 'Consultant On-Call');
      rowCount++;
    } else if (!isColumnar) {
      // Plain text fallback ONLY when server extraction was unavailable.
      // When isColumnar=true, plain text is appended only for contact map building —
      // schedule data comes exclusively from tab-separated lines above.
      const match = line.match(plainDateRe);
      if (!match) continue;
      const rowMon = _MONTH_NAMES_FULL.indexOf(match[3].toLowerCase()) + 1;
      const rowYr = parseInt(match[4], 10);
      if (rowMon !== detectedMon || rowYr !== detectedYr) continue;
      const dateKey = `${String(parseInt(match[2], 10)).padStart(2, '0')}/${monthPad}`;
      const tokens = match[5].split(/\s+/).filter(Boolean);
      if (tokens.length >= 2) {
        pushEntry(dateKey, tokens[0], 'Associate On-Call');
        pushEntry(dateKey, tokens[1], 'Consultant On-Call');
        rowCount++;
      }
    }
  }

  const deduped = dedupeParsedEntries(entries);
  deduped._templateDetected = rowCount >= 20;
  deduped._templateName = deduped._templateDetected ? `surgery-${monthPad}-${detectedYr}` : '';
  return deduped;
}

function isNeurologyDutyTemplate(text='') {
  const markers = [
    /Junior Resident\s+Senior Resident\s+Associate/i,
    /PHYSICIANS ON-DUTY/i,
    /Neurology Department/i,
    /Stroke\s+On-?call Consultant/i,
  ];
  return markers.filter(re => re.test(text || '')).length >= 3;
}

const NEUROLOGY_ALIAS_HINTS = {
  'Dr. Adnan':'Dr. Adnan Al Sarawi',
  'Dr. Naif':'Dr. Naif Alzahrani',
  'Dr. Talal':'Dr. Talal Al-Harbi',
  'Dr. Saadia':'Dr. Saadia Afzal',
  'Dr. Eman':'Dr. Eman Nassim Ali',
  'Eman':'Dr. Eman Nassim Ali',
  'Dr. Bader':'Dr. Bader Alenzi',
  'Dr. Roaa':'Dr. Roaa Khallaf',
  'Dr. Khaled':'Dr. Khalid Al Rasheed',
  'Dr Rakan Al Shammari':'Dr. Rakan Al Shammari',
  'Rakan':'Dr. Rakan Al Shammari',
  'Mohammed AW':'Dr. Mohammed Alawazem',
  'Ghady':'Dr. Ghady AlFuridy',
  'Hawra':'Dr. Hawra Alshakhori',
};

