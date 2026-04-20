// ═══════════════════════════════════════════════════════════════
// parsers/radiology-oncall.js — Specialized parser for Imaging On-Call Rota
// ═══════════════════════════════════════════════════════════════
// Extracts ONLY columns 2-4 (1st, 2nd, 3rd On-Call)
// Skips columns 5-10 (Weekend X-Ray, General Consultants, Neuro, Nuclear)
// Handles weekend split (AM/PM rows for Fri & Sat)
// ═══════════════════════════════════════════════════════════════

function parseRadiologyOnCallPdfEntries(text='', deptKey='radiology_oncall') {
  const entries = [];
  const dept = ROTAS[deptKey] || { contacts:{} };
  const { year: detectedYr, monthPad } = detectPdfMonthYear(text);

  // The on-call rota is a table with double-space column separators.
  // Column order: Day | Date | 1st On-Call | 2nd On-Call | 3rd On-Call | Weekend XRay | ...rest (skip)
  // We extract columns by position: after splitting by double-space,
  // tokens[0]=Day (or empty for weekend PM row), tokens[1]=Date,
  // tokens[2]=1st, tokens[3]=2nd, tokens[4]=3rd
  // Everything at index 5+ is SKIPPED.

  const lines = String(text || '').split(/\n/).map(l => l.trim()).filter(Boolean);
  const dateRe = /(\d{1,2})\/(\d{1,2})\/(\d{4})/;
  const timeRe = /(7:30\s*[ap]m)\s*[-–]\s*(7:30\s*[ap]m)/i;

  // Track weekend AM rows to merge with PM rows
  const weekendAM = {}; // dateKey → {first, second, third}

  for (const line of lines) {
    // Split by double-space to get columns
    const cols = line.split(/\s{2,}/).map(s => s.trim()).filter(Boolean);
    if (cols.length < 2) continue;

    // Find the date column — may be at index 0 or 1
    let dateCol = null;
    let dateIdx = -1;
    for (let i = 0; i < Math.min(cols.length, 3); i++) {
      if (dateRe.test(cols[i])) {
        dateCol = cols[i];
        dateIdx = i;
        break;
      }
    }
    if (!dateCol) continue;

    const dm = dateCol.match(dateRe);
    if (!dm) continue;
    const dayNum = parseInt(dm[1], 10);
    const month = parseInt(dm[2], 10);
    const year = parseInt(dm[3], 10);
    if (year !== detectedYr) continue;

    const dateKey = `${String(dayNum).padStart(2, '0')}/${String(month).padStart(2, '0')}`;

    // Detect time slot for weekends
    const tm = dateCol.match(timeRe);
    let shiftHours = '16:30-07:30'; // weekday default
    let isWeekendAM = false;
    let isWeekendPM = false;
    if (tm) {
      const startH = tm[1].toLowerCase();
      if (startH.includes('am')) {
        isWeekendAM = true;
        shiftHours = '07:30-19:30';
      } else {
        isWeekendPM = true;
        shiftHours = '19:30-07:30';
      }
    }

    // Detect day name from the line
    const dayMatch = line.match(/^(Sun|Mon|Tues?|Wed|Thurs?|Fri|Sat)/i);

    // Extract only columns 2, 3, 4 (relative to date column)
    // After the date column, the next 3 values are 1st, 2nd, 3rd on-call
    const dataStart = dateIdx + 1;
    const firstOnCall = (cols[dataStart] || '').trim();
    const secondOnCall = (cols[dataStart + 1] || '').trim();
    const thirdOnCall = (cols[dataStart + 2] || '').trim();

    // Skip header rows
    if (/^(1st|2nd|3rd|RESIDENTS|GENERAL|ON-CALL|DAY|DATE)/i.test(firstOnCall)) continue;
    if (/^RESIDENTS$/i.test(firstOnCall)) continue;

    // For weekend AM rows, store and wait for PM row
    if (isWeekendAM) {
      weekendAM[dateKey] = { first: firstOnCall, second: secondOnCall, third: thirdOnCall };
      continue; // don't emit yet — wait for PM row
    }

    const addEntry = (role, name, hours) => {
      if (!name || name === '-' || name === '--' || /^(RESIDENTS|GENERAL|X-Ray)/i.test(name)) return;
      // Split slash-separated names
      const names = name.split(/\s*\/\s*/).map(n => n.trim()).filter(Boolean);
      for (const n of names) {
        const resolved = resolvePhone(dept, { name: n, phone: '' }) || { phone: '', uncertain: true };
        entries.push({
          specialty: deptKey,
          date: dateKey,
          role,
          name: n,
          phone: resolved.phone || '',
          phoneUncertain: !resolved.phone || !!resolved.uncertain,
          startTime: hours.split('-')[0] || '16:30',
          endTime: hours.split('-')[1] || '07:30',
          shiftType: hours === '07:30-07:30' ? '24h' : hours.includes('07:30-19:30') ? 'day' : 'night',
          parsedFromPdf: true,
        });
      }
    };

    if (isWeekendPM && weekendAM[dateKey]) {
      // Merge AM + PM: if same person in both → 24h, else separate entries
      const am = weekendAM[dateKey];
      const merge = (role, amName, pmName) => {
        if (!amName && !pmName) return;
        if (amName === pmName || (!pmName && amName) || (!amName && pmName)) {
          // Same person or only one slot filled → 24h
          addEntry(role, amName || pmName, '07:30-07:30');
        } else {
          // Different people → separate shifts
          addEntry(role, amName, '07:30-19:30');
          addEntry(role, pmName, '19:30-07:30');
        }
      };
      merge('1st On-Call', am.first, firstOnCall);
      merge('2nd On-Call', am.second, secondOnCall);
      merge('3rd On-Call', am.third, thirdOnCall);
      delete weekendAM[dateKey];
    } else if (!isWeekendPM) {
      // Regular weekday
      addEntry('1st On-Call', firstOnCall, shiftHours);
      addEntry('2nd On-Call', secondOnCall, shiftHours);
      addEntry('3rd On-Call', thirdOnCall, shiftHours);
    }
  }

  // Emit any remaining weekend AM rows that had no PM counterpart
  for (const [dateKey, am] of Object.entries(weekendAM)) {
    const addEntry = (role, name) => {
      if (!name || name === '-') return;
      const names = name.split(/\s*\/\s*/).map(n => n.trim()).filter(Boolean);
      for (const n of names) {
        const resolved = resolvePhone(dept, { name: n, phone: '' }) || { phone: '', uncertain: true };
        entries.push({
          specialty: deptKey, date: dateKey, role, name: n,
          phone: resolved.phone || '', phoneUncertain: !resolved.phone || !!resolved.uncertain,
          startTime: '07:30', endTime: '07:30', shiftType: '24h', parsedFromPdf: true,
        });
      }
    };
    addEntry('1st On-Call', am.first);
    addEntry('2nd On-Call', am.second);
    addEntry('3rd On-Call', am.third);
  }

  const deduped = dedupeParsedEntries(entries);
  deduped._templateDetected = deduped.length >= 20;
  deduped._templateName = deduped._templateDetected ? `radiology-oncall-${monthPad}-${detectedYr}` : '';
  return deduped;
}
