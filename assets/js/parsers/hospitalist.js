// ═══════════════════════════════════════════════════════════════
// parsers/hospitalist.js — Hospitalist specialty parser
// ═══════════════════════════════════════════════════════════════
// Depends on: core/phone-resolver.js, parsers/generic.js
// ═══════════════════════════════════════════════════════════════

const HOSPITALIST_ROW_ALIASES = [
  'SMROD /Dr. Sumia Osman',
  'SMROD / Dr. Sumia Osman',
  'SMROD / Dr. Z. AlKhalifah',
  'SMROD / Dr. Qusai',
  'SMROD / Dr. Dr.Zainab Elfatih',
  'SMROD / Dr. Zainab Elfatih',
  'SMROD / Dr. Khalid Samir',
  'SMROD / Dr. Ala Sayda',
  'SMROD / Dr. Anas',
  'SMROD / Dr. Lana',
  'Dr. Sumia Osman',
  'Dr. Z. AlKhalifah',
  'Dr.Zainab Elfatih',
  'Dr. Zainab Elfatih',
  'Dr.Khalid Samir',
  'Dr. Khalid Samir',
  'Dr.O.Bahamid',
  'Dr. O.Bahamid',
  'Dr. Z. Alfateh',
  'Dr.Amir',
  'Dr. Amir',
  'Dr. Yousra',
  'Dr.Yousra',
  'Dr. Ahmed Hassan',
  'Dr.Ahmed Hassan',
  'Dr. Hamada',
  'Dr.Hamada',
  'Dr. Ala Sayda',
  'Dr.Ala Sayda',
  'Dr.Dr. Ala Sayda',
  'Dr. Lana',
  'Dr. Osama Elrayess',
  'Dr.Layla',
  'Dr. Layla',
  'Dr.Anas',
  'Dr. Anas',
  'Dr.Khaleda',
  'Dr. Khaleda',
  'Dr.Sumia',
  'Dr. Sumia',
  'SMROD',
];


const HOSPITALIST_NAME_HINTS = {
  'dr dr ala sayda':'Dr. Ala Sayda',
  'dr ahmed hassan':'Dr. Ahmed Hassan',
  'dr o bahamid':'Dr. O. Bahamid',
  'dr. o. bahamid':'Dr. O. Bahamid',
  'dr o.bahamid':'Dr. O. Bahamid',
  'dr z alfateh':'Dr. Z. Alfateh',
  'dr z alkhalifah':'Dr. Z. AlKhalifah',
  'dr qusai':'Dr. Qusai',
  'dr khaleda':'Dr. Khaleda',
  'dr sumia':'Dr. Sumia',
  'dr sumia osman':'Dr. Sumia',
  'dr khalid samir':'Dr. Khaled Samir',
  'dr amir':'Dr. Amir',
  'dr yousra':'Dr. Yousra',
  'dr hamada':'Dr. Hamada Elshemy',
  'dr ala sayda':'Dr. Ala Sayda',
  'dr lana':'Dr. Lana',
  'dr layla':'Dr. Layla',
  'dr lana':'Dr. Lana',
  'dr elrayess':'Dr. Osama Elrayess',
  'dr anas':'Dr. Anas Al Akkam',
  'dr zainab elfatih':'Dr. Zainab Alfatih',
  'smrod':'SMROD',
};

function normalizeHospitalistName(raw='') {
  const clean = (raw || '').replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
  const canon = canonicalName(clean.replace(/\./g, '. '));
  return HOSPITALIST_NAME_HINTS[canon] || clean;
}

function extractHospitalistRowTokens(rowText='') {
  const escaped = HOSPITALIST_ROW_ALIASES
    .slice()
    .sort((a, b) => b.length - a.length)
    .map(item => item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(escaped.join('|'), 'g');
  return Array.from(rowText.matchAll(re)).map(match => normalizeHospitalistName(match[0]));
}

function parseHospitalistPdfEntries(text='', deptKey='hospitalist') {
  const entries = [];
  const { month: detectedMon, year: detectedYr, monthPad } = detectPdfMonthYear(text);
  const contactResult = buildContactMapFromText(text);
  const dept = ROTAS[deptKey] || { contacts:{} };

  // ── PRIMARY PATH: server-side pdfplumber schedule (Oncology ER only) ──
  const serverSchedule = parseHospitalistPdfEntries._serverSchedule;
  if (Array.isArray(serverSchedule) && serverSchedule.length) {
    console.log(`[HOSPITALIST] Using server-extracted schedule (${serverSchedule.length} rows)`);

    // SMROD = Senior Medical Resident On Duty — resolve from medicine_on_call
    const resolveSMROD = (dateKey, shiftType) => {
      // 1. Try built-in ROTAS schedule
      const builtIn = (ROTAS.medicine_on_call?.schedule?.[dateKey] || [])
        .find(e => /senior/i.test(e.role || '') && e.shiftType === shiftType);
      if (builtIn && builtIn.name) {
        return { name: builtIn.name, phone: builtIn.phone || '' };
      }
      // 2. Try uploaded medicine_on_call record (IndexedDB → memory cache)
      if (typeof uploadedRecordForDept === 'function') {
        const uploaded = uploadedRecordForDept('medicine_on_call');
        if (uploaded && Array.isArray(uploaded.entries)) {
          const match = uploaded.entries.find(e =>
            e.date === dateKey
            && /senior/i.test(e.role || '')
            && e.shiftType === shiftType
          );
          if (match && match.name) {
            return { name: match.name, phone: match.phone || '' };
          }
        }
      }
      return null;
    };

    for (const row of serverSchedule) {
      const dateKey = row.date || '';
      if (!dateKey) continue;
      const addEntry = (rawName, shiftType, startTime, endTime) => {
        if (!rawName) return;

        // SMROD — resolve from medicine_on_call Senior ER
        if (rawName === 'SMROD') {
          const resolved = resolveSMROD(dateKey, shiftType);
          if (!resolved) return;
          entries.push({
            specialty: deptKey, date: dateKey,
            role: 'Oncology ER Hospitalist', section: 'Oncology ER',
            name: resolved.name, phone: resolved.phone,
            phoneUncertain: !resolved.phone,
            shiftType, startTime, endTime, parsedFromPdf: true,
          });
          return;
        }

        // Normal name — resolve via contact map
        const name = rawName.replace(/\s*\([^)]*\)\s*/g, '').trim();
        if (!name) return;
        const phoneMeta = resolvePhoneFromContactMap(name, contactResult)
          || resolvePhone(dept, { name, phone: '' })
          || { phone: '', uncertain: true };
        entries.push({
          specialty: deptKey, date: dateKey,
          role: 'Oncology ER Hospitalist', section: 'Oncology ER',
          name, phone: phoneMeta.phone || '',
          phoneUncertain: !phoneMeta.phone || !!phoneMeta.uncertain,
          shiftType, startTime, endTime, parsedFromPdf: true,
        });
      };
      addEntry(row.onc_er_day, 'day', '08:00', '20:00');
      addEntry(row.onc_er_night, 'night', '20:00', '08:00');
    }
    const deduped = dedupeParsedEntries(entries);
    deduped._templateDetected = deduped.length >= 20;
    deduped._templateName = deduped._templateDetected ? `hospitalist-${monthPad}-${detectedYr}` : '';
    deduped._serverExtracted = true;
    return deduped;
  }

  // ── FALLBACK: client-side token extraction (existing logic) ──
  console.log('[HOSPITALIST] No server schedule — falling back to client-side token parsing');
  const dayRowRe = /^(Wed|Thu|Fri|Sat|Sun|Mon|Tue)\s+(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(.+)$/i;
  const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
  lines.forEach(line => {
    const match = line.match(dayRowRe);
    if (!match) return;
    if (parseInt(match[3], 10) !== detectedMon || parseInt(match[4], 10) !== detectedYr) return;
    const day = String(parseInt(match[2], 10)).padStart(2, '0');
    const date = `${day}/${monthPad}`;
    const tokens = extractHospitalistRowTokens(match[5]);
    if (tokens.length < 8) return;
    const add = (name, role, section, startTime, endTime, shiftType) => {
      if (!name || name === 'SMROD') return;
      const phone = ROTAS[deptKey]?.contacts?.[name] || '';
      entries.push({
        specialty: deptKey,
        date,
        role,
        name,
        phone,
        section,
        shiftType,
        startTime,
        endTime,
        parsedFromPdf: true,
      });
    };
    const oncologyDay = tokens[5] || tokens[14] || tokens[13] || '';
    const oncologyNight = tokens[tokens.length - 1] || tokens[16] || tokens[15] || tokens[13] || '';
    // The Hospitalist monthly template has multiple repeated lanes in a single row.
    // These four positions are the stable clinically relevant lanes we use in the app.
    add(tokens[4], 'Medical ER Consultation', 'Medical ER', '08:00', '16:00', 'day');
    add(oncologyDay, 'Oncology ER Hospitalist', 'Oncology ER', '08:00', '20:00', 'day');
    add(tokens[6], 'Inpatient Consultation', 'Inpatient Consultation', '08:00', '20:00', 'day');
    add(oncologyNight, 'Oncology ER Hospitalist', 'Oncology ER', '20:00', '08:00', 'night');
  });
  const deduped = dedupeParsedEntries(entries);
  deduped._templateDetected = deduped.length >= 20;
  deduped._templateName = deduped._templateDetected ? `hospitalist-${monthPad}-${detectedYr}` : '';
  return deduped;
}

const MEDICINE_ON_CALL_ROLE_SEQUENCE = [
  { role:'Junior Ward', section:'Junior Ward', shiftType:'day', startTime:'07:30', endTime:'21:00' },
  { role:'Junior Ward', section:'Junior Ward', shiftType:'night', startTime:'21:00', endTime:'07:30' },
  { role:'Junior ER', section:'Junior ER', shiftType:'day', startTime:'07:30', endTime:'21:00' },
  { role:'Junior ER', section:'Junior ER', shiftType:'night', startTime:'21:00', endTime:'07:30' },
  { role:'Senior ER', section:'Senior', shiftType:'day', startTime:'07:30', endTime:'21:00' },
  { role:'Senior ER', section:'Senior', shiftType:'night', startTime:'21:00', endTime:'07:30' },
];

