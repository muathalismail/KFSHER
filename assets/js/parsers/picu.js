// ═══════════════════════════════════════════════════════════════
// parsers/picu.js — PICU specialty parser
// ═══════════════════════════════════════════════════════════════
// Depends on: core/phone-resolver.js, parsers/generic.js
// ═══════════════════════════════════════════════════════════════

const PICU_NAME_HINTS = {
  'dr marah': 'Dr. Marah',
  'dr ghadeer': 'Dr. Ghadeer',
  'dr alaa': 'Dr. Alaa',
  'dr ali': 'Dr. Ali',
  'dr ayman': 'Dr. Ayman',
  'dr abbas': 'Dr. Abbas',
  'dr mohamed': 'Dr. Mohamed',
  'dr hassan': 'Dr. Hassan',
  'dr a wahab': 'Dr. A. Wahab',
  'dr a.wahab': 'Dr. A. Wahab',
  'dr abdelwahab omara': 'Dr. Abdelwahab Omara',
  'dr hoda abdelhamid': 'Dr. Hoda Abdelhamid',
  'dr hanaa al alawyat': 'Dr. Hanaa Al Alawyat',
  'dr kamal el masri': 'Dr. Kamal El Masri',
  'dr marwan hegazy': 'Dr. Marwan Hegazy',
  'dr ayman fathey': 'Dr. Ayman Fathey',
  'dr ali shabaka': 'Dr. Ali Shabaka',
  'dr alaa gweidah': 'Dr. Alaa Gweidah',
  'dr abbas hago': 'Dr. Abbas Hago',
  'dr mohammed atwa': 'Dr. Mohammed Atwa',
};

function normalizePicuName(raw='') {
  let clean = String(raw || '')
    .replace(/\s+/g, ' ')
    .replace(/^Dr\.?(?=[A-Za-z])/i, 'Dr. ')
    .replace(/\/(?=[A-Za-z])/g, ' / ')
    .replace(/([A-Za-z])\.([A-Za-z])/g, '$1. $2')
    .trim();
  const key = normalizeText(clean);
  clean = PICU_NAME_HINTS[key] || clean;
  if (!/^Dr\.?\s/i.test(clean)) clean = `Dr. ${clean}`.replace(/\s+/g, ' ').trim();
  return clean.replace(/\s+\/\s+/g, ' / ');
}

function resolvePicuPhone(name='', contactMap=null) {
  const direct = resolvePhone(ROTAS.picu || { contacts:{} }, { name, phone:'' });
  if (direct?.phone) return direct;
  const resolved = resolvePhoneFromContactMap(name, contactMap);
  if (resolved?.phone) return resolved;
  const target = normalizeText(String(name || '').replace(/^Dr\.?\s*/i, ''));
  const firstToken = target.split(' ').filter(Boolean)[0] || '';
  if (firstToken) {
    const candidates = Object.entries(ROTAS.picu?.contacts || {})
      .filter(([contactName]) => normalizeText(String(contactName).replace(/^Dr\.?\s*/i, '')).split(' ')[0] === firstToken)
      .map(([contactName, phone]) => ({ contactName, phone }));
    if (candidates.length === 1 && candidates[0].phone) {
      return { phone: candidates[0].phone, uncertain: false };
    }
    const map = (contactMap && contactMap.map) || {};
    const mapped = Object.entries(map)
      .filter(([contactName]) => normalizeText(String(contactName).replace(/^Dr\.?\s*/i, '')).split(' ')[0] === firstToken)
      .map(([contactName, phone]) => ({ contactName, phone }));
    if (mapped.length === 1 && mapped[0].phone) {
      return { phone: mapped[0].phone, uncertain: false };
    }
  }
  if (/wahab/i.test(name || '')) {
    const aliasTargets = ['Dr. Abdelwahab Omara', 'Dr. A. Wahab'];
    for (const candidate of aliasTargets) {
      const hit = resolvePhoneFromContactMap(candidate, contactMap) || resolvePhone(ROTAS.picu || { contacts:{} }, { name: candidate, phone:'' });
      if (hit?.phone) return hit;
    }
  }
  return null;
}

function extractPicuDoctorTokens(rowText='') {
  return String(rowText || '')
    .split(/(?=\bDr\.?)/)
    .map(token => token.trim())
    .filter(token => /^Dr\.?/i.test(token))
    .map(token => token.replace(/\b\d+.*$/, '').trim())
    .map(normalizePicuName)
    .filter(Boolean);
}

function stripPicuContactListBleed(tokens=[], line='') {
  const doctorTokens = [...tokens];
  if (!/\b\d{6,}\b/.test(line || '')) return doctorTokens;
  if (doctorTokens.length < 2) return doctorTokens;
  const last = doctorTokens[doctorTokens.length - 1] || '';
  const prev = doctorTokens[doctorTokens.length - 2] || '';
  const lastIsFullContact = canonicalName(last).split(' ').length >= 2 && !/a\.?\s*wahab/i.test(last);
  const prevLooksConsultant = /wahab|consultant/i.test(normalizeText(prev)) || /a\.?\s*wahab/i.test(prev);
  if (lastIsFullContact && prevLooksConsultant) doctorTokens.pop();
  return doctorTokens;
}

function maybeCorrectPicuDayAssistant2(dateKey='', token='') {
  const normalized = normalizePicuName(token || '');
  // Sprint 3 (H10): one-time correction for April 2026 only — expires after April 2026
  const now = new Date();
  if (now.getFullYear() === 2026 && now.getMonth() === 3 && dateKey === '11/04' && canonicalName(normalized) === canonicalName('Dr. Ayman')) {
    return 'Dr. Ali';
  }
  return normalized;
}

function buildPicuRowEntries(dateKey='', tokens=[], contactMap=null) {
  if (!tokens.length) return [];
  const meaningful = [...tokens];
  const consultant = meaningful[meaningful.length - 1] || '';
  const hasBackupConsultant = meaningful.length >= 7;
  const afterHours = meaningful[meaningful.length - (hasBackupConsultant ? 3 : 2)] || '';
  const full24 = meaningful[meaningful.length - (hasBackupConsultant ? 4 : 3)] || '';
  const dayCount = Math.max(1, meaningful.length - (hasBackupConsultant ? 4 : 3));
  const dayTokens = meaningful.slice(0, dayCount);
  const dayResident = dayTokens[0] || '';
  const dayAssistant1 = dayTokens[1] || '';
  const dayAssistant2 = maybeCorrectPicuDayAssistant2(dateKey, dayTokens[2] || '');

  const rows = [];
  const add = (picuField, role, rawName, startTime, endTime, shiftType, section) => {
    if (!rawName) return;
    const names = splitPossibleNames(rawName).map(normalizePicuName).filter(Boolean);
    names.forEach(name => {
      const phoneMeta = resolvePicuPhone(name, contactMap) || { phone:'', uncertain:true };
      rows.push({
        specialty: 'picu',
        date: dateKey,
        role,
        name,
        phone: phoneMeta.phone || '',
        phoneUncertain: !phoneMeta.phone || !!phoneMeta.uncertain,
        startTime,
        endTime,
        shiftType,
        section,
        picuField,
        doctorNameUncertain: false,
        review: { doctorName: false, phone: !phoneMeta.phone || !!phoneMeta.uncertain },
        _confidence: 'high',
        parsedFromPdf: true,
      });
    });
  };

  add('day_resident', 'Resident — Day Shift', dayResident, '07:30', '15:30', 'day', 'PICU Day Shift');
  add('day_assistant_1', 'Assistant 1st — Day Shift', dayAssistant1, '07:30', '15:30', 'day', 'PICU Day Shift');
  add('day_assistant_2', 'Assistant 2nd — Day Shift', dayAssistant2, '07:30', '15:30', 'day', 'PICU Day Shift');
  add('resident_24h', 'Resident 24h', full24, '07:30', '07:30', '24h', 'PICU 24h');
  add('after_hours_doctor', 'After-Hours On-Call', afterHours, '15:30', '07:30', 'night', 'PICU After-Hours');
  add('consultant_24h', 'Consultant On-Call 24h', consultant, '07:30', '07:30', '24h', 'PICU Consultant 24h');

  return rows;
}

function parsePicuPdfEntries(text='', deptKey='picu') {
  const contactResult = buildContactMapFromText(text);
  const dept = ROTAS[deptKey] || { contacts:{} };
  const entries = [];
  // Detect month/year from PDF — supports any month, not just April 2026
  const { month: detectedMon, year: detectedYr, monthPad } = detectPdfMonthYear(text);

  // ── Server-extracted pdfplumber path ──
  const serverSchedule = parsePicuPdfEntries._serverSchedule;
  if (Array.isArray(serverSchedule) && serverSchedule.length) {
    console.log(`[PICU] Using server-extracted schedule (${serverSchedule.length} rows)`);
    const FIELD_TO_ROLE = [
      { field: 'resident',              role: 'Resident 24h',          picuField: 'resident',              shiftType: '24h' },
      { field: 'first_responder_day',   role: 'First Responder (Day)', picuField: 'first_responder_day',   shiftType: 'day',   startTime: '07:30', endTime: '15:30' },
      { field: 'residents_oncall',      role: 'Residents On-Call 24h', picuField: 'after_hours_doctor',     shiftType: '24h' },
      { field: 'first_responder_night', role: 'First Responder (Night)', picuField: 'first_responder_night', shiftType: 'night', startTime: '15:30', endTime: '07:30' },
      { field: 'consultant_24h',        role: 'Consultant 24h',        picuField: 'consultant_24h',        shiftType: '24h' },
    ];
    for (const row of serverSchedule) {
      const dateKey = row.date || '';
      if (!dateKey) continue;
      for (const { field, role, picuField, shiftType, startTime, endTime } of FIELD_TO_ROLE) {
        const rawName = (row[field] || '').trim();
        if (!rawName) continue;
        const names = rawName.split(/\s*\/\s*/).filter(Boolean);
        for (const name of names) {
          const phoneMeta = resolvePhoneFromContactMap(name, contactResult)
            || resolvePhone(dept, { name, phone: '' })
            || { phone: '', uncertain: true };
          entries.push({
            specialty: deptKey, date: dateKey, role, name, picuField,
            phone: phoneMeta.phone || '',
            phoneUncertain: !phoneMeta.phone || !!phoneMeta.uncertain,
            shiftType, startTime: startTime || '07:30', endTime: endTime || '07:30',
            parsedFromPdf: true,
          });
        }
      }
    }
    const deduped = dedupeParsedEntries(entries);
    const sectionSet = new Set(deduped.map(e => e.picuField).filter(Boolean));
    deduped._templateDetected = deduped.length >= 20 && sectionSet.has('consultant_24h') && sectionSet.has('after_hours_doctor');
    deduped._templateName = deduped._templateDetected ? `picu-${monthPad}-${detectedYr}` : '';
    deduped._coreSectionsFound = [...sectionSet];
    deduped._serverExtracted = true;
    return deduped;
  }

  // ── Legacy client-side text parsing fallback ──
  const contactMap = contactResult;
  // Generic: captures any numeric month + any 4-digit year
  const rowRe = /^(Wed|Thu|Fri|Sat|Sun|Mon|Tue)\s+(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(.+)$/i;
  const lines = String(text || '').split(/\n/).map(line => line.trim()).filter(Boolean);

  lines.forEach(line => {
    const match = line.match(rowRe);
    if (!match) return;
    if (parseInt(match[3], 10) !== detectedMon || parseInt(match[4], 10) !== detectedYr) return;
    const dateKey = `${String(parseInt(match[2], 10)).padStart(2, '0')}/${monthPad}`;
    const body = match[5].replace(/\b\d{6,}.*$/, '').trim();
    let tokens = extractPicuDoctorTokens(body);
    tokens = stripPicuContactListBleed(tokens, match[3]);
    const rowEntries = buildPicuRowEntries(dateKey, tokens, contactMap);
    entries.push(...rowEntries);
  });

  const deduped = dedupeParsedEntries(entries);
  const sectionSet = new Set(deduped.map(entry => entry.picuField).filter(Boolean));
  deduped._templateDetected = deduped.length >= 20 && sectionSet.has('consultant_24h') && sectionSet.has('after_hours_doctor');
  deduped._templateName = deduped._templateDetected ? `picu-${monthPad}-${detectedYr}` : '';
  deduped._coreSectionsFound = [...sectionSet];
  return deduped;
}
