// ═══════════════════════════════════════════════════════════════
// parsers/radiology-oncall.js — Imaging On-Call Rota parser
// ═══════════════════════════════════════════════════════════════
// Extracts ONLY: 1st On-Call, 2nd On-Call, 3rd On-Call (cols 2-4)
// SKIPS: Weekend X-Ray, General Consultants, Neuro, Nuclear (cols 5-10)
// Handles weekend AM/PM split for Fri & Sat
// ═══════════════════════════════════════════════════════════════

// Words that are NOT doctor names — skip if matched
const _ONCALL_SKIP_WORDS = /^(RESIDENTS?|GENERAL|ON-CALL|DAY|DATE|1st|2nd|3rd|NEURO|NUCLEAR|ABDOMEN|CHEST|MSK|PEDIA|BREAST|X-Ray|Weekend|CONSULTANT|MEDICINE|ER|In-Patient|-+\s*Weekend\s*-+|-+\s*GENERAL\s*IT\s*SUPPORT\s*-+|case\s+assignments)/i;

/**
 * Extract contacts from the on-call rota PDF text.
 * The contact table has two side-by-side sub-tables that get merged into single lines.
 * Pattern: "Name1 ext1 phone1 Name2 phone2" or "Name phone" per line.
 * Handles phones without leading 0 (e.g. 549747372 → 0549747372).
 */
function _extractOnCallContacts(text) {
  const contacts = {};
  const lines = String(text || '').split('\n');
  // Match: word sequences followed by a 9-10 digit number
  const phoneRe = /\b(5\d{8})\b/g;

  for (const line of lines) {
    // Skip schedule rows (contain dates)
    if (/\d{1,2}\/\d{1,2}\/\d{4}/.test(line)) continue;
    // Skip headers
    if (/^(DAY|DATE|MEDICAL IMAGING|APRIL|NAME|EXTENSION|MISC PHYS|MID RESID|ON-CALL GENERAL IT)/i.test(line.trim())) continue;

    // Find all phone numbers in this line
    const phones = [];
    let m;
    while ((m = phoneRe.exec(line)) !== null) {
      phones.push({ phone: '0' + m[1], index: m.index });
    }
    if (!phones.length) continue;

    // For each phone, extract the name text BEFORE it
    // Work backwards: the text between the previous phone (or line start) and this phone is the name
    for (let i = 0; i < phones.length; i++) {
      const start = i === 0 ? 0 : phones[i - 1].index + phones[i - 1].phone.length;
      const nameText = line.slice(start, phones[i].index).trim();
      // Clean: remove extension numbers (4-digit), parenthetical suffixes, "Dr." variations
      let name = nameText
        .replace(/\b\d{4}\b/g, ' ')           // extension numbers
        .replace(/\([^)]*\)/g, '')             // (F1 - Neuro) etc.
        .replace(/\b(ext\.?|on training)\b/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (name && name.length >= 3 && !/^\d+$/.test(name) && !/^(MISC|MID|CONTACT|DETAILS)$/i.test(name)) {
        contacts[name] = phones[i].phone;
      }
    }
  }
  return contacts;
}

/**
 * Resolve a name against the PDF-extracted contacts map.
 * Tries exact match, then first-name unique match, then last-name match.
 */
function _resolveFromPdfContacts(name, contacts) {
  if (!name || !contacts) return null;
  const norm = n => (n || '').toLowerCase().replace(/^dr\.?\s*/i, '').replace(/\s+/g, ' ').trim();
  const target = norm(name);
  if (!target) return null;

  // Exact match
  for (const [cn, ph] of Object.entries(contacts)) {
    if (norm(cn) === target) return ph;
  }

  // First-name match (unique)
  const targetFirst = target.split(' ')[0];
  if (targetFirst && targetFirst.length >= 3) {
    const matches = Object.entries(contacts).filter(([cn]) =>
      norm(cn).split(' ')[0] === targetFirst
    );
    if (matches.length === 1) return matches[0][1];
  }

  // Last-name match
  const targetParts = target.split(' ');
  const targetLast = targetParts[targetParts.length - 1];
  if (targetLast && targetLast.length >= 4) {
    const matches = Object.entries(contacts).filter(([cn]) => {
      const cnLast = norm(cn).split(' ').pop();
      return cnLast === targetLast || cnLast.replace(/^al/, '') === targetLast.replace(/^al/, '');
    });
    if (matches.length === 1) return matches[0][1];
  }

  return null;
}

function parseRadiologyOnCallPdfEntries(text='', deptKey='radiology_oncall') {
  const entries = [];
  const dept = ROTAS[deptKey] || { contacts:{} };
  const { year: detectedYr, monthPad } = detectPdfMonthYear(text);

  // Build contact map from the PDF text (page 2 has a contact table)
  const contactResult = buildContactMapFromText(text);
  // Also extract contacts using the dedicated on-call layout parser
  const pdfContacts = _extractOnCallContacts(text);

  const lines = String(text || '').split(/\n/).map(l => l.trim()).filter(Boolean);
  const dateRe = /(\d{1,2})\/(\d{1,2})\/(\d{4})/;
  const timeRe = /(7:30\s*[ap]m)\s*[-–]\s*(7:30\s*[ap]m)/i;
  const dayRe = /^(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sun|Mon|Tues?|Wed|Thurs?|Fri|Sat)\b/i;

  const weekendAM = {};

  for (const line of lines) {
    // Split by double-space
    const rawCols = line.split(/\s{2,}/).map(s => s.trim()).filter(Boolean);
    if (rawCols.length < 2) continue;

    // Find date in the first 3 columns
    let dateCol = null;
    let dateIdx = -1;
    for (let i = 0; i < Math.min(rawCols.length, 3); i++) {
      if (dateRe.test(rawCols[i])) {
        dateCol = rawCols[i];
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

    // Weekend time detection
    const tm = dateCol.match(timeRe);
    let isWeekendAM = false;
    let isWeekendPM = false;
    if (tm) {
      if (tm[1].toLowerCase().includes('am')) isWeekendAM = true;
      else isWeekendPM = true;
    }

    // Collect ALL tokens after the date, filtering out day names
    const afterDate = rawCols.slice(dateIdx + 1);
    // Also check: if the column BEFORE the date is a day name, skip it
    // Extract exactly the first 3 valid name tokens (cols 2,3,4)
    const dataTokens = [];
    for (const tok of afterDate) {
      if (dataTokens.length >= 3) break; // HARD STOP at 3 columns
      if (dayRe.test(tok)) continue; // skip day names
      if (_ONCALL_SKIP_WORDS.test(tok)) continue; // skip headers/labels
      if (/^\d{5,}/.test(tok)) continue; // skip IDs
      if (/^0\d{9}/.test(tok)) continue; // skip phone numbers
      dataTokens.push(tok);
    }

    const firstOnCall = dataTokens[0] || '';
    const secondOnCall = dataTokens[1] || '';
    const thirdOnCall = dataTokens[2] || '';

    // Skip if first token is clearly a header
    if (_ONCALL_SKIP_WORDS.test(firstOnCall)) continue;

    const addEntry = (role, rawName, startTime, endTime, shiftType) => {
      if (!rawName || rawName === '-' || rawName === '--') return;
      if (_ONCALL_SKIP_WORDS.test(rawName)) return;
      // Split slash-separated names
      const names = rawName.split(/\s*\/\s*/).map(n => n.trim()).filter(n =>
        n && n !== '-' && !_ONCALL_SKIP_WORDS.test(n)
      );
      for (const name of names) {
        // Try: 1) dedicated PDF contacts, 2) generic PDF contact map, 3) rotas.js contacts
        const directMatch = _resolveFromPdfContacts(name, pdfContacts);
        const fromPdf = directMatch ? null : resolvePhoneFromContactMap(name, contactResult);
        const fromRotas = (!directMatch && !(fromPdf && fromPdf.phone)) ? resolvePhone(dept, { name, phone: '' }) : null;
        const resolved = directMatch ? { phone: directMatch, uncertain: false }
          : (fromPdf && fromPdf.phone) ? fromPdf
          : (fromRotas && fromRotas.phone) ? fromRotas
          : { phone: '', uncertain: true };
        entries.push({
          specialty: deptKey, date: dateKey, role, name,
          phone: resolved.phone || '',
          phoneUncertain: !resolved.phone || !!resolved.uncertain,
          startTime, endTime, shiftType, parsedFromPdf: true,
        });
      }
    };

    if (isWeekendAM) {
      weekendAM[dateKey] = { first: firstOnCall, second: secondOnCall, third: thirdOnCall };
      continue;
    }

    if (isWeekendPM && weekendAM[dateKey]) {
      const am = weekendAM[dateKey];
      const merge = (role, amName, pmName) => {
        if (!amName && !pmName) return;
        if (amName === pmName || (!pmName && amName)) {
          addEntry(role, amName || pmName, '07:30', '07:30', '24h');
        } else if (!amName && pmName) {
          addEntry(role, pmName, '19:30', '07:30', 'night');
        } else {
          addEntry(role, amName, '07:30', '19:30', 'day');
          addEntry(role, pmName, '19:30', '07:30', 'night');
        }
      };
      merge('1st On-Call', am.first, firstOnCall);
      merge('2nd On-Call', am.second, secondOnCall);
      merge('3rd On-Call', am.third, thirdOnCall);
      delete weekendAM[dateKey];
    } else if (!isWeekendPM) {
      addEntry('1st On-Call', firstOnCall, '16:30', '07:30', 'night');
      addEntry('2nd On-Call', secondOnCall, '16:30', '07:30', 'night');
      addEntry('3rd On-Call', thirdOnCall, '16:30', '07:30', 'night');
    }
  }

  // Remaining weekend AM rows without PM counterpart
  for (const [dateKey, am] of Object.entries(weekendAM)) {
    const add = (role, name) => {
      if (!name || _ONCALL_SKIP_WORDS.test(name)) return;
      const names = name.split(/\s*\/\s*/).map(n => n.trim()).filter(Boolean);
      for (const n of names) {
        const directMatch = _resolveFromPdfContacts(n, pdfContacts);
        const fromPdf = directMatch ? null : resolvePhoneFromContactMap(n, contactResult);
        const fromRotas = (!directMatch && !(fromPdf && fromPdf.phone)) ? resolvePhone(dept, { name: n, phone: '' }) : null;
        const resolved = directMatch ? { phone: directMatch, uncertain: false }
          : (fromPdf && fromPdf.phone) ? fromPdf
          : (fromRotas && fromRotas.phone) ? fromRotas
          : { phone: '', uncertain: true };
        entries.push({
          specialty: deptKey, date: dateKey, role, name: n,
          phone: resolved.phone || '', phoneUncertain: !resolved.phone || !!resolved.uncertain,
          startTime: '07:30', endTime: '07:30', shiftType: '24h', parsedFromPdf: true,
        });
      }
    };
    add('1st On-Call', am.first);
    add('2nd On-Call', am.second);
    add('3rd On-Call', am.third);
  }

  const deduped = dedupeParsedEntries(entries);
  deduped._templateDetected = deduped.length >= 15;
  deduped._templateName = deduped._templateDetected ? `radiology-oncall-${monthPad}-${detectedYr}` : '';
  return deduped;
}
