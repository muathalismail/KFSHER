// ═══════════════════════════════════════════════════════════════
// parsers/spine.js — Spine Surgery Duty Rota parser
// ═══════════════════════════════════════════════════════════════
// Columns: Day | Date | Resident Day | Resident Night | Fellow | Consultant
// No extra columns. Phone extraction via /api/extract-contacts (pdfplumber).
// ═══════════════════════════════════════════════════════════════

const SPINE_NAME_HINTS = {
  'faisal': 'Faisal AL Habib',
  'abdullelah': 'Abdulelah AL Mutairi',
  'basma': 'Basma Al Zahrani',
  'mohamed': 'Mohammed Alshammri',
  'mohammed': 'Mohammed Alshammri',
  'mouhammed': 'Mohammed Alshammri',
  'lujain': 'Lujain Alghourab',
};

function _normalizeSpineName(raw) {
  const clean = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  return SPINE_NAME_HINTS[clean.toLowerCase()] || clean;
}

function _splitSpineSlashNames(raw) {
  return String(raw || '').split(/\s*\/\s*/)
    .map(n => n.trim())
    .filter(Boolean)
    .map(n => _normalizeSpineName(n))
    .filter((n, i, arr) => arr.indexOf(n) === i); // deduplicate
}

function parseSpinePdfEntries(text='', deptKey='spine') {
  const entries = [];
  const dept = ROTAS[deptKey] || { contacts:{} };
  const contactResult = buildContactMapFromText(text);
  const { year: detectedYr, monthPad } = detectPdfMonthYear(text);

  // ── PRIMARY PATH: server-side pdfplumber schedule ──
  const serverSchedule = parseSpinePdfEntries._serverSchedule;
  if (Array.isArray(serverSchedule) && serverSchedule.length) {
    console.log(`[SPINE] Using server-extracted schedule (${serverSchedule.length} rows)`);
    for (const row of serverSchedule) {
      const dateKey = row.date || '';
      if (!dateKey) continue;
      const addEntry = (role, rawName, startTime, endTime, shiftType) => {
        if (!rawName) return;
        const resolved = resolvePhoneFromContactMap(rawName, contactResult)
          || resolvePhone(dept, { name: rawName, phone: '' })
          || { phone: '', uncertain: true };
        entries.push({
          specialty: deptKey, date: dateKey, role, name: rawName,
          phone: resolved.phone || '',
          phoneUncertain: !resolved.phone || !!resolved.uncertain,
          startTime, endTime, shiftType, parsedFromPdf: true,
        });
      };
      addEntry('Resident On-Duty (Day)', row.resident_day, '07:30', '17:00', 'day');
      addEntry('Resident On-Duty (Night)', row.resident_night, '17:00', '07:30', 'night');
      addEntry('2nd On-Duty', row.fellow_second, '07:30', '07:30', '24h');
      addEntry('Spine Consultant On-Call', row.consultant, '07:30', '07:30', '24h');
    }
    const deduped = dedupeParsedEntries(entries);
    deduped._templateDetected = deduped.length >= 20;
    deduped._templateName = deduped._templateDetected ? `spine-${monthPad}-${detectedYr}` : '';
    deduped._serverExtracted = true;
    return deduped;
  }

  // ── FALLBACK: client-side column splitting ──
  const rowRe = /^(Wednesday|Thursday|Friday|Saturday|Sunday|Monday|Tuesday)\s+(\d{1,2})-([A-Za-z]{3})-(\d{2,4})\s+(.+)$/i;
  const lines = String(text || '').split(/\n/).map(l => l.trim()).filter(Boolean);

  lines.forEach(line => {
    const match = line.match(rowRe);
    if (!match) return;
    const rowMon = (['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(match[3].toLowerCase())) + 1;
    const rowYr = parseInt(match[4], 10);
    const rowYr4 = rowYr < 100 ? 2000 + rowYr : rowYr;
    if (rowMon !== parseInt(monthPad, 10) || rowYr4 !== detectedYr) return;

    const dateKey = `${String(parseInt(match[2], 10)).padStart(2, '0')}/${monthPad}`;
    const body = match[5];

    // Split by double-space (column boundaries from extractPdfText)
    // Filter out contact table text that leaks from the right side of the PDF
    const rawCols = body.split(/\s{2,}/).map(s => s.trim()).filter(Boolean);
    // Filter out contact table text leaking from the right side:
    // - Section headers, labels, IDs, phones, emails
    // - Full names from contact table: "Dr. Saud Al Hamad" (Dr + 3+ words) or
    //   "Faisal AL Habib" (no Dr, 2+ words with mixed case)
    const cols = rawCols.filter(col =>
      !/^(Spine|Surgery|Department|Consultants?|Residents?|Assistants?|Staff|Contact|Neurosciences|Neurosurgery|Doctor|Office|Mobile|Bleep|AM\s+to|PM\s+to|hrs)\b/i.test(col)
      && !/^\d{4,}/.test(col)           // ID/extension numbers
      && !/^0\d{9}/.test(col)           // phone numbers
      && !/^\+\d{3}/.test(col)          // international numbers
      && !/\@/.test(col)                // email addresses
      // Contact table "Dr. Full Name" entries have 3+ words (e.g. "Dr. Saud Al Hamad")
      // Rota "Dr Short" entries have exactly 2 words (e.g. "Dr. Bachar", "Dr. Saud")
      && !(col.split(/\s+/).length >= 3 && /^Dr\.?\s/i.test(col))
      // Contact table resident entries: 2+ words, no Dr prefix, mixed case
      && !(col.split(/\s+/).length >= 2 && /[A-Z]/.test(col) && /[a-z]/.test(col) && !/^Dr\.?\s/i.test(col) && !/\//.test(col))
    );

    if (cols.length < 3) return;

    // After filtering: cols = [ResDay, ResNight, (Fellow), Consultant]
    // Exactly 3 = no fellow, 4 = with fellow
    const dayResident = cols[0] || '';
    const nightResident = cols[1] || '';
    let fellow = '';
    let consultant = '';

    if (cols.length === 3) {
      consultant = cols[2] || '';
    } else {
      fellow = cols[2] || '';
      consultant = cols[3] || '';
    }

    const addEntry = (role, name, startTime, endTime, shiftType) => {
      if (!name) return;
      const resolved = resolvePhoneFromContactMap(name, contactResult)
        || resolvePhone(dept, { name, phone:'' })
        || { phone:'', uncertain:true };
      entries.push({
        specialty: deptKey, date: dateKey, role, name,
        phone: resolved.phone || '',
        phoneUncertain: !resolved.phone || !!resolved.uncertain,
        startTime, endTime, shiftType, parsedFromPdf: true,
      });
    };

    // Split slash-separated resident names
    for (const name of _splitSpineSlashNames(dayResident)) {
      addEntry('Resident On-Duty (Day)', name, '07:30', '17:00', 'day');
    }
    for (const name of _splitSpineSlashNames(nightResident)) {
      addEntry('Resident On-Duty (Night)', name, '17:00', '07:30', 'night');
    }
    if (fellow) {
      addEntry('2nd On-Duty', _normalizeSpineName(fellow), '07:30', '07:30', '24h');
    }
    if (consultant) {
      addEntry('Spine Consultant On-Call', _normalizeSpineName(consultant), '07:30', '07:30', '24h');
    }
  });

  const deduped = dedupeParsedEntries(entries);
  deduped._templateDetected = deduped.length >= 20;
  deduped._templateName = deduped._templateDetected ? `spine-${monthPad}-${detectedYr}` : '';
  return deduped;
}
