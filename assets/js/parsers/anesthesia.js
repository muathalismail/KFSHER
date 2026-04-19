// ═══════════════════════════════════════════════════════════════
// parsers/anesthesia.js — Anesthesia PDF parser
// ═══════════════════════════════════════════════════════════════
// Depends on: parsers/generic.js
// ═══════════════════════════════════════════════════════════════

// buildAbbrLegend → defined in parsers/generic.js

// Parse Anesthesia-style PDFs which use abbreviations in the schedule but have a legend.
function parseAnesthesiaPdfEntries(text='', deptKey='') {
  const legend = buildAbbrLegend(text);
  const entries = [];
  const dayRe = /^(?:MON|TUE|WED|THU|FRI|SAT|SUN)/i;
  const dateRe = /(\d{1,2})[\u2010\u2011\u2012\u2013\u2014\-](Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|Jan|Feb|Mar)/i;

  for (const line of text.split('\n')) {
    if (!dayRe.test(line.trim())) continue;
    const dm = line.match(dateRe);
    if (!dm) continue;
    const day = parseInt(dm[1], 10);
    const month = { Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12 }[dm[2]] || 4;
    const dateKey = `${String(day).padStart(2,'0')}/${String(month).padStart(2,'0')}`;

    // Extract all abbreviations from the line
    const abbrs = (line.match(/\b([A-Z]{2,6})\b/g) || []).filter(a => legend[a]);
    // Also look for explicit "Dr. Name" with phone (consultant lines)
    const consultantRe = /Dr\.?\s*([\w\xa0 .-]{3,30}?)\s+(\d{9,10})/g;
    let cm;
    while ((cm = consultantRe.exec(line)) !== null) {
      const name = cm[1].replace(/\xa0/g, ' ').replace(/\s+/g, ' ').trim();
      const rawPhone = cm[2];
      const phone = rawPhone.startsWith('5') ? '0' + rawPhone : rawPhone;
      if (name.length >= 4) {
        entries.push({ specialty: deptKey, date: dateKey, role: 'Consultant On-Call', name: 'Dr. ' + name, phone, section: ROTAS[deptKey]?.label || deptKey, parsedFromPdf: true });
      }
    }
    // Expand abbreviations
    const roles = ['Resident', '2nd On-Call', 'Consultant On-Call', 'Consultant On-Call'];
    abbrs.forEach((abbr, idx) => {
      const { name, phone } = legend[abbr];
      entries.push({ specialty: deptKey, date: dateKey, role: roles[idx] || 'On-Call', name, phone, section: ROTAS[deptKey]?.label || deptKey, parsedFromPdf: true });
    });
  }
  return dedupeParsedEntries(entries);
}

// Extract schedule entries from a date-structured table.
// Handles multiple layouts:
// Layout A: "Wed 08/04/2026 Name1 Name2 Name3" (Orthopedics, some ENT rows)
// Layout B: Names on y-line just above/below the date line (ENT common case)
// The text passed in is already sorted top-to-bottom (y desc in PDF coords).
