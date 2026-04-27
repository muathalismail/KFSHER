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
  const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
  // Detect month/year from this PDF (auto-detects any month, not just April)
  const { month: detectedMon, year: detectedYr, monthPad } = detectPdfMonthYear(text);
  // Flexible: captures any month name + any 4-digit year
  const dayRowRe = /^(SUN|MON|TUE|WED|THU|FRI|SAT)\s+(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})\s+(.+)$/i;
  const mainRows = [];

  lines.forEach(line => {
    const match = line.match(dayRowRe);
    if (!match) return;
    const rowMon = _MONTH_NAMES_FULL.indexOf(match[3].toLowerCase()) + 1;
    const rowYr  = parseInt(match[4], 10);
    if (rowMon !== detectedMon || rowYr !== detectedYr) return;
    const day = String(parseInt(match[2], 10)).padStart(2, '0');
    const tokens = match[5].split(/\s+/).filter(Boolean);
    if (tokens.length < 2) return;
    mainRows.push({
      date: `${day}/${monthPad}`,
      associateAlias: tokens[0],
      consultantAlias: tokens[1],
    });
  });

  mainRows.forEach((row, idx) => {
    const residentTemplate = SURGERY_TEMPLATE_RESIDENTS[row.date] || null;
    const juniorAlias = residentTemplate?.junior || '';
    const seniorAlias = residentTemplate?.senior || '';

    if (juniorAlias) {
      const junior = resolveSurgeryTemplateName(juniorAlias, contactMap);
      if (junior.name) {
        const residentPhone = junior.phone || residentPhones[canonicalName(junior.name)] || '';
        entries.push({
          specialty: deptKey,
          date: row.date,
          role: 'Junior Resident',
          name: junior.name,
          phone: residentPhone,
          phoneUncertain: !residentPhone,
          shiftType: 'on-duty',
          startTime: '07:30',
          endTime: '16:30',
          section: normalizeUploadedSpecialtyLabel(ROTAS[deptKey]?.label || deptKey),
          parsedFromPdf: true,
        });
      }
    }

    if (seniorAlias) {
      const senior = resolveSurgeryTemplateName(seniorAlias, contactMap);
      if (senior.name) {
        const residentPhone = senior.phone || residentPhones[canonicalName(senior.name)] || '';
        entries.push({
          specialty: deptKey,
          date: row.date,
          role: 'Senior Resident',
          name: senior.name,
          phone: residentPhone,
          phoneUncertain: !residentPhone,
          shiftType: 'on-duty',
          startTime: '07:30',
          endTime: '16:30',
          section: normalizeUploadedSpecialtyLabel(ROTAS[deptKey]?.label || deptKey),
          parsedFromPdf: true,
        });
      }
    }

    const associate = resolveSurgeryTemplateName(row.associateAlias, contactMap);
    if (associate.name) {
      entries.push({
        specialty: deptKey,
        date: row.date,
        role: 'Associate On-Call',
        name: associate.name,
        phone: associate.phone,
        phoneUncertain: associate.phoneUncertain,
        shiftType: 'on-duty',
        startTime: '07:30',
        endTime: '16:30',
        section: normalizeUploadedSpecialtyLabel(ROTAS[deptKey]?.label || deptKey),
        parsedFromPdf: true,
      });
    }

    const consultant = resolveSurgeryTemplateName(row.consultantAlias, contactMap);
    if (consultant.name) {
      const consultantPhone = consultant.phone || consultantPhones[canonicalName(consultant.name)] || resolvePhone(ROTAS[deptKey], { name:consultant.name, phone:'' })?.phone || '';
      entries.push({
        specialty: deptKey,
        date: row.date,
        role: 'Consultant On-Call',
        name: consultant.name,
        phone: consultantPhone,
        phoneUncertain: !consultantPhone,
        shiftType: 'on-duty',
        startTime: '07:30',
        endTime: '16:30',
        section: normalizeUploadedSpecialtyLabel(ROTAS[deptKey]?.label || deptKey),
        parsedFromPdf: true,
      });
    }
  });

  const deduped = dedupeParsedEntries(entries);
  deduped._templateDetected = mainRows.length >= 20;
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

