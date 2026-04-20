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
    // Filter out contact table text that leaks in
    const cols = body.split(/\s{2,}/).map(s => s.trim()).filter(Boolean)
      .filter(col =>
        !/^(Spine|Surgery|Department|Consultants?|Residents?|Assistant|Staff|Contact|Neurosciences)\b/i.test(col)
        && !/^\d{5,}/.test(col)
        && !/^0\d{9}/.test(col)
      );

    if (cols.length < 3) return;

    // Spine has NO extra columns after consultant:
    // cols[0]=ResDay, cols[1]=ResNight, cols[2]=Fellow or Consultant, cols[3]=Consultant (if fellow present)
    const dayResident = cols[0] || '';
    const nightResident = cols[1] || '';
    let fellow = '';
    let consultant = '';

    if (cols.length === 3) {
      // No fellow: cols[2] is consultant
      consultant = cols[2] || '';
    } else if (cols.length >= 4) {
      // cols[2]=fellow, cols[3]=consultant
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
