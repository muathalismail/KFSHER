// ═══════════════════════════════════════════════════════════════
// parsers/others.js — Gynecology, Neurosurgery, KPTX, Liver parsers
// ═══════════════════════════════════════════════════════════════
// Depends on: core/phone-resolver.js, parsers/generic.js
// ═══════════════════════════════════════════════════════════════

function parseGynecologyPdfEntries(text='', deptKey='gynecology') {
  const entries = [];
  const contactResult = buildContactMapFromText(text);
  const roles = ['Fellow / Resident', 'Resident', 'Consultant On-Call'];
  // Detect month/year from PDF
  const { month: detectedMon, year: detectedYr, monthPad } = detectPdfMonthYear(text);
  const daysInMonth = new Date(detectedYr, detectedMon, 0).getDate();

  // Find the packed line with "24 H" blocks
  for (const line of text.split('\n')) {
    if (!line.includes('24 H')) continue;
    const blocks = line.split(/\s*24\s*H\s*/);
    // blocks[0] = header, blocks[1] = day 1, blocks[2] = day 2 ...
    for (let b = 1; b < blocks.length; b++) {
      const day = b; // block index maps to calendar day
      if (day < 1 || day > daysInMonth) continue;
      const dateKey = `${String(day).padStart(2,'0')}/${monthPad}`;
      const chunk = (blocks[b] || '').trim();
      const parts = chunk.split(/\s{2,}/).map(s => s.trim()).filter(s =>
        s && s.length >= 2 &&
        !/^\d+$/.test(s) &&
        !/^(mobile|physician|number|mobile numbe)$/i.test(s)
      );
      parts.forEach((name, idx) => {
        const resolved = resolvePhoneFromContactMap(name, contactResult) || resolvePhone(ROTAS[deptKey] || { contacts:{} }, { name, phone:'' });
        entries.push({
          specialty: deptKey,
          date: dateKey,
          role: roles[Math.min(idx, roles.length-1)],
          name,
          phone: resolved?.phone || '',
          phoneUncertain: !!(resolved && resolved.uncertain && resolved.phone),
          parsedFromPdf: true
        });
      });
    }
    break; // only one such line
  }

  // Also pick up consultant name from "Approved:" line
  const approvedMatch = text.match(/Approved:\s*(Dr\.[^\n]+)/i);
  if (approvedMatch) {
    const consultant = approvedMatch[1].trim();
    entries.push({ specialty: deptKey, date: '', role: 'Consultant On-Call', name: consultant, phone: '', parsedFromPdf: true });
  }

  return dedupeParsedEntries(entries);
}

const NEUROSURGERY_NAME_HINTS = {
  'dr laila': 'Dr. Laila Batarfi',
  'dr mazen': 'Dr. Mazen Al Otaibi',
  'dr sultan': 'Dr. Sultan Al Saiari',
  'dr amin': 'Dr. Amin Elghanam',
  'dr haddad': 'Dr. Mahmoud Haddad',
  'dr abdulla': 'Dr. Abdullah AlRamadan',
  'dr bader': 'Dr. Bader Al Enazi',
  'dr alsuwailem': 'Dr. AlSuwailem',
  'dr fadhel': 'Dr. Fadhel Molani',
};

function normalizeNeurosurgeryName(raw='') {
  const clean = String(raw || '').replace(/\s+/g, ' ').replace(/^Dr\.?(?=[A-Za-z])/i, 'Dr. ').trim();
  return NEUROSURGERY_NAME_HINTS[normalizeText(clean)] || clean;
}

function tokenizeNeurosurgeryRow(body='') {
  // Split by double-space (column boundaries from extractPdfText)
  // then clean up each column value
  const source = String(body || '').replace(/\b\d{3,}.*$/, '').trim();
  const columns = source.split(/\s{2,}/).map(s => s.trim()).filter(Boolean);
  // Remove trailing tokens from the contact table / header area that leak in:
  // "Neurosurgery Department", "Nerosurgery Consultants", "Residents", phone numbers, IDs
  const cleaned = columns.filter(col =>
    !/^(Neurosurgery|Nerosurgery|Neurosciences|Department|Consultants?|Residents?|Assistant|Staff|Contact|Spine|Surgery)\b/i.test(col)
    && !/^\d{5,}/.test(col)           // ID numbers
    && !/^0\d{9}/.test(col)           // phone numbers
  );
  return cleaned.map(col => normalizeNeurosurgeryName(col));
}

/**
 * Split slash-separated resident names into separate entries.
 * "Lujain / Basma" → ["Lujain", "Basma"]
 * "Basma" → ["Basma"]
 */
function splitNeurosurgerySlashNames(raw='') {
  return String(raw || '').split(/\s*\/\s*/)
    .map(n => n.trim())
    .filter(Boolean)
    .map(n => normalizeNeurosurgeryName(n))
    .filter((n, i, arr) => arr.indexOf(n) === i); // dedupe
}

function parseNeurosurgeryPdfEntries(text='', deptKey='neurosurgery') {
  const entries = [];
  // Detect month/year from PDF — supports any abbreviated month + any year
  const { month: detectedMon, year: detectedYr, monthPad } = detectPdfMonthYear(text);
  const rowRe = /^(Wednesday|Thursday|Friday|Saturday|Sunday|Monday|Tuesday)\s+(\d{1,2})-([A-Za-z]{3})-(\d{2,4})\s+(.+)$/i;
  const lines = String(text || '').split(/\n/).map(line => line.trim()).filter(Boolean);
  lines.forEach(line => {
    const match = line.match(rowRe);
    if (!match) return;
    const rowMon = _MONTH_ABBRS.indexOf(match[3].toLowerCase()) + 1;
    const rowYr  = parseInt(match[4], 10);
    const rowYr4 = rowYr < 100 ? 2000 + rowYr : rowYr;
    if (rowMon !== detectedMon || rowYr4 !== detectedYr) return;
    const dateKey = `${String(parseInt(match[2], 10)).padStart(2, '0')}/${monthPad}`;
    const body = match[5].replace(/\b\d{3,}.*$/, '').trim();
    const tokens = tokenizeNeurosurgeryRow(body);
    if (tokens.length < 3) return;

    // RELIABLE COLUMN EXTRACTION — count from the RIGHT:
    // LAST token = Neurovascular (ALWAYS skip)
    // SECOND-TO-LAST = Neurosurgeon Consultant (ALWAYS extract)
    // Remaining tokens from LEFT: [0]=ResDay, [1]=ResNight, [2]=Fellow, [3]=Associate
    //
    // This works regardless of empty cells because Neurovascular is always last.

    const lastIdx = tokens.length - 1;
    // Last token = Neurovascular → skip
    // Second-to-last = Consultant
    const consultant = tokens.length >= 4 ? (tokens[lastIdx - 1] || '') : '';
    // Everything before consultant, from left:
    const dayResident = tokens[0] || '';
    const nightResident = tokens.length >= 3 ? (tokens[1] || '') : '';
    let secondOnCall = '';
    let associate = '';

    // Tokens between nightResident (idx 1) and consultant (lastIdx-1):
    // These are Fellow and Associate (in that order)
    const middleStart = 2;
    const middleEnd = lastIdx - 1; // exclusive (consultant position)
    const middleTokens = tokens.slice(middleStart, middleEnd);
    if (middleTokens.length >= 1) secondOnCall = middleTokens[0] || '';
    if (middleTokens.length >= 2) associate = middleTokens[1] || '';

    const add = (role, name, startTime='07:30', endTime='07:30', shiftType='24h') => {
      if (!name) return;
      const resolved = resolvePhone(ROTAS[deptKey] || { contacts:{} }, { name, phone:'' }) || { phone:'', uncertain:true };
      entries.push({
        specialty: deptKey,
        date: dateKey,
        role,
        name: normalizeNeurosurgeryName(name),
        phone: resolved.phone || '',
        phoneUncertain: !!(resolved.phone && resolved.uncertain),
        startTime,
        endTime,
        shiftType,
        parsedFromPdf: true,
      });
    };

    // Split slash-separated resident names (e.g. "Lujain / Basma" → two entries)
    for (const name of splitNeurosurgerySlashNames(dayResident)) {
      add('Resident On-Duty (Day)', name, '07:30', '17:00', 'day');
    }
    for (const name of splitNeurosurgerySlashNames(nightResident)) {
      add('Resident On-Duty (Night)', name, '17:00', '07:30', 'night');
    }
    if (secondOnCall) add('2nd On-Duty', secondOnCall, '07:30', '07:30', '24h');
    if (associate) add('Associate Consultant On-Call', associate, '07:30', '07:30', '24h');
    if (consultant) add('Neurosurgeon Consultant On-Call', consultant, '07:30', '07:30', '24h');
  });
  const deduped = dedupeParsedEntries(entries);
  deduped._templateDetected = deduped.length >= 20;
  deduped._templateName = deduped._templateDetected ? `neurosurgery-${monthPad}-${detectedYr}` : '';
  return deduped;
}

// Keys are canonicalName() values (dr-stripped, al-stripped).
// canonicalName('Dr. Khalid B. Akkari')  → 'khalid b akkari'
// canonicalName('Dr. Abdulnaser Al Abadi') → 'abdulnaser abadi'
// canonicalName('Najeeb Al Musaied')     → 'najeeb musaied'
// Keys with 'dr ...' prefix were dead because canonicalName strips 'dr'.
const KPTX_NAME_HINTS = {
  'abdulnaser abadi':  'Dr. Abdulnaser Al Abadi',
  'khalid akkari':     'Dr. Khalid B. Akkari',
  'khalid b akkari':   'Dr. Khalid B. Akkari',
  'maher demerdash':   'Dr. Maher Aldemerdash',
  'najeeb musaied':    'Dr. Najeeb Al Musaied',   // full name (from "Najeeb Al Musaied")
  'najeeb':            'Dr. Najeeb Al Musaied',   // bare first name → expand so edit-dist can find "Nageeb"
  'fahad otaibi':      'Dr. Fahad Al Otaibi',
  'zahra':             'Dr. Zahra Noor',
  'ibtihal':           'Dr. Ibtihal Elsheik',
  'judee selem':       'Judee Selem',
  'amer ahmed':        'Amer Ahmed',
  'eman el rashidy':   'Eman El Rashidy',
  'eman rashidi':      'Eman El Rashidy',
};

const KPTX_COORDINATOR_NAMES = ['Judee Selem', 'Amer Ahmed', 'Eman El Rashidy', 'Eman Rashidi'];

function normalizeKptxName(raw='') {
  const clean = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  const hinted = KPTX_NAME_HINTS[canonicalName(clean)] || clean;
  return hinted.replace(/\bDr\.\s*([A-Z])/g, 'Dr. $1').replace(/\s+/g, ' ').trim();
}

function parseKptxPdfEntries(text='', deptKey='kptx') {
  // ── KPTX column layout (from PDF header) ─────────────────────
  // Col 0: Day                         → skip (day name)
  // Col 1: Date                        → dateKey
  // Col 2: Inpatient + Consultation    → IGNORE
  // Col 3: On-Call 1st                 → '1st On-Call'   16:30-07:30
  // Col 4: On-Call 2nd                 → '2nd On-Call'   16:30-07:30
  // Col 5: Consultant On-Call 24h      → 'Consultant On-Call'  07:30-07:30
  // Col 6: Consultant SCOT On-Call     → IGNORE
  // Col 7: Transplant Coordinator      → IGNORE
  //
  // Rules:
  //  • A cell may contain "Ali Al Harbi / Baher" — split on "/" per name
  //  • If the same name appears in multiple lanes on one day,
  //    keep only the first (highest-priority) occurrence:
  //    Consultant → 1st On-Call → 2nd On-Call
  // ─────────────────────────────────────────────────────────────
  const entries = [];
  const { month: detectedMon, year: detectedYr, monthPad } = detectPdfMonthYear(text);
  const rowRe = /^(Wednesday|Thursday|Friday|Saturday|Sunday|Monday|Tuesday)\s+(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(.+)$/i;
  const lines = String(text || '').split(/\n/).map(line => line.trim()).filter(Boolean);
  const dept  = ROTAS[deptKey] || { contacts:{} };
  const contactResult = buildContactMapFromText(text);

  // Resolve name → phone from PDF contact table or ROTAS
  const resolveKptxPhone = (name) =>
    resolvePhoneFromContactMap(name, contactResult)
    || resolvePhone(dept, { name, phone:'' })
    || { phone:'', uncertain:true };

  // Split a raw cell by "/" and normalize each part
  const splitCell = (raw) =>
    String(raw || '').split(/\s*\/\s*/)
      .map(s => normalizeKptxName(s.trim()))
      .filter(Boolean);

  lines.forEach(line => {
    const match = line.match(rowRe);
    if (!match) return;
    if (parseInt(match[3], 10) !== detectedMon || parseInt(match[4], 10) !== detectedYr) return;
    const dateKey = `${String(parseInt(match[2], 10)).padStart(2, '0')}/${monthPad}`;
    const body    = match[5].trim();

    // ── Step 1: strip coordinator names from the end (IGNORE) ────
    const coordName = KPTX_COORDINATOR_NAMES
      .map(n => normalizeKptxName(n))
      .find(n => new RegExp(`${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i').test(body)) || '';
    const withoutCoord = coordName
      ? body.slice(0, body.toLowerCase().lastIndexOf(coordName.toLowerCase())).trim()
      : body;

    // ── Step 2: strip SCOT consultant if present (IGNORE) ────────
    // The SCOT column appears between Consultant On-Call and Coordinator.
    // It is empty in most rows — no action needed; it doesn't affect parsing.

    // ── Step 3: extract the Consultant On-Call (last Dr. name) ───
    const consultantMatch = withoutCoord.match(/(Dr\.?\s+[A-Z][A-Za-z.''\-]+(?:\s+[A-Z][A-Za-z.''\-]+){1,5})\s*$/i);
    const consultant = consultantMatch ? normalizeKptxName(consultantMatch[1]) : '';
    const prefix     = consultantMatch
      ? withoutCoord.slice(0, consultantMatch.index).trim()
      : withoutCoord;

    // ── Step 4: split remaining body into column fields ───────────
    // After removing consultant + coordinator, remaining layout is:
    //   [Inpatient+Consult]  [1st On-Call]  [2nd On-Call?]
    // PDF.js separates columns by 2+ spaces.
    const cols = prefix.split(/\s{2,}/).map(s => s.trim()).filter(Boolean);

    // cols[0] = Inpatient + Consultation → always SKIP
    const raw1st = cols[1] || '';   // 1st On-Call
    const raw2nd = cols[2] || '';   // 2nd On-Call (may be absent)

    if (!consultant && !raw1st) return; // nothing useful

    // ── Step 5: build entries with per-lane deduplication ───────
    // Rule: if the same name appears in both 1st and 2nd On-Call columns,
    // show them only in 2nd (the explicit assignment wins; drop from 1st).
    // Consultant always blocks 1st/2nd (can't be both).
    const pushEntryRaw = (name, role, startTime, endTime, shiftType) => {
      if (!name) return;
      const resolved = resolveKptxPhone(name);
      // If a confident full name was found in the contact table and the current
      // name is a bare short name (no Dr. prefix), use the contact table name.
      const displayName = (
        resolved.matchedName &&
        !resolved.uncertain &&
        resolved.matchedName.length > name.length &&
        !name.startsWith('Dr.')
      ) ? resolved.matchedName : name;
      entries.push({
        specialty: deptKey,
        date: dateKey,
        role,
        name: displayName,
        phone: resolved.phone || '',
        phoneUncertain: !resolved.phone || !!resolved.uncertain,
        startTime,
        endTime,
        shiftType,
        parsedFromPdf: true,
      });
    };

    const usedInConsultant = new Set();
    if (consultant) {
      usedInConsultant.add(consultant.toLowerCase().replace(/\s+/g, ''));
      pushEntryRaw(consultant, 'Consultant On-Call', '07:30', '07:30', '24h');
    }

    // Pass 1: collect 2nd On-Call (2nd wins if same name also in 1st)
    const usedIn2nd = new Set();
    const pending2nd = [];
    splitCell(raw2nd).forEach(n => {
      const key = n.toLowerCase().replace(/\s+/g, '');
      if (usedInConsultant.has(key) || usedIn2nd.has(key)) return;
      usedIn2nd.add(key);
      pending2nd.push(n);
    });

    // Pass 2: 1st On-Call — skip anyone already assigned to 2nd
    const usedIn1st = new Set();
    splitCell(raw1st).forEach(n => {
      const key = n.toLowerCase().replace(/\s+/g, '');
      if (usedInConsultant.has(key) || usedIn1st.has(key) || usedIn2nd.has(key)) return;
      usedIn1st.add(key);
      pushEntryRaw(n, '1st On-Call', '16:30', '07:30', 'night');
    });

    // Push 2nd On-Call after 1st so lane order is preserved in entries
    pending2nd.forEach(n => pushEntryRaw(n, '2nd On-Call', '16:30', '07:30', 'night'));
  });

  const deduped = dedupeParsedEntries(entries);
  deduped._templateDetected = deduped.length >= 20;
  deduped._templateName = deduped._templateDetected ? `kptx-${monthPad}-${detectedYr}` : '';
  return deduped;
}

const LIVER_NAME_HINTS = {
  'may':'May Magdy',
  'attalaah':'Dr. Attalaah',
  'sharafeldin':'Sharafeldin Nourein',
  'hala':'Hala Khalifa Mohamed',
  'hadi':'Hadi Kuriry',
  'eyad':'Eyad Gadour',
  'rehab':'Rehab Abdullah',
  'taher':'Taher Majati',
  'ergin':'Ergin Latog',
  'genalyn':'Genalyn Dela Fuente',
};

function normalizeLiverParsedName(raw='') {
  const clean = String(raw || '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\bIM\.?\s*Resident\b/ig, ' ')
    .replace(/\bIM\.?\s*Res\b/ig, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return '';
  return LIVER_NAME_HINTS[canonicalName(clean)] || clean;
}

function splitLiverCoverageNames(raw='') {
  return splitPossibleNames(
    String(raw || '')
      .replace(/\([^)]*\)/g, ' ')
      .replace(/\bIM\.?\s*Resident\b/ig, '/')
      .replace(/\bIM\.?\s*Res\b/ig, '/')
      .replace(/\bResident\b/ig, '/')     // standalone "Resident" (no IM prefix)
      .replace(/\s+/g, ' ')
      .trim()
  )
    .map(normalizeLiverParsedName)
    .filter(name => name && !isLiverResidentAlias(name));
}

function parseLiverPdfEntries(text='', deptKey='liver') {
  const entries = [];
  const dept = ROTAS[deptKey] || { contacts:{} };
  const contactResult = buildContactMapFromText(text);
  const { year: detectedYr, monthPad } = detectPdfMonthYear(text);

  // ── Columnar mode: text has \t between column boundaries ──
  // extractLiverColumnarText inserts \t at detected column positions.
  // Column indices: 0=Day/Date, 1=Day Coverage, 2=After Duty, 3=2nd On-Call, 4=Consultant, 5=Coordinator
  // The date column (col 0) contains the day name + date; Day Coverage is col 1.
  // Fallback: if no \t found, use legacy space-based splitting.
  const isColumnar = text.includes('\t');

  const dateRe = /(?:Wednesday|Thursday|Friday|Saturday|Sunday|Monday|Tuesday)\s+(\d{1,2})\/(\d{1,2})\/(\d{4})/i;
  const stopRe = /^(Outpatient Service|Day|Date|\(G\)|Inpatient Service|Liver Transplant Call Schedule|KFSHD ID\/|Adult Liver Transplant Team Contact Details|Clinical|Coordinator Adult Liver Tx|Name$)/i;
  const lines = String(text || '').split(/\n/).map(line => line.trimEnd()).filter(Boolean);

  const add = (dateKey='', role='', rawName='', startTime='', endTime='', shiftType='') => {
    const names = splitLiverCoverageNames(rawName);
    if (!names.length && !/^SMRO/i.test(rawName || '')) return;
    if (/^SMRO/i.test(rawName || '')) {
      entries.push({ specialty: deptKey, date: dateKey, role, name: 'SMRO',
        phone: '', phoneUncertain: true, startTime, endTime, shiftType, parsedFromPdf: true });
      return;
    }
    names.forEach(name => {
      const resolved = resolvePhoneFromContactMap(name, contactResult)
        || resolvePhone(dept, { name, phone:'' })
        || { phone:'', uncertain:true };
      entries.push({ specialty: deptKey, date: dateKey, role, name,
        phone: resolved.phone || '', phoneUncertain: !resolved.phone || !!resolved.uncertain,
        startTime, endTime, shiftType, parsedFromPdf: true });
    });
  };

  // Helper: determine if a raw field value is a resident/SMRO placeholder
  const isResidentPlaceholder = (raw='') =>
    /^SMRO/i.test(raw) || /^\s*(?:IM\.?\s*)?Res(?:ident)?\s*$/i.test(raw);

  // Helper: emit one date row from 5 positional column values
  const emitRow = (dateKey, col0, col1, col2, col3) => {
    // col0 = Day Coverage, col1 = After Duty, col2 = 2nd On-Call, col3 = Consultant
    // (Coordinator/Outpatient already excluded before this is called)
    const dayCovRaw = (col0 || '').replace(/\([^)]*\)/g, ' ').replace(/\([^)]*$/g, ' ').trim();
    if (dayCovRaw) add(dateKey, 'Day Coverage (07:30–16:30)', dayCovRaw, '07:30', '16:30', 'day');
    // Detect IM Resident placeholder — may appear as "IM Resident", "IM.Res", or
    // "IM / resident" (split across chunks in columnar mode)
    if (/\bIM\.?\s*Res(?:ident)?\b/i.test(dayCovRaw)
        || (/\bIM\b/i.test(dayCovRaw) && /\bRes(?:ident)?\b/i.test(dayCovRaw))) {
      entries.push({ specialty: deptKey, date: dateKey, role: 'Day Coverage (07:30–16:30)',
        name: 'IM.Resident', phone: '', phoneUncertain: true,
        startTime: '07:30', endTime: '16:30', shiftType: 'day', parsedFromPdf: true });
    }

    const afterRaw = (col1 || '').replace(/\([^)]*\)/g, ' ').trim();
    if (isResidentPlaceholder(afterRaw)) {
      add(dateKey, '1st On-Call After Duty (16:30–07:30)', 'SMRO', '16:30', '07:30', 'night');
    } else if (afterRaw) {
      add(dateKey, '1st On-Call After Duty (16:30–07:30)', afterRaw, '16:30', '07:30', 'night');
    }

    const secondRaw = (col2 || '').replace(/\([^)]*\)/g, ' ').trim();
    if (secondRaw) add(dateKey, '2nd On-Call (21:00–07:30)', secondRaw, '21:00', '07:30', 'night');
    // ↑ If 2nd On-Call cell is blank → nothing emitted. No borrowing.

    const consultRaw = (col3 || '').replace(/\([^)]*\)/g, ' ').trim();
    if (consultRaw) add(dateKey, 'Consultant On-Call (24h)', consultRaw, '07:30', '07:30', '24h');
  };

  if (isColumnar) {
    // ── COLUMNAR PATH: each line is TAB-delimited by detected x-positions ──
    // Detect column mapping: find the header row with "Day" + "1st On-Call" etc.
    // The tab-split columns from extractLiverColumnarText are positional (col 0, 1, 2, …).
    // We need to identify which positional column maps to which role.
    // Heuristic: find a header line containing "Day" or "Coverage" in one tab-column,
    // and use the tab-column indices for data rows.
    //
    // Expected layout: col0=Day/Date, col1=DayCoverage, col2=AfterDuty, col3=2ndOnCall,
    //                  col4=Consultant, col5=Coordinator(excluded)
    // But column 0 may contain the date OR "Day" header.  We detect the offset.

    // Accumulate per-date data: for each dateKey, merge all lines that belong to it
    const dateRows = {}; // dateKey → { cols: [Set per column] }
    let currentDateKey = null;
    let dateOffset = 0; // how many tab-columns the date occupies (usually 1)

    for (const line of lines) {
      const cols = line.split('\t');
      // Try to find a date in any of the first 2 columns
      let dateMatch = null;
      for (let c = 0; c < Math.min(cols.length, 2); c++) {
        const m = cols[c].match(dateRe);
        if (m && parseInt(m[3], 10) === detectedYr) {
          dateMatch = m;
          dateOffset = c + 1; // data columns start after the date column
          break;
        }
      }
      if (dateMatch) {
        currentDateKey = `${String(parseInt(dateMatch[1], 10)).padStart(2, '0')}/${String(parseInt(dateMatch[2], 10)).padStart(2, '0')}`;
        if (!dateRows[currentDateKey]) dateRows[currentDateKey] = { cols: [] };
        // If there's data on the same line as the date, collect it
        for (let c = dateOffset; c < cols.length; c++) {
          const val = cols[c].trim();
          if (val) {
            if (!dateRows[currentDateKey].cols[c - dateOffset]) dateRows[currentDateKey].cols[c - dateOffset] = [];
            dateRows[currentDateKey].cols[c - dateOffset].push(val);
          }
        }
        continue;
      }
      // Stop words
      const firstCol = (cols[0] || '').trim();
      if (stopRe.test(firstCol)) { currentDateKey = null; continue; }
      if (!currentDateKey) continue;

      // Continuation line for current date — merge into data columns.
      // Skip tab-columns before dateOffset (those are Date column residue).
      for (let c = dateOffset; c < cols.length; c++) {
        const dataCol = c - dateOffset;
        const val = cols[c].trim();
        if (val) {
          if (!dateRows[currentDateKey].cols[dataCol]) dateRows[currentDateKey].cols[dataCol] = [];
          dateRows[currentDateKey].cols[dataCol].push(val);
        }
      }
    }

    // Emit entries from the accumulated column data
    for (const [dateKey, row] of Object.entries(dateRows)) {
      const getCol = i => (row.cols[i] || []).join(' / ');
      // Inpatient columns: 0=Day Coverage, 1=After Duty, 2=2nd On-Call, 3=Consultant
      // Column 4=Coordinator (excluded), 5+=Outpatient (excluded)
      emitRow(dateKey, getCol(0), getCol(1), getCol(2), getCol(3));
    }
  } else {
    // ── LEGACY PATH: space-based splitting (fallback when columnar extraction fails) ──
    const blocks = [];
    let current = null;
    lines.forEach(line => {
      const trimmed = line.trim();
      const match = trimmed.match(/^(Wednesday|Thursday|Friday|Saturday|Sunday|Monday|Tuesday)\s+(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(.*))?$/i);
      if (match) {
        if (parseInt(match[4], 10) !== detectedYr) return;
        if (current) blocks.push(current);
        current = {
          dateKey: `${String(parseInt(match[2], 10)).padStart(2, '0')}/${String(parseInt(match[3], 10)).padStart(2, '0')}`,
          chunks: [match[5] || ''],
        };
        return;
      }
      if (!current) return;
      if (stopRe.test(trimmed)) { blocks.push(current); current = null; return; }
      current.chunks.push(trimmed);
    });
    if (current) blocks.push(current);

    blocks.forEach(block => {
      const rawJoined = block.chunks.join('   ')
        .replace(/\([^)]*\)/g, ' ')
        .replace(/\([^)]*$/gm, ' ')
        .replace(/\bIM\.?\s{2,}(Res(?:ident)?)\b/gi, 'IM $1');
      const fields = rawJoined.split(/\s{2,}/).map(part => part.trim()).filter(Boolean);
      if (!fields.length) return;
      // Legacy mapping: fields[0]=DayCov, [1]=AfterDuty, [2]=2ndOnCall, [3]=Consultant, [4]=Coordinator(excluded)
      emitRow(block.dateKey, fields[0], fields[1], fields[2], fields[3]);
    });
  }

  const deduped = dedupeParsedEntries(entries);
  deduped._templateDetected = /Liver Transplant Call Schedule/i.test(text) && deduped.length >= 20;
  deduped._templateName = deduped._templateDetected ? `liver-${monthPad}-${detectedYr}` : '';
  return deduped;
}

const SURGERY_NAME_HINTS = {
  'reem': 'Dr. Reem Al Hubail',
  'faisal': 'Dr. Faisal Al Rashid',
  'mahdi': 'Dr. Mahdi Ahmad',
  'talal': 'Dr. Talal Dugaither',
  'ghazal': 'Dr. Thabet Al-Ghazal',
  'maiman': 'Dr. Hisham Maiman',
  'gamal': 'Dr. Gamal Abbas',
  'shareef': 'Dr. Shareef Alqathani',
  'ashraf': 'Dr. Ashraf Sharkawy',
  'mughahid': 'Dr. Mugahid Abualhassan',
  'najdi': 'Dr. Mohammed Elnagdi',
  'nabegh': 'Dr. Mohamad Nabegh',
  'halawani': 'Dr. Mahmoud Elhalwany',
  'wabarai': 'Dr. Abdullah Wabari',
  'wabari': 'Dr. Abdullah Wabari',
  'manal': 'Dr. Manal Al Naimi',
  'ayman': 'Dr. Ayman Ghashan',
  'ameera': 'Dr. Ameera Balhareth',
  'a altala': 'Abdulaziz AlTala',
  'altala': 'Abdulaziz AlTala',
  'abdulaziz altala': 'Abdulaziz AlTala',
  'cheema': 'Dr. Ahsan Cheema',
  'hamidah': 'Dr. Hamidah Abdullah',
  'hawra': 'Dr. Hawra Alatooq',
  'hidar': 'Dr. Haidar AlNahwai',
  'haidar': 'Dr. Haidar AlNahwai',
  'rawan': 'Dr. Rawan AlIbrahim',
  'almusained': 'Dr. Mohammed AlMusained',
  'almusianed': 'Dr. Mohammed AlMusained',
  'musained': 'Dr. Mohammed AlMusained',
  'musianed': 'Dr. Mohammed AlMusained',
  'alsafar': 'Dr. Ahmad AlSafar',
  'riyadh': 'Dr. Riyadh AlGhamdi',
  'hebah': 'Dr. Heba AlWafi',
  'amjad': 'Dr. Amjad AlNemeri',
  'zainab': 'Dr. Zainab AlRamdhan',
  'safeer': 'Dr. Safeer AlGhathami',
  'ahmad': 'Dr. Ahmad AlKhars',
  'loay': 'Dr. Loay Bojabarah',
  'sara': 'Dr. Sara Ghazal',
  'ahmad s': 'Dr. Ahmad AlSafar',
  'fozan': 'Dr. Fozan A. Al Dulaijan',
  'mansi': 'Dr. Nabeel Mansi',
  'zaher': 'Dr. Zaid Zaher',
  'omar': 'Dr. Omar Baasim',
  'madkhali': 'Dr. Tariq Madkhali',
  'abdulmohsen': 'Dr. Abdulmohsin Dilaijan',
  'nora': 'Dr. Nora Al Mana',
  'tamadher': 'Dr. Tumadher',
  'tumadher': 'Dr. Tumadher',
  'awrad': 'Dr. Awrad Nasralla',
};

// ── PEDIATRICS PARSER ─────────────────────────────────────────
// Handles the 6-column monthly pediatrics rota:
// Col 1: 1st On-Call  3:30 PM–7:30 AM
// Col 2: 2nd On-Call  24h
// Col 3: 3rd On-Call
// Col 4: Hospitalist KFSH ER  7:30 AM–4:30 PM
// Col 5: Hospitalist Ward-E   7:30 AM–4:30 PM  ← excluded from display
// Col 6: Hospitalist Ward-E and ER  4:30 PM–7:30 AM

const PEDIATRICS_ROLES = [
  { role:'1st On-Call 3:30 PM-7:30 AM',    startTime:'15:30', endTime:'07:30', shiftType:'on-call' },
  { role:'2nd On-Call 24h',                 startTime:'07:30', endTime:'07:30', shiftType:'24h'     },
  { role:'3rd On-Call',                     startTime:'07:30', endTime:'07:30', shiftType:'24h'     },
  { role:'KFSH ER 7:30 AM-4:30 PM',        startTime:'07:30', endTime:'16:30', shiftType:'day'     },
  { role:'Hospitalist Ward-E 7:30-4:30',   startTime:'07:30', endTime:'16:30', shiftType:'day'     }, // excluded
  { role:'Hospitalist Ward-E and ER 4:30 PM-7:30 AM', startTime:'16:30', endTime:'07:30', shiftType:'night' },
];

/**
 * Pediatrics-specific contact map built from the uploaded PDF's phone table.
 *
 * Why a dedicated builder (not the generic buildContactMapFromText):
 *   The generic pipeline uses normKey() for altMap lookup. Schedule columns in
 *   pediatrics often contain a single firstname ("Dr Badriah", "Dr Ranya") that
 *   is < 8 chars and therefore BLOCKED by the generic fuzzy guard.  This causes
 *   either (a) no phone found, or (b) the code falls through to a fuzzy ROTAS
 *   lookup that assigns a wrong number from a different doctor with a similar name.
 *
 * This builder indexes every contact by multiple keys:
 *   – full bare name (letters+spaces, lowercased)
 *   – first name token (lowercased, letters only)
 *   – last name token (lowercased, letters only, if >= 4 chars)
 *
 * Resolution is done purely by these indexed keys — no fuzzy scoring, no
 * length guards, no fallback to an unrelated doctor.
 */
function buildPediatricsPdfContactMap(text='') {
  // byKey: normalised-token → [{phone, fullName}]
  const byKey = new Map();

  function pedNorm(s='') {
    // Letters only, lowercase — used as the canonical key for each token
    return s.toLowerCase().replace(/[^a-z]/g, '');
  }

  function addContact(rawName, phone) {
    if (!rawName || !phone) return;
    const bare = rawName.replace(/^Dr\.?\s*/i, '').trim();
    if (!bare || bare.length < 2) return;
    const parts = bare.split(/\s+/).filter(w => w.length >= 2);
    if (!parts.length) return;

    const push = (key, entry) => {
      const k = pedNorm(key);
      if (!k || k.length < 3) return;
      const arr = byKey.get(k) || [];
      if (!arr.some(e => e.phone === entry.phone)) byKey.set(k, [...arr, entry]);
    };

    const entry = { phone, fullName: rawName };

    // Full bare name joined (handles "Ahmed Abuelazz" → "ahmedabuelazz" and
    // also "ahmed abuelazz" for the spaced variant below)
    push(parts.join(''), entry);          // "ahmedabuelazz"
    push(parts.join(' '), entry);         // "ahmed abuelazz"

    // First name
    push(parts[0], entry);

    // Last name (if >= 4 chars and different from first)
    if (parts.length >= 2) {
      const last = parts[parts.length - 1];
      if (last.length >= 4 && pedNorm(last) !== pedNorm(parts[0])) push(last, entry);
    }
  }

  // Role/title words that mark the end of a name sequence
  const CONTACT_STOP = new Set([
    'consultant','associate','assistant','resident','fellow','physician','specialist',
    'pediatric','ward','er','icu','call','duty','on','3rd','1st','2nd','rota',
    'schedule','department','division','section','head','senior','junior','staff',
  ]);

  const lines = String(text || '').split(/\n/).map(l => l.trim()).filter(Boolean);
  for (const line of lines) {
    // Find any Saudi mobile number anywhere in the line (05XXXXXXXX or 5XXXXXXXX).
    // Do NOT require the phone to be adjacent to the name — the contact table may
    // have intermediate columns (role, ID, extension) between name and phone.
    const phoneMatch = line.match(/\b0?(5\d{8})\b/);
    if (!phoneMatch) continue;
    const phone = '0' + phoneMatch[1];

    // Take everything BEFORE the phone number — the doctor's name is in there.
    const beforePhone = line.slice(0, line.indexOf(phoneMatch[0])).trim();
    if (!beforePhone) continue;

    // Extract name tokens from the start of that text.
    // Stop at: pure numbers (IDs, extensions), stop-word role labels, or after 5 tokens.
    const tokens = beforePhone.split(/\s+/).filter(Boolean);
    const nameTokens = [];
    for (const tok of tokens) {
      if (/^\d+$/.test(tok)) break;                          // pure number → stop
      const tl = tok.toLowerCase().replace(/[^a-z]/g, '');
      if (CONTACT_STOP.has(tl) && nameTokens.length >= 1) break;  // role word → stop
      if (/^[A-Za-z]/.test(tok)) nameTokens.push(tok);
      if (nameTokens.length >= 5) break;
    }

    if (nameTokens.length >= 1) addContact(nameTokens.join(' '), phone);
  }

  return byKey;
}

/**
 * Resolve a schedule column name to a phone using the pediatrics contact map.
 *
 * Priority:
 *   1. Full bare-name exact match (no ambiguity) → certain
 *   2. First-name match with exactly 1 candidate → certain
 *   3. First-name match with multiple candidates, narrowed by last name → certain
 *   4. First-name / last-name match with remaining ambiguity → uncertain
 *   5. ROTAS contacts exact lookup (no fuzzy) → certain / uncertain per ROTAS
 *   6. null — keep "?"
 *
 * Guarantees:
 *   – A wrong number is NEVER assigned (no fuzzy scoring against unrelated doctors).
 *   – A single-firstname like "Dr Ranya" resolves if she appears exactly once in
 *     the contact table, and stays "?" if she doesn't.
 */
function resolvePediatricsPhone(rawName, pdfContactMap, rotasContacts={}) {
  if (!rawName) return null;

  function pedNorm(s='') { return s.toLowerCase().replace(/[^a-z]/g, ''); }

  // Extract bare canonical name from a PDF contact entry's fullName field.
  function pedCanonical(fullName) {
    return fullName ? fullName.replace(/^Dr\.?\s*/i, '').trim() : null;
  }

  const bare  = rawName.replace(/^Dr\.?\s*/i, '').trim();
  const parts = bare.split(/\s+/).filter(w => w.length >= 1);
  if (!parts.length) return null;

  // ── 1. Full bare-name match ───────────────────────────────────
  // Try joined (no spaces) then spaced — RULE C: return full canonical name.
  for (const fullKey of [parts.join(''), parts.join(' ')]) {
    const candidates = pdfContactMap.get(pedNorm(fullKey)) || [];
    if (candidates.length === 1) return { phone: candidates[0].phone, uncertain: false, canonicalName: pedCanonical(candidates[0].fullName) };
    if (candidates.length > 1)  return { phone: candidates[0].phone, uncertain: true  };
  }

  // ── 2. First-name lookup ──────────────────────────────────────
  const byFirst = pdfContactMap.get(pedNorm(parts[0])) || [];

  if (byFirst.length === 1) {
    return { phone: byFirst[0].phone, uncertain: false, canonicalName: pedCanonical(byFirst[0].fullName) };
  }

  if (byFirst.length > 1 && parts.length >= 2) {
    // Narrow by last name token
    const lastKey = pedNorm(parts[parts.length - 1]);
    const refined = byFirst.filter(c => {
      const cBare = c.fullName.replace(/^Dr\.?\s*/i, '');
      return cBare.split(/\s+/).some(p => pedNorm(p) === lastKey);
    });
    if (refined.length === 1) return { phone: refined[0].phone, uncertain: false, canonicalName: pedCanonical(refined[0].fullName) };
    if (refined.length > 1)  return { phone: refined[0].phone, uncertain: true  };
    // Could not narrow — fall through with uncertain
    return { phone: byFirst[0].phone, uncertain: true };
  }

  if (byFirst.length > 1) {
    // Single-token query with multiple candidates: can't pick one reliably
    return { phone: byFirst[0].phone, uncertain: true };
  }

  // ── 3. Last-name lookup (multi-part names only) ───────────────
  if (parts.length >= 2) {
    const byLast = pdfContactMap.get(pedNorm(parts[parts.length - 1])) || [];
    if (byLast.length === 1) return { phone: byLast[0].phone, uncertain: false, canonicalName: pedCanonical(byLast[0].fullName) };
    if (byLast.length > 1)  return { phone: byLast[0].phone, uncertain: true  };
  }

  // ── 4. ROTAS exact match — enrich with PDF canonical name (RULE C, same as Hematology step 1) ─
  const exactKeys = [`Dr. ${bare}`, `Dr ${bare}`, bare];
  for (const k of exactKeys) {
    if (rotasContacts[k]) {
      const phone = rotasContacts[k];
      // Try PDF map for canonical name before returning abbreviated bare name
      for (const fullKey of [parts.join(''), parts.join(' ')]) {
        const cands = pdfContactMap.get(pedNorm(fullKey)) || [];
        if (cands.length === 1) return { phone, uncertain: false, canonicalName: pedCanonical(cands[0].fullName) };
      }
      const longParts = parts.filter(p => p.length >= 3);
      for (const p of longParts) {
        const cands = pdfContactMap.get(pedNorm(p)) || [];
        if (cands.length === 1) return { phone, uncertain: false, canonicalName: pedCanonical(cands[0].fullName) };
      }
      // PDF map had no confident match — return ROTAS phone with original name
      return { phone, uncertain: false };
    }
  }

  return null;  // No reliable match — keep "?"
}

function parsePediatricsPdfEntries(text='', deptKey='pediatrics') {
  const entries = [];
  const rotasContacts = (ROTAS[deptKey] || {}).contacts || {};

  // Build the phone map from this PDF's own contact table — done once per upload.
  const pdfContactMap = buildPediatricsPdfContactMap(text);

  // Actual PDF format: "Wed 1/4/2026  col1  col2  ..."
  // Short day abbreviations; date as day/month/year with no leading zeros (e.g. 1/4/2026)
  // Detect month/year from PDF — supports any month, not just April 2026
  const { month: detectedMon, year: detectedYr, monthPad } = detectPdfMonthYear(text);
  // Generic: captures any numeric month + any 4-digit year
  const rowRe = /^(?:Wed|Thu|Fri|Sat|Sun|Mon|Tue)\w*\s+(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(.*)/i;
  const lines = String(text || '').split(/\n/).map(l => l.trim()).filter(Boolean);

  lines.forEach(line => {
    const match = line.match(rowRe);
    if (!match) return;
    if (parseInt(match[2], 10) !== detectedMon || parseInt(match[3], 10) !== detectedYr) return;
    const day = parseInt(match[1], 10);
    if (day < 1 || day > 31) return;
    const dateKey = `${String(day).padStart(2,'0')}/${monthPad}`;
    const body = match[4].trim();
    if (!body) return;

    // Split by 2+ spaces or tabs to separate columns
    const rawCols = body.split(/\s{2,}|\t/).map(s => s.trim()).filter(Boolean);

    // The 3rd On-Call column is only present on some days (always "Dr. Ranya" when present).
    // Detect by checking if the 3rd column (index 2) contains "Ranya".
    // Without 3rd: rawCols → [1st, 2nd, KFSH ER, Ward-E, Ward-E+ER, GI, ...]
    // With 3rd:    rawCols → [1st, 2nd, 3rd(Ranya), KFSH ER, Ward-E, Ward-E+ER, GI, ...]
    const has3rdOnCall = rawCols.length >= 3 && /ranya/i.test(rawCols[2]);
    // colToRole maps rawCols index → PEDIATRICS_ROLES index
    const colToRole = has3rdOnCall
      ? [0, 1, 2, 3, 4, 5]   // 3rd present: 6 on-call columns
      : [0, 1, 3, 4, 5];      // 3rd absent: skip role index 2

    rawCols.forEach((rawName, colIdx) => {
      if (colIdx >= colToRole.length) return; // ignore subspecialty columns (GI, Endo, etc.)
      const roleIdx = colToRole[colIdx];
      if (roleIdx === undefined || roleIdx >= PEDIATRICS_ROLES.length) return;
      if (!rawName || rawName.length < 2) return;
      const roleMeta = PEDIATRICS_ROLES[roleIdx];
      const resolved = resolvePediatricsPhone(rawName, pdfContactMap, rotasContacts)
        || { phone: '', uncertain: true };
      entries.push({
        specialty: deptKey,
        date: dateKey,
        role: roleMeta.role,
        name: (resolved && resolved.canonicalName) || rawName,
        phone: resolved.phone || '',
        phoneUncertain: !resolved.phone || !!resolved.uncertain,
        startTime: roleMeta.startTime,
        endTime: roleMeta.endTime,
        shiftType: roleMeta.shiftType,
        parsedFromPdf: true,
      });
    });
  });

  const deduped = dedupeParsedEntries(entries);
  deduped._templateDetected = deduped.length >= 20;
  deduped._templateName = deduped._templateDetected ? `pediatrics-${monthPad}-${detectedYr}` : '';
  return deduped;
}

// ── ORTHOPEDICS PARSER ───────────────────────────────────────
// Row format: "Wed 08/04/2026  Name1  Name2  Name3  Name4"
// Columns (left→right): Resident On-Call | 2nd On-Call | Associate/Pediatric Consultant | Consultant On-Call
// Full-name expansion (RULE C): same pattern as Pediatrics / Hematology.

/**
 * Build a contact map from the Orthopedics PDF phone table.
 * Identical strategy to buildPediatricsPdfContactMap — indexes by:
 *   • joined tokens (no spaces), spaced tokens, first name, last name (≥4 chars)
 * Returns a Map<normKey, [{phone, fullName}]>.
 */
function buildOrthopedicsPdfContactMap(text='') {
  const byKey = new Map();

  function orthoNorm(s='') {
    return s.toLowerCase().replace(/[^a-z]/g, '');
  }

  function addContact(rawName, phone) {
    if (!rawName || !phone) return;
    const bare = rawName.replace(/^Dr\.?\s*/i, '').trim();
    if (!bare || bare.length < 2) return;
    const parts = bare.split(/\s+/).filter(w => w.length >= 2);
    if (!parts.length) return;

    const push = (key, entry) => {
      const k = orthoNorm(key);
      if (!k || k.length < 3) return;
      const arr = byKey.get(k) || [];
      if (!arr.some(e => e.phone === entry.phone)) byKey.set(k, [...arr, entry]);
    };

    const entry = { phone, fullName: rawName };
    push(parts.join(''), entry);    // "ahmedabuelazz"
    push(parts.join(' '), entry);   // "ahmed abuelazz"
    push(parts[0], entry);          // first name
    if (parts.length >= 2) {
      const last = parts[parts.length - 1];
      if (last.length >= 4 && orthoNorm(last) !== orthoNorm(parts[0])) push(last, entry);
    }
  }

  const CONTACT_STOP = new Set([
    'consultant','associate','assistant','resident','fellow','physician','specialist',
    'orthopedic','orthopedics','ward','er','icu','call','duty','on','3rd','1st','2nd','rota',
    'schedule','department','division','section','head','senior','junior','staff',
  ]);

  const lines = String(text || '').split(/\n/).map(l => l.trim()).filter(Boolean);
  for (const line of lines) {
    const phoneMatch = line.match(/\b0?(5\d{8})\b/);
    if (!phoneMatch) continue;
    const phone = '0' + phoneMatch[1];

    const beforePhone = line.slice(0, line.indexOf(phoneMatch[0])).trim();
    if (!beforePhone) continue;

    const tokens = beforePhone.split(/\s+/).filter(Boolean);
    const nameTokens = [];
    for (const tok of tokens) {
      if (/^\d+$/.test(tok)) break;
      const tl = tok.toLowerCase().replace(/[^a-z]/g, '');
      if (CONTACT_STOP.has(tl) && nameTokens.length >= 1) break;
      if (/^[A-Za-z]/.test(tok)) nameTokens.push(tok);
      if (nameTokens.length >= 5) break;
    }
    if (nameTokens.length >= 1) addContact(nameTokens.join(' '), phone);
  }

  return byKey;
}

/**
 * Resolve a schedule cell name → { phone, uncertain, canonicalName }.
 * Identical logic to resolvePediatricsPhone (RULE C: returns full canonical name).
 * Priority:
 *   1. Full bare-name exact match (1 candidate) → certain
 *   2. First-name with exactly 1 candidate → certain
 *   3. First-name narrowed by last name (1 candidate) → certain
 *   4. Last-name match (1 candidate) → certain
 *   5. ROTAS exact match — enriched with PDF canonical name if available
 *   6. null — keep "?"
 */
function resolveOrthopedicsPhone(rawName, pdfContactMap, rotasContacts={}) {
  if (!rawName) return null;

  function orthoNorm(s='') { return s.toLowerCase().replace(/[^a-z]/g, ''); }

  function orthoCanonical(fullName) {
    return fullName ? fullName.replace(/^Dr\.?\s*/i, '').trim() : null;
  }

  const bare  = rawName.replace(/^Dr\.?\s*/i, '').trim();
  const parts = bare.split(/\s+/).filter(w => w.length >= 1);
  if (!parts.length) return null;

  // ── 1. Full bare-name match ───────────────────────────────────
  for (const fullKey of [parts.join(''), parts.join(' ')]) {
    const candidates = pdfContactMap.get(orthoNorm(fullKey)) || [];
    if (candidates.length === 1) return { phone: candidates[0].phone, uncertain: false, canonicalName: orthoCanonical(candidates[0].fullName) };
    if (candidates.length > 1)  return { phone: candidates[0].phone, uncertain: true  };
  }

  // ── 2. First-name lookup ──────────────────────────────────────
  const byFirst = pdfContactMap.get(orthoNorm(parts[0])) || [];

  if (byFirst.length === 1) {
    return { phone: byFirst[0].phone, uncertain: false, canonicalName: orthoCanonical(byFirst[0].fullName) };
  }

  if (byFirst.length > 1 && parts.length >= 2) {
    const lastKey = orthoNorm(parts[parts.length - 1]);
    const refined = byFirst.filter(c => {
      const cBare = c.fullName.replace(/^Dr\.?\s*/i, '');
      return cBare.split(/\s+/).some(p => orthoNorm(p) === lastKey);
    });
    if (refined.length === 1) return { phone: refined[0].phone, uncertain: false, canonicalName: orthoCanonical(refined[0].fullName) };
    if (refined.length > 1)  return { phone: refined[0].phone, uncertain: true  };
    return { phone: byFirst[0].phone, uncertain: true };
  }

  if (byFirst.length > 1) {
    return { phone: byFirst[0].phone, uncertain: true };
  }

  // ── 3. Last-name lookup (multi-part names only) ───────────────
  if (parts.length >= 2) {
    const byLast = pdfContactMap.get(orthoNorm(parts[parts.length - 1])) || [];
    if (byLast.length === 1) return { phone: byLast[0].phone, uncertain: false, canonicalName: orthoCanonical(byLast[0].fullName) };
    if (byLast.length > 1)  return { phone: byLast[0].phone, uncertain: true  };
  }

  // ── 4. ROTAS confirms this name exists; look up phone + full name from PDF ─
  // The PDF contact table is the authoritative source for the current month:
  //   • If PDF has a confident match → use PDF phone + PDF canonical name (most accurate).
  //   • If PDF has NO entry for this name → the number is unknown for this month;
  //     return ROTAS phone as uncertain so the UI shows "?" instead of a
  //     potentially wrong or stale number.
  const exactKeys = [`Dr. ${bare}`, `Dr ${bare}`, bare];
  for (const k of exactKeys) {
    if (rotasContacts[k]) {
      for (const fullKey of [parts.join(''), parts.join(' ')]) {
        const cands = pdfContactMap.get(orthoNorm(fullKey)) || [];
        if (cands.length === 1) {
          return { phone: cands[0].phone, uncertain: false, canonicalName: orthoCanonical(cands[0].fullName) };
        }
      }
      const longParts = parts.filter(p => p.length >= 3);
      for (const p of longParts) {
        const cands = pdfContactMap.get(orthoNorm(p)) || [];
        if (cands.length === 1) {
          return { phone: cands[0].phone, uncertain: false, canonicalName: orthoCanonical(cands[0].fullName) };
        }
      }
      // Not in PDF contact table — phone is uncertain for this month
      return { phone: rotasContacts[k], uncertain: true, canonicalName: bare };
    }
  }

  return null;  // No match anywhere — keep "?"
}

function parseOrthopedicsPdfEntries(text='', deptKey='orthopedics') {
  const rotasContacts = (ROTAS[deptKey] || {}).contacts || {};
  const pdfContactMap = buildOrthopedicsPdfContactMap(text);
  const entries = [];

  // PDF column layout (all roles are 24h — 7:30 AM to 7:30 AM):
  //   Col 0: Resident On Call       (single first name, no Dr prefix)
  //   Col 1: 2nd On Call Assistant  (first name or last name, no Dr prefix)
  //   Col 2: Pediatric Orthopedic   (Dr [Name] or absent)
  //   Col 3: Associate Consultant   (Dr [Name] or absent)
  //   Col 4: Adult Orthopedic       (Dr [Name] or absent)
  // Cols 2-4 are often empty; all three are shown as Consultant On-Call.
  const ORTHO_ROLES = [
    { role: 'Resident On-Call',   startTime: '07:30', endTime: '07:30', shiftType: '24h' },
    { role: '2nd On-Call',        startTime: '07:30', endTime: '07:30', shiftType: '24h' },
    { role: 'Consultant On-Call', startTime: '07:30', endTime: '07:30', shiftType: '24h' },
    { role: 'Consultant On-Call', startTime: '07:30', endTime: '07:30', shiftType: '24h' },
    { role: 'Consultant On-Call', startTime: '07:30', endTime: '07:30', shiftType: '24h' },
  ];

  // Flexible date regex — handles spaces around separators:
  //   "01/04/2026", "01 / 04 / 2026", "1-4-26"
  // Capture groups: (day)(month)(year)
  const dateRe = /(\d{1,2})\s*[\/\-]\s*(\d{1,2})\s*[\/\-]\s*(\d{2,4})/;

  const lines = String(text || '').split(/\n/).map(l => l.trim()).filter(Boolean);

  // Use shared detectPdfMonthYear — works for any month/year
  const { month: detectedMon, year: detectedYr, monthPad: monPad } = detectPdfMonthYear(text);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const dm = line.match(dateRe);
    if (!dm) continue;
    const mon = parseInt(dm[2], 10);
    const yr  = parseInt(dm[3], 10);
    const yr4 = yr < 100 ? 2000 + yr : yr;
    if (mon !== detectedMon) continue;               // detected month only
    if (yr4 !== detectedYr) continue;                // detected year only
    const day = parseInt(dm[1], 10);
    if (day < 1 || day > 31) continue;
    const dateKey = `${String(day).padStart(2, '0')}/${monPad}`;

    // Layout A ONLY: names must be on the SAME line as the date.
    // Layout B (look-ahead to next line) is intentionally omitted — the
    // contact table at the bottom of the PDF has the same line structure
    // (Dr Name  phone) and would be wrongly assigned to whichever date
    // happened to have no same-line names.
    const afterDate = line.slice(line.indexOf(dm[0]) + dm[0].length).trim();
    if (!afterDate || !/[A-Za-z]{2,}/.test(afterDate)) continue;

    // Strip phone numbers that may have leaked into the row (defense in depth)
    const body = afterDate.replace(/\b0?(5\d{8})\b/g, '').trim();
    if (!body) continue;

    // Split columns by 2+ spaces or tabs.
    // Re-join lone "Dr" / "Dr." tokens with the following token.
    const rawParts = body.split(/\s{2,}|\t/).map(s => s.trim()).filter(Boolean);
    const cols = [];
    for (let j = 0; j < rawParts.length; j++) {
      if (/^Dr\.?$/i.test(rawParts[j]) && j + 1 < rawParts.length) {
        cols.push('Dr ' + rawParts[++j]);
      } else {
        cols.push(rawParts[j]);
      }
    }

    cols.forEach((rawName, idx) => {
      if (idx >= ORTHO_ROLES.length) return;
      if (!rawName || rawName.length < 2) return;
      const roleMeta = ORTHO_ROLES[idx];
      const resolved = resolveOrthopedicsPhone(rawName, pdfContactMap, rotasContacts);
      entries.push({
        specialty: deptKey,
        date: dateKey,
        role: roleMeta.role,
        name: (resolved && resolved.canonicalName) || rawName,
        phone: (resolved && resolved.phone) || '',
        phoneUncertain: !resolved || !resolved.phone || !!resolved.uncertain,
        startTime: roleMeta.startTime,
        endTime: roleMeta.endTime,
        shiftType: roleMeta.shiftType,
        parsedFromPdf: true,
      });
    });
  }

  const deduped = dedupeParsedEntries(entries);
  deduped._templateDetected = deduped.length >= 20;
  deduped._templateName = deduped._templateDetected ? `orthopedics-${monPad}-${detectedYr}` : '';
  return deduped;
}

const SURGERY_TEMPLATE_RESIDENTS = {
  '01/04': { junior:'A.AlTala', senior:'Hamidah' },
  '02/04': { junior:'Hawra', senior:'AlMusained' },
  '03/04': { junior:'Hidar', senior:'Sara' },
  '04/04': { junior:'Loay', senior:'AlSafar' },
  '05/04': { junior:'Zainab', senior:'Rawan' },
  '06/04': { junior:'Ahmad', senior:'Hebah' },
  '07/04': { junior:'Safeer', senior:'Amjad' },
  '08/04': { junior:'Hidar', senior:'Hamidah' },
  '09/04': { junior:'A.AlTala', senior:'Mahdi' },
  '10/04': { junior:'Ahmad', senior:'Rawan' },
  '11/04': { junior:'Zainab', senior:'AlMusianed' },
  '12/04': { junior:'Loay', senior:'Sara' },
  '13/04': { junior:'Hawra', senior:'AlSafar' },
  '14/04': { junior:'Ahmad', senior:'Rawan' },
  '15/04': { junior:'Hidar', senior:'Mahdi' },
  '16/04': { junior:'Zainab', senior:'Hebah' },
  '17/04': { junior:'Hawra', senior:'Riyadh' },
  '18/04': { junior:'Safeer', senior:'Hamidah' },
  '19/04': { junior:'A.AlTala', senior:'AlSafar' },
  '20/04': { junior:'Hidar', senior:'Amjad' },
  '21/04': { junior:'Hawra', senior:'Riyadh' },
  '22/04': { junior:'Zainab', senior:'Sara' },
  '23/04': { junior:'Safeer', senior:'Mahdi' },
  '24/04': { junior:'A.AlTala', senior:'Amjad' },
  '25/04': { junior:'Ahmad', senior:'Hebah' },
  '26/04': { junior:'Zainab', senior:'Riyadh' },
  '27/04': { junior:'Safeer', senior:'Mahdi' },
  '28/04': { junior:'Hawra', senior:'Amjad' },
  '29/04': { junior:'Loay', senior:'AlSafar' },
  '30/04': { junior:'Hidar', senior:'Riyadh' },
};

function resolveSurgeryTemplateName(rawName='', contactMap={}) {
  const clean = (rawName || '').replace(/\./g, '. ').replace(/\s+/g, ' ').trim();
  if (!clean) return { name:'', phone:'', phoneUncertain:true };
  const canonicalKey = canonicalName(clean);
  const normalizedKey = normalizeText(clean).replace(/\./g, ' ').replace(/\s+/g, ' ').trim();
  const hint = SURGERY_NAME_HINTS[canonicalKey] || SURGERY_NAME_HINTS[normalizedKey] || clean;
  const resolved = resolvePhoneFromContactMap(hint, contactMap) || resolvePhoneFromContactMap(clean, contactMap);
  if (resolved && resolved.phone) {
    const knownName = resolved.matchedName || hint;
    return { name: knownName, phone: resolved.phone, phoneUncertain: !!resolved.uncertain };
  }
  // Fallback: "Ahmad.S" → first name + initial of last name → try to find unique match
  // Handles patterns like "Ahmad.S" → "Ahmad AlSafar" (S = first letter of Safar after Al strip)
  const dotInitialMatch = clean.match(/^([A-Za-z]{2,})\.?\s*([A-Z])\.?\s*$/);
  if (dotInitialMatch) {
    const firstName = dotInitialMatch[1].toLowerCase();
    const lastInitial = dotInitialMatch[2].toLowerCase();
    const allContacts = { ...(ROTAS.surgery?.contacts || {}), ...(contactMap?.map || contactMap || {}) };
    const hits = [];
    for (const [cn] of Object.entries(allContacts)) {
      const tokens = canonicalName(cn).split(' ').filter(Boolean);
      if (tokens.length < 2) continue;
      const cFirst = tokens[0];
      const cLast = tokens[tokens.length - 1];
      if (levenshtein(cFirst, firstName) <= 1 && cLast.startsWith(lastInitial)) {
        hits.push(cn);
      }
    }
    if (hits.length === 1) {
      const matchedPhone = resolvePhoneFromContactMap(hits[0], contactMap);
      return { name: hits[0], phone: matchedPhone?.phone || '', phoneUncertain: !matchedPhone?.phone };
    }
  }
  // Fallback: "A.AlTala" → initial + last name
  const initialLastMatch = clean.match(/^([A-Z])\.?\s*([A-Za-z]{3,}.*)$/);
  if (initialLastMatch && !dotInitialMatch) {
    const tryName = `${initialLastMatch[1]}. ${initialLastMatch[2]}`;
    const tryResolved = resolvePhoneFromContactMap(tryName, contactMap);
    if (tryResolved && tryResolved.phone) {
      return { name: tryResolved.matchedName || tryName, phone: tryResolved.phone, phoneUncertain: !!tryResolved.uncertain };
    }
  }
  if (resolved) {
    return { name: resolved.matchedName || hint, phone: resolved.phone || '', phoneUncertain: !!resolved.uncertain };
  }
  return { name: hint, phone:'', phoneUncertain:true };
}

// ═══════════════════════════════════════════════════════════════
// HEMATOLOGY-ONCOLOGY PARSER
// ═══════════════════════════════════════════════════════════════
// PDF row format: "Wed   01 - 04 - 2026   col0…col6"
//   col0 Resident On-Call    16:30–07:30
//   col1 Fellow On-Call      16:30–07:30
//   col2 2nd Rounder         07:30–16:30
//   col3 Consultant On-Call  16:30–07:30
//   col4 ER/Consultation     07:30–16:30
//   col5 Consultation Coverage  } EXCLUDED — inpatient support,
//   col6 Inpatient Coverage     } not ED on-call assignments
//
// Three durable rules (enforced in every function below):
//
//   RULE A — Fuzzy name matching:
//     If a schedule name has no exact hit in the contact table but
//     differs from exactly one candidate by ≤1 character, treat it
//     as certain. "Faisel" → "Faisal" (edit-distance 1, one match).
//     Ambiguity (≥2 candidates within the threshold) → uncertain.
//
//   RULE B — Rank-aware role correction:
//     Every contact-table entry carries the rank section it was found
//     in (Consultant / Associate Consultant / Fellow / Resident).
//     If a person's actual rank is higher than what the column implies,
//     the role label is upgraded to match their rank.
//     "Dr. Omar — ER/Consultation Fellow" → "Dr. Omar — ER/Consultation"
//     "Dr. Wael — Fellow On-Call" → "Dr. Wael — Consultant On-Call"
//     Column position (which duty they cover) is preserved; only the
//     rank qualifier in the label changes.
//
//   RULE C — Full name expansion:
//     When a cell contains a short name ("Wael", "Omar") that matches
//     exactly one entry in the contact table, the entry is stored with
//     the table's canonical full name ("Wael Al Anazi", "Omar Abduljalil").
//     Abbreviated names are never kept when a clear full match exists.
// ═══════════════════════════════════════════════════════════════

// ── Column layout (confirmed from actual PDF extraction) ──────
// ONCALL 1 (Resident) is always empty in this schedule.
// PDF.js skips empty cells, so dataCols[0] is always ONCALL 2 (Fellow).
//
// dataCols[1] is EITHER the 2nd Rounder (when that column has a value)
// OR the Consultant ONCALL 4 (when 2nd Rounder is empty).
// We detect which by looking up dataCols[1]'s rank from the contact map:
//   rank = fellow | associate consultant  →  2nd Rounder present (shift=1)
//   rank = consultant | unknown           →  no 2nd Rounder (no shift)
//
// Without 2nd Rounder (no shift):
//   dataCols[0] = Fellow On-Call (ONCALL 2)
//   dataCols[1] = Consultant On-Call (ONCALL 4)
//   dataCols[2] = ER / Consultation
//   dataCols[3..] = Consultation Coverage, Inpatient A, B  → EXCLUDED
//
// With 2nd Rounder (shift = 1):
//   dataCols[0] = Fellow On-Call (ONCALL 2)
//   dataCols[1] = 2nd Rounder
//   dataCols[2] = Consultant On-Call (ONCALL 4)
//   dataCols[3] = ER / Consultation
//   dataCols[4..] = Consultation Coverage, Inpatient A, B  → EXCLUDED
//
// Consultation Coverage and Inpatient Coverage are NEVER included —
// they are inpatient/administrative assignments, not ED on-call duties.
//
// (The static HEMATOLOGY_ROLES array is kept only for reference.)
const HEMATOLOGY_ROLES = [
  { role:'Fellow On-Call',      impliedRank:'fellow',     startTime:'16:30', endTime:'07:30', shiftType:'on-call' },
  { role:'2nd Rounder',         impliedRank:'fellow',     startTime:'07:30', endTime:'16:30', shiftType:'day'     },
  { role:'Consultant On-Call',  impliedRank:'consultant', startTime:'16:30', endTime:'07:30', shiftType:'on-call' },
  { role:'ER / Consultation',   impliedRank:'fellow',     startTime:'07:30', endTime:'16:30', shiftType:'day'     },
];

// Rank ordering — higher number = more senior
const HEMA_RANK_ORDER = { resident: 0, fellow: 1, 'associate consultant': 2, consultant: 3 };

// Section headers in the PDF contact table that introduce each rank group
const HEMA_RANK_HEADERS = [
  { re: /^CONSULTANT\s*$/i,                      rank: 'consultant'            },
  { re: /^ASSOCIATE\s*CONSULTANT\s*$/i,           rank: 'associate consultant'  },
  { re: /^FELLOW\s*$/i,                           rank: 'fellow'                },
  { re: /^RESIDENT(?:\s+Duration)?\s*$/i,         rank: 'resident'              },
];

// ── RULE B: Rank-aware role label ────────────────────────────
// Returns the corrected role string when the person's actual rank
// outranks what the column implies. Column *function* is preserved;
// only the rank qualifier in the label is upgraded.
function hemaCorrectRole(columnRole, impliedRank, personRank) {
  const personLevel  = HEMA_RANK_ORDER[personRank]  ?? 1;
  const impliedLevel = HEMA_RANK_ORDER[impliedRank] ?? 1;
  if (personLevel <= impliedLevel) return columnRole; // no upgrade needed

  // Person outranks the slot → re-label with their actual rank
  if (personRank === 'consultant' || personRank === 'associate consultant') {
    const tag = personRank === 'consultant' ? 'Consultant' : 'Assoc. Consultant';
    if (columnRole === 'Fellow On-Call')   return 'Consultant On-Call';
    if (columnRole === '2nd Rounder')      return `2nd Rounder (${tag})`;
    // For ER/Consultation and others: strip "Fellow" qualifier if present, append rank
    return columnRole.replace(/\s*Fellow\s*/gi, ' ').trim() + ` (${tag})`;
  }
  return columnRole;
}

// ── RULE A: Edit-distance helper (short strings) ─────────────
function hemaEditDist(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let row = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    let prev = i;
    for (let j = 1; j <= n; j++) {
      const cur = Math.min(
        prev + 1,
        row[j] + 1,
        row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
      row[j - 1] = prev;
      prev = cur;
    }
    row[n] = prev;
  }
  return row[n];
}

// ── Contact map builder ───────────────────────────────────────
/**
 * Parses the PDF contact table and returns a lookup structure.
 *
 * Each entry carries: { phone, rank, canonicalName }
 *   - phone        : "0569713810"  (spaced dashes normalized out)
 *   - rank         : "consultant" | "associate consultant" | "fellow" | "resident"
 *   - canonicalName: full name exactly as in the table, e.g. "Wael Al Anazi"
 *                    (no Dr. prefix, no role/title parentheticals)
 *
 * Two-filter design:
 *   nameParts  (≥2 chars) — used to build canonicalName and byFull key.
 *              Includes short particles like "Al" so canonical names are complete.
 *   indexParts (≥3 chars) — used for byPart lookup index only.
 *              Excludes "Al", "Al-" etc. which are too short and ambiguous to
 *              index safely as standalone tokens.
 *
 * Indexes:
 *   byFull["wael al anazi"] → entry   (full bare-name key, all tokens)
 *   byPart["wael"]          → [entry] (individual long tokens, ≥3 chars)
 *
 * Global name-normalization rule (RULE C):
 *   When resolveHematologyEntry() finds a match via any path, it returns the
 *   entry's canonicalName. buildHematologyEntries() then stores that full name
 *   as displayName, replacing any abbreviated or shortened schedule name.
 *   This ensures "Wael" → "Wael Al Anazi", "Enas" → "Enas Mutahar", etc.
 *   No replacement is made when there is no confident single match.
 *
 * Phone format handled: "056 - 971 - 3810" (spaced dashes)
 */
function buildHematologyContactMap(text) {
  const byFull = {};
  const byPart = {};

  const phoneBlockRe = /\b(0\d{2}\s*-\s*\d{3}\s*-\s*\d{4})\b/;
  const lines = String(text || '').split(/\n/).map(l => l.trim()).filter(Boolean);
  let currentRank = 'fellow'; // default until first rank header seen

  for (const line of lines) {
    // Track rank section
    const rankHit = HEMA_RANK_HEADERS.find(h => h.re.test(line));
    if (rankHit) { currentRank = rankHit.rank; continue; }

    const phoneBlock = line.match(phoneBlockRe);
    if (!phoneBlock) continue;
    const phone = phoneBlock[1].replace(/[\s-]/g, '');

    const beforePhone = line.slice(0, line.indexOf(phoneBlock[0])).trim();
    const nameStr = beforePhone
      .replace(/Dr\.?\s*/gi, '')
      .replace(/\([^)]*\)/g, '') // remove "(Chair)", "(D. Chair)", etc.
      .trim();

    // nameParts: all tokens ≥2 chars → used for canonical name and byFull key
    const nameParts  = nameStr.split(/\s+/).filter(p => p.length >= 2 && !/^[,.\-]$/.test(p));
    // indexParts: only tokens ≥3 chars → used for byPart index (avoids "Al", etc.)
    const indexParts = nameParts.filter(p => p.length >= 3);
    if (!nameParts.length) continue;

    // Canonical name: title-case all parts including short particles ("Al", "Al-")
    const canonicalName = nameParts.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
    const fullKey = nameParts.map(p => p.toLowerCase()).join(' ');
    const entry = { phone, rank: currentRank, canonicalName };

    byFull[fullKey] = entry;
    // Index only the longer tokens (indexParts ≥3 chars) to avoid false matches
    // on short Arabic particles like "Al" that appear in nearly every name.
    for (const part of indexParts) {
      const k = part.toLowerCase();
      if (!byPart[k]) byPart[k] = [];
      if (!byPart[k].some(e => e.phone === phone)) byPart[k].push(entry);
    }
  }
  return { byFull, byPart };
}

// ── Phone + rank resolver ─────────────────────────────────────
/**
 * Resolves a short or full name from a schedule cell to
 * { phone, uncertain, rank, canonicalName }.
 *
 * RULE A (fuzzy): edit distance ≤1 against byPart keys, exactly one
 *   candidate → treat as certain (not "?"). Ambiguous ≥2 → uncertain.
 *
 * RULE C (expansion): returns canonicalName from the contact table so
 *   callers can store the full name rather than the abbreviation.
 *
 * Returns null when the name cannot be resolved at all.
 */
function resolveHematologyEntry(rawName, contactMap, rotasContacts) {
  if (!rawName || rawName === '.') return null;
  const bare = rawName.replace(/^Dr\.?\s*/i, '').trim();
  const _dbg = /almahroos/i.test(bare);

  // 1. ROTAS alias / exact match — phone from ROTAS, canonical name from PDF map
  for (const k of [rawName, `Dr. ${bare}`, bare]) {
    if (rotasContacts[k]) {
      const phone = rotasContacts[k];
      // Enrich with canonical name + rank from PDF contact map (RULE C)
      const fullKey = bare.split(/\s+/).filter(p => p.length >= 2).join(' ').toLowerCase();
      if (contactMap.byFull[fullKey]) {
        const e = contactMap.byFull[fullKey];
        return { phone, uncertain: false, rank: e.rank, canonicalName: e.canonicalName };
      }
      const parts3 = bare.split(/\s+/).filter(p => p.length >= 3);
      for (const part of parts3) {
        const cands = contactMap.byPart[part.toLowerCase()];
        if (cands && cands.length === 1) {
          return { phone, uncertain: false, rank: cands[0].rank, canonicalName: cands[0].canonicalName };
        }
      }
      // PDF map had no confident match — return ROTAS phone with original name
      return { phone, uncertain: false, rank: null, canonicalName: bare };
    }
  }

  // 2. PDF contact map — full bare-name exact match
  // Key uses all tokens ≥2 chars (same filter as buildHematologyContactMap).
  const fullKey = bare.split(/\s+/).filter(p => p.length >= 2).join(' ').toLowerCase();
  if (_dbg) console.warn('[HEMA resolve]', bare, '→ fullKey:', fullKey, 'byFull hit:', !!contactMap.byFull[fullKey]);
  if (contactMap.byFull[fullKey]) {
    const e = contactMap.byFull[fullKey];
    return { phone: e.phone, uncertain: false, rank: e.rank, canonicalName: e.canonicalName };
  }

  // 3 & 4. Per-token lookup (exact, then fuzzy).
  // Only tokens ≥3 chars are searched (byPart does not index shorter tokens).
  const parts = bare.split(/\s+/).filter(p => p.length >= 3);
  if (_dbg) console.warn('[HEMA resolve]', bare, '→ parts:', parts, 'byPart keys available:', Object.keys(contactMap.byPart));
  for (const part of parts) {
    const pLow = part.toLowerCase();

    // 3. Exact token match
    const exactCands = contactMap.byPart[pLow];
    if (exactCands) {
      if (exactCands.length === 1) {
        const e = exactCands[0];
        return { phone: e.phone, uncertain: false, rank: e.rank, canonicalName: e.canonicalName };
      }
      // Multiple exact matches → uncertain but still usable
      return { phone: exactCands[0].phone, uncertain: true, rank: exactCands[0].rank, canonicalName: exactCands[0].canonicalName };
    }

    // 4. RULE A — fuzzy token match
    // Threshold scales with name length to handle transpositions in long Arabic
    // names (e.g. "Alsuwakiet" ↔ "Alsuwaiket", distance=2, length=10).
    // Short names (≤6 chars): threshold 1. Longer names: threshold 2.
    // The fast-reject allows for ±threshold length difference.
    const fuzzyThreshold = pLow.length >= 7 ? 2 : 1;
    const fuzzyHits = [];
    for (const [key, entries] of Object.entries(contactMap.byPart)) {
      if (Math.abs(key.length - pLow.length) > fuzzyThreshold) continue;
      if (hemaEditDist(pLow, key) <= fuzzyThreshold) {
        for (const e of entries) {
          if (!fuzzyHits.some(f => f.phone === e.phone)) fuzzyHits.push(e);
        }
      }
    }
    if (fuzzyHits.length === 1) {
      // Exactly one candidate within 1 edit → treat as certain (clear minor typo)
      const e = fuzzyHits[0];
      return { phone: e.phone, uncertain: false, rank: e.rank, canonicalName: e.canonicalName };
    }
    if (fuzzyHits.length > 1) {
      // Multiple candidates → uncertain
      return { phone: fuzzyHits[0].phone, uncertain: true, rank: fuzzyHits[0].rank, canonicalName: fuzzyHits[0].canonicalName };
    }
  }

  // 5. Fuzzy ROTAS fallback
  const fuzzy = resolvePhone({ contacts: rotasContacts }, { name: rawName, phone: '' });
  if (fuzzy) return { phone: fuzzy.phone, uncertain: fuzzy.uncertain, rank: null, canonicalName: bare };

  return null;
}

// ── Entry builder ─────────────────────────────────────────────
/**
 * Builds schedule entries for one table cell.
 * Applies RULE B (rank correction) and RULE C (name expansion).
 * Handles slash names: "Almahroos/Reem S" → two entries, same role.
 */
function buildHematologyEntries(dateKey, roleMeta, rawCell, contactMap, rotasContacts, deptKey) {
  if (!rawCell || rawCell.trim().length < 2) return [];
  const names = rawCell.split('/').map(n => n.trim()).filter(n => n.length >= 2);
  console.warn('[HEMA cell]', dateKey, roleMeta.role, '→ rawCell:', JSON.stringify(rawCell), '→ names:', names);
  return names.map(rawName => {
    const resolved = resolveHematologyEntry(rawName, contactMap, rotasContacts)
        || { phone: '', uncertain: true, rank: null, canonicalName: rawName };
    console.warn('[HEMA resolved]', rawName, '→', resolved.canonicalName, '| phone:', resolved.phone, '| rank:', resolved.rank);

    // RULE B: upgrade role label if person outranks the column's implied rank
    const correctedRole = resolved.rank
      ? hemaCorrectRole(roleMeta.role, roleMeta.impliedRank, resolved.rank)
      : roleMeta.role;

    // RULE C: use canonical full name from contact table when available
    const displayName = resolved.canonicalName || rawName;

    return {
      specialty: deptKey,
      date: dateKey,
      role: correctedRole,
      name: displayName,
      phone: resolved.phone || '',
      phoneUncertain: !resolved.phone || !!resolved.uncertain,
      startTime: roleMeta.startTime,
      endTime: roleMeta.endTime,
      shiftType: roleMeta.shiftType,
      parsedFromPdf: true,
    };
  });
}

function parseHematologyPdfEntries(text='', deptKey='hematology') {
  const entries = [];
  const rotasContacts = (ROTAS[deptKey] || {}).contacts || {};
  const contactMap = buildHematologyContactMap(text);
  // DEBUG — remove after confirming name normalization works
  console.warn('[HEMA contactMap.byFull keys]', Object.keys(contactMap.byFull));
  console.warn('[HEMA contactMap.byPart keys]', Object.keys(contactMap.byPart));
  console.warn('[HEMA contactMap.byFull full]', JSON.stringify(contactMap.byFull, null, 2));

  const lines = String(text || '').split(/\n/).map(l => l.trim()).filter(Boolean);

  const dayStartRe = /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)/i;
  // Detect month/year from the PDF (any year, not just 2026)
  const { year: hemaDetectedYr } = detectPdfMonthYear(text);
  const hemaYr2 = hemaDetectedYr % 100; // 2-digit year for "01 - 04 - 26" style
  const dateTokRe  = new RegExp(`^(\\d{1,2})\\s*[-\\/]\\s*(\\d{1,2})\\s*[-\\/]\\s*(?:20)?${String(hemaYr2).padStart(2,'0')}$`);

  // Returns true for placeholder/empty cells that should be skipped
  const isPlaceholder = s => {
    const n = (s || '').replace(/\s+/g, ' ').trim();
    return !n || n === '.' ||
      /^2nd\s*on[\s-]*call$/i.test(n) ||
      /^consultant\s*on[\s-]*call$/i.test(n);
  };

  // Build one entry per name in a cell and push to entries[]
  const emit = (dateKey, cell, role, startTime, endTime, shiftType, impliedRank) => {
    if (!cell || isPlaceholder(cell)) return;
    const roleMeta = { role, startTime, endTime, shiftType, impliedRank };
    entries.push(...buildHematologyEntries(dateKey, roleMeta, cell, contactMap, rotasContacts, deptKey));
  };

  for (const line of lines) {
    if (!dayStartRe.test(line)) continue;

    // Split by 2+ spaces or tabs
    let tokens = line.split(/\s{2,}|\t/).map(t => t.trim()).filter(Boolean);

    // Re-merge "2   nd On - Call" fragments (3-space gap inside "2   nd" splits them)
    const merged = [];
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i] === '2' && i + 1 < tokens.length && /^nd\b/i.test(tokens[i + 1])) {
        merged.push('2nd On-Call');
        i++;
      } else {
        merged.push(tokens[i]);
      }
    }
    tokens = merged;

    // tok[0]=DayName  tok[1]=Date  tok[2..]=DataCols
    if (tokens.length < 3) continue;
    const dateMatch = tokens[1].match(dateTokRe);
    if (!dateMatch) continue;

    const day   = parseInt(dateMatch[1], 10);
    const month = parseInt(dateMatch[2], 10);
    if (day < 1 || day > 31 || month < 1 || month > 12) continue;
    const dateKey = `${String(day).padStart(2,'0')}/${String(month).padStart(2,'0')}`;

    const dc = tokens.slice(2); // dataCols

    // ── Detect whether 2nd Rounder is present for this row ────────────
    // ONCALL 1 (Resident) is always empty → PDF.js skips it → dc[0] = Fellow.
    // dc[1] is the 2nd Rounder when its rank is fellow/associate consultant,
    // or the Consultant ONCALL 4 when rank is consultant (or unknown).
    // This probe is the ONLY place where column layout is determined.
    let has2ndRounder = false;
    if (dc.length > 1 && !isPlaceholder(dc[1])) {
      const probe = resolveHematologyEntry(dc[1], contactMap, rotasContacts);
      if (probe && (probe.rank === 'fellow' || probe.rank === 'associate consultant')) {
        has2ndRounder = true;
      }
    }

    // ── Assign roles based on shift ───────────────────────────────────
    // Strict rule: each column maps to exactly one role.
    // Nothing beyond the ER/Consultation column is ever included.
    // Consultation Coverage, Inpatient Coverage A & B are always excluded.
    if (!has2ndRounder) {
      // Layout: dc[0]=Fellow  dc[1]=Consultant  dc[2]=ER  dc[3..]=EXCLUDED
      emit(dateKey, dc[0], 'Fellow On-Call',     '16:30','07:30','on-call','fellow');
      emit(dateKey, dc[1], 'Consultant On-Call', '16:30','07:30','on-call','consultant');
      emit(dateKey, dc[2], 'ER / Consultation',  '07:30','16:30','day',    'fellow');
      // dc[3] = Consultation Coverage  → excluded
      // dc[4] = Inpatient Team A       → excluded
      // dc[5] = Inpatient Team B       → excluded
    } else {
      // Layout: dc[0]=Fellow  dc[1]=2ndRounder  dc[2]=Consultant  dc[3]=ER  dc[4..]=EXCLUDED
      emit(dateKey, dc[0], 'Fellow On-Call',     '16:30','07:30','on-call','fellow');
      emit(dateKey, dc[1], '2nd Rounder',        '07:30','16:30','day',    'fellow');
      emit(dateKey, dc[2], 'Consultant On-Call', '16:30','07:30','on-call','consultant');
      emit(dateKey, dc[3], 'ER / Consultation',  '07:30','16:30','day',    'fellow');
      // dc[4] = Consultation Coverage  → excluded
      // dc[5] = Inpatient Team A       → excluded
      // dc[6] = Inpatient Team B       → excluded
    }
  }

  const deduped = dedupeParsedEntries(entries);
  deduped._templateDetected = deduped.length >= 15;
  deduped._templateName = deduped._templateDetected ? `hematology-${hemaDetectedYr}` : '';
  return deduped;
}

// ═══════════════════════════════════════════════════════════════
// KPTX regression tests (call runKptxRegressionTests() from console)
// Covers: name hints, per-lane dedup, middle-initial uncertainty
// ═══════════════════════════════════════════════════════════════
function runKptxRegressionTests() {
  let passed = 0, failed = 0;
  const ok  = (label) => { passed++; console.log(`  ✅ ${label}`); };
  const err = (label, got, exp) => { failed++; console.error(`  ❌ ${label} — got: ${JSON.stringify(got)}, expected: ${JSON.stringify(exp)}`); };

  console.group('KPTX Regression Tests');

  // ── Test 1: Name hints expand bare names to full display names ──
  const zahra  = normalizeKptxName('Zahra');
  const najeeb = normalizeKptxName('Najeeb');
  const najeeb2 = normalizeKptxName('Najeeb Al Musaied');
  zahra  === 'Dr. Zahra Noor'         ? ok('Zahra → Dr. Zahra Noor')         : err('Zahra expansion', zahra, 'Dr. Zahra Noor');
  najeeb === 'Dr. Najeeb Al Musaied'  ? ok('Najeeb → Dr. Najeeb Al Musaied') : err('Najeeb bare expansion', najeeb, 'Dr. Najeeb Al Musaied');
  najeeb2 === 'Dr. Najeeb Al Musaied' ? ok('Najeeb Al Musaied → full name')  : err('Najeeb full expansion', najeeb2, 'Dr. Najeeb Al Musaied');

  // ── Test 2: Middle initial does not make a name uncertain ──────
  // isNameUncertain is defined in core/phone-resolver.js (globally available)
  if (typeof isNameUncertain === 'function') {
    const khalidUncertain = isNameUncertain('Dr. Khalid B. Akkari');
    !khalidUncertain ? ok('Dr. Khalid B. Akkari — no false "?"') : err('Middle initial uncertainty', khalidUncertain, false);
    const najeebUncertain = isNameUncertain('Dr. Najeeb Al Musaied');
    !najeebUncertain ? ok('Dr. Najeeb Al Musaied — not uncertain') : err('Najeeb uncertainty', najeebUncertain, false);
  } else {
    console.warn('  ⚠️  isNameUncertain not in scope — skipping test 2');
  }

  // ── Test 3: Per-lane dedup — same name allowed in 1st AND 2nd ──
  // Simulate the dedup logic used in parseKptxPdfEntries step 5
  {
    const names1st = ['Ali Al Harbi', 'Baher'];
    const names2nd = ['Baher'];
    const usedInConsultant = new Set();
    const usedIn1st = new Set();
    const kept1st = [], kept2nd = [];
    names1st.forEach(n => {
      const k = n.toLowerCase().replace(/\s+/g,'');
      if (!usedInConsultant.has(k) && !usedIn1st.has(k)) { usedIn1st.add(k); kept1st.push(n); }
    });
    const usedIn2nd = new Set();
    names2nd.forEach(n => {
      const k = n.toLowerCase().replace(/\s+/g,'');
      if (!usedInConsultant.has(k) && !usedIn2nd.has(k)) { usedIn2nd.add(k); kept2nd.push(n); }
    });
    kept1st.length === 2 ? ok('1st On-Call keeps both "Ali Al Harbi" and "Baher"') : err('1st lane count', kept1st.length, 2);
    kept2nd.length === 1 ? ok('2nd On-Call keeps "Baher" despite overlap with 1st') : err('2nd lane count', kept2nd.length, 1);
  }

  console.log(`\n  ${passed} passed, ${failed} failed`);
  console.groupEnd();
  return { passed, failed };
}

