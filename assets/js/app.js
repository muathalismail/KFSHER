// ═══════════════════════════════════════════════════════════════
// SHIFT / DATE / CLOCK LOGIC → now in core/time.js
// All time functions (getScheduleDate, fmtKey, getShiftLabel,
// isWorkHours, activeShiftMode, isWeekend, timeRangeActive,
// SPECIALTY_SCHEDULE_RULES, tick, etc.) are defined in
// assets/js/core/time.js which is loaded before this file.
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// HELPERS → now in core/phone-resolver.js
// Functions: initials, levenshtein, canonicalName, splitPossibleNames,
// scoreNameMatch, resolvePhone, parseRoleMeta, isNameUncertain
// ═══════════════════════════════════════════════════════════════

function normalizePdfEntryModel(deptKey, dept, entry, dateKey) {
  const ph = resolvePhone(dept, entry);
  const meta = parseRoleMeta(entry.role || '');
  const review = {
    specialty: false,
    doctorName: isNameUncertain(entry.name || ''),
    phone: !ph || ph.uncertain,
  };
  return {
    specialty: deptKey,
    specialtyUncertain: false,
    doctorName: entry.name || '',
    doctorNameUncertain: review.doctorName,
    phone: ph ? ph.phone : '',
    phoneUncertain: ph ? ph.uncertain : false,
    role: entry.role || '',
    shiftType: meta.shiftType,
    startTime: entry.startTime || meta.startTime,
    endTime: entry.endTime || meta.endTime,
    date: dateKey,
    section: entry.section || entry.coverage || '',
    review,
  };
}

function buildUploadedPdfDataModel(deptKey, review={}) {
  const dept = ROTAS[deptKey];
  if (!dept) return [];
  const withSpecialtyReview = entry => ({
    ...entry,
    specialtyUncertain: !!review.specialty,
    review: { ...(entry.review || {}), specialty: !!review.specialty },
  });
  if (deptKey === 'radiology_duty') {
    const sampleDate = new Date();
    return getDutyRadiologyEntries(sampleDate).map(entry => withSpecialtyReview(normalizePdfEntryModel(deptKey, dept, entry, 'dynamic-weekday')));
  }
  return Object.entries(dept.schedule || {}).flatMap(([dateKey, entries]) =>
    (entries || []).map(entry => withSpecialtyReview(normalizePdfEntryModel(deptKey, dept, entry, dateKey)))
  );
}

function buildKnownParsedFallbackEntries(deptKey, review={}) {
  const toEntry = entry => ({
    specialty: entry.specialty || deptKey,
    date: entry.date,
    role: entry.role || '',
    name: entry.name || entry.doctorName || '',
    phone: entry.phone || '',
    phoneUncertain: !!entry.phoneUncertain,
    section: entry.section || specialtyLabelForKey(entry.specialty || deptKey),
    coverageType: entry.coverageType || entry.shiftType,
    startTime: entry.startTime || '',
    endTime: entry.endTime || '',
    review: { ...(entry.review || {}), parsingFallback: true },
    parsedFromPdf: false,
    extractedFallback: true,
  });
  if (deptKey === 'medicine') {
    return MEDICINE_SUBSPECIALTY_KEYS.flatMap(key => buildUploadedPdfDataModel(key, { ...review, parsingFallback: true }).map(toEntry));
  }
  if (isMedicineSubspecialty(deptKey)) return buildUploadedPdfDataModel(deptKey, { ...review, parsingFallback: true }).map(toEntry);
  if (ROTAS[deptKey]) return buildUploadedPdfDataModel(deptKey, { ...review, parsingFallback: true }).map(toEntry);
  return [];
}

// ═══════════════════════════════════════════════════════════════
// DATA
// Each dept: { label, icon, keywords[], contacts{}, schedule{ "DD/MM": [{role,name,phone?,hours?,section?}] } }
// For Radiology: schedule entries have onDutyOnly / onCallOnly flags handled by isWorkingHours
// ═══════════════════════════════════════════════════════════════
// Time functions (isWorkHours, activeShiftMode, timeRangeActive, isWeekend,
// SPECIALTY_SCHEDULE_RULES, isSpecialtyActiveNow, getSpecialtyCurrentShiftMeta,
// runSpecialtyScheduleRuleTests) are now in core/time.js
// ═══════════════════════════════════════════════════════════════

// Entry classification functions (roleText, isNoteEntry, isExplicitDayEntry,
// isExplicitOnCallEntry, isNoCoverageEntry, isLikelyClinicalRole,
// isEntryActive, filterActiveEntries) are now in core/entry-model.js

// MEDICINE_SUBSPECIALTY_KEYS, isMedicineSubspecialty → now in core/entry-model.js

// AUTO_PUBLISH_SPECIALTIES, REVIEW_ONLY_SPECIALTIES → moved to upload/pipeline.js

// UPLOAD_TRUST_PROFILES, UPLOAD_REASON_CODES → moved to upload/pipeline.js

// SPECIALTY_PIPELINE_RULES → moved to upload/pipeline.js

// uploadedPdfRecords → now in store/memory-cache.js (loaded as global)
let uploadedSpecialtiesReadyPromise = Promise.resolve();
let radiologyDutyTrace = { lastSearch: null, lastPdf: null };

// uploadModeForSpecialty, isTrustedAutoPublishSpecialty, hasTrustedUploadParser,
// countUsableParsedEntries, summarizeUploadPreviewRows, formatUploadPreviewRows,
// getUploadIssueTypes → moved to upload/pipeline.js

// getParserTrustProfile, getMedicineOnCallRoleCoverage,
// resolveMedicineOnCallActiveRowsFromNormalized, isMedicineOnCallCurrentResolutionUsable,
// summarizeNormalizedDateRange, normalizedCoverageType, buildNormalizedUploadPayload,
// normalizedRolesToEntries, findRequiredRoleCoverage, mapValidationReasonCodes,
// buildUploadPipelineDiagnostics, reasonCodeExplanation, decideUploadPublication,
// runUploadPolicyChecks → moved to upload/pipeline.js

function medicineCoverageType(entry={}) {
  const r = roleText(entry);
  if (r.includes('on-call') || r.includes('oncall') || r.includes('after') || r.includes('24h')) return 'on-call';
  if (r.includes('inpatient')) return 'inpatient coverage';
  if (r.includes('day') || r.includes('fellow') || r.includes('resident')) return 'on-duty';
  if (r.includes('er/consult') || r.includes('consult')) return 'consult coverage';
  return 'on-duty';
}

function withMedicineMeta(entries=[], deptKey) {
  return entries.map(entry => ({
    ...entry,
    coverageType: medicineCoverageType(entry),
    section: ROTAS[deptKey] ? ROTAS[deptKey].label : deptKey,
  }));
}

function isMedicineOnCallDay(now) {
  const mins = now.getHours() * 60 + now.getMinutes();
  return mins >= 7 * 60 + 30 && mins < 21 * 60;
}

const MEDICINE_ON_CALL_DISPLAY_CONTACT_OVERRIDES = {
  mabdulatif: { name:'Dr. Mohammed Alabdulatif', phone:'0591536669' },
  mohammedalabdulatif: { name:'Dr. Mohammed Alabdulatif', phone:'0591536669' },
  lamaalshehri: { name:'Dr. Lama Almubarak', phone:'0565109002' },
  lamaalkunaizi: { name:'Dr. Lama Almubarak', phone:'0565109002' },
  drlamaalshehri: { name:'Dr. Lama Almubarak', phone:'0565109002' },
  drlamaalkunaizi: { name:'Dr. Lama Almubarak', phone:'0565109002' },
};

function isMedicineOnCallErEntry(entry={}) {
  const role = normalizeText(entry.role || '');
  const section = normalizeText(entry.section || '');
  return role.includes('junior er')
    || role.includes('senior er')
    || section === 'junior er'
    || section === 'senior';
}

function stabilizeMedicineOnCallErEntry(entry={}) {
  const next = { ...entry };
  const aliasKey = compactMedicineAlias(next.name || '');
  const override = MEDICINE_ON_CALL_DISPLAY_CONTACT_OVERRIDES[aliasKey] || null;
  if (override) {
    next.name = override.name;
    next.phone = override.phone;
    next.phoneUncertain = false;
  }
  const role = normalizeText(next.role || '');
  const section = normalizeText(next.section || '');
  if (role.includes('senior er') || section === 'senior') {
    next.role = 'Senior ER';
    next.section = 'Senior';
  } else if (role.includes('junior er') || section === 'junior er') {
    next.role = 'Junior ER';
    next.section = 'Junior ER';
  }
  if (!next.phone || next.phoneUncertain) {
    // Try ROTAS contacts exact match first (avoids fuzzy matching picking wrong person)
    const _dept = ROTAS.medicine_on_call || { contacts:{} };
    const _rotasPhone = _dept.contacts?.[next.name];
    if (_rotasPhone) {
      next.phone = _rotasPhone;
      next.phoneUncertain = false;
    } else {
      // Suppress server contacts to prevent cross-specialty contamination
      const _savedSc = window._serverExtractedContacts;
      delete window._serverExtractedContacts;
      const resolved = resolvePhone(_dept, next);
      if (_savedSc) window._serverExtractedContacts = _savedSc;
      if (resolved?.phone) {
        next.phone = resolved.phone;
        next.phoneUncertain = !!resolved.uncertain;
      }
    }
  }
  return next;
}

function getMedicineOnCallDisplayEntries(entries=[], now=new Date()) {
  const rows = (entries || []).map(entry => ({ ...entry }));
  if (!rows.length) return [];
  const shiftType = isMedicineOnCallDay(now) ? 'day' : 'night';
  const active = rows.filter(entry => entry.shiftType === shiftType);
  if (!active.length) return [];
  const erOnly = active.filter(isMedicineOnCallErEntry).map(stabilizeMedicineOnCallErEntry);
  const roleOrder = entry => normalizeText(entry.role || '').includes('junior er') ? 0 : 1;
  return erOnly.sort((a, b) => roleOrder(a) - roleOrder(b) || (a.name || '').localeCompare(b.name || ''));
}

function getMedicineOnCallEntries(schedKey, now, qLow='') {
  const dept = ROTAS.medicine_on_call;
  if (!dept) return [];
  const entries = (dept.schedule[schedKey] || []).map(entry => ({ ...entry }));
  if (!entries.length) return [];
  return getMedicineOnCallDisplayEntries(entries, now);
}

function getSurgeryEntries(schedKey, now) {
  const dept = ROTAS.surgery;
  if (!dept) return [];
  const entries = (dept.schedule[schedKey] || []).map(entry => ({ ...entry }));
  if (!entries.length) return [];
  const hasStructuredOnCallTeam = entries.some(entry => /junior (resident|er)|senior (resident|er)|associate on-call|consultant on-call/i.test(entry.role || ''));
  if (hasStructuredOnCallTeam) return entries;
  return filterActiveEntriesV2(entries, now, 'surgery');
}

function getNeurologyEntriesFromRows(rows=[], now) {
  if (!now) now = new Date();
  const allEntries = (rows || []).map(entry => ({ ...entry }));
  if (!allEntries.length) return [];
  if (allEntries.some(isNoCoverageEntry)) return allEntries.filter(isNoCoverageEntry);

  // Filter to entries active NOW (by shift window)
  const active = allEntries.filter(entry => isEntryActive(entry, now));
  const entries = active.length ? active : allEntries;

  const roleMatches = pattern => entries.filter(entry => pattern.test((entry.role || '').toLowerCase()));
  const first = roleMatches(/junior resident|1st on-call resident|^resident$|resident on-call/);
  const second = roleMatches(/senior resident|2nd on-call senior resident|2nd on-call/);
  const associate = roleMatches(/associate consultant on-call/);
  const consultant = roleMatches(/consultant on-call/).filter(entry => !/stroke/i.test(entry.role || '') && !/associate/i.test(entry.role || ''));

  const selected = [];
  first.forEach(e => selected.push(e));
  second.forEach(e => selected.push(e));
  if (associate.length) associate.forEach(e => selected.push(e));
  if (consultant.length) consultant.forEach(e => selected.push(e));

  return selected.length ? selected : filterActiveEntriesV2(entries, now, 'neurology');
}

function getPicuEntriesFromRows(rows=[]) {
  const entries = (rows || []).map(entry => ({ ...entry }));
  if (!entries.length) return [];
  if (entries.some(isNoCoverageEntry)) return entries.filter(isNoCoverageEntry);

  const pick = field =>
    entries.filter(entry => normalizeText(entry.picuField || '') === normalizeText(field));

  const ordered = [
    ...pick('day_resident'),
    ...pick('day_assistant_1'),
    ...pick('day_assistant_2'),
    ...pick('resident_24h'),
    ...pick('after_hours_doctor'),
    ...pick('consultant_24h'),
  ];

  return ordered.length ? ordered : entries;
}

function resolvePicuActiveEntries(entries=[], now=new Date()) {
  if (!entries.length) return [];
  const mins = now.getHours() * 60 + now.getMinutes();
  const isDayWindow = mins >= 7 * 60 + 30 && mins < 15 * 60 + 30;
  const activeFields = isDayWindow
    ? new Set(['day_resident', 'day_assistant_1', 'day_assistant_2', 'resident_24h', 'consultant_24h'].map(normalizeText))
    : new Set(['resident_24h', 'after_hours_doctor', 'consultant_24h'].map(normalizeText));
  const active = entries.filter(entry => activeFields.has(normalizeText(entry.picuField || '')));
  return stabilizePicuDisplayEntries(dedupePicuDisplayEntries(active.length ? active : entries));
}

function stabilizePicuDisplayEntries(entries=[]) {
  return (entries || []).map(entry => {
    if (normalizeText(entry.specialty || '') !== 'picu') return entry;
    const next = { ...entry };
    const hasDirectPhone = !!cleanPhone(next.phone || '');
    next.doctorNameUncertain = false;
    if (hasDirectPhone) next.phoneUncertain = false;
    next.review = { ...(next.review || {}), doctorName: false, phone: !!next.phoneUncertain };
    next._confidence = next._confidence || 'high';
    return next;
  });
}

function dedupePicuDisplayEntries(entries=[]) {
  const seen = new Set();
  return entries.filter(entry => {
    const key = [
      canonicalName(entry.name || ''),
      normalizeText(entry.role || ''),
      entry.startTime || '',
      entry.endTime || '',
      normalizeText(entry.picuField || ''),
    ].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getMedicineEntries(deptKey, schedKey, now) {
  const dept = ROTAS[deptKey];
  if (!dept) return [];
  const entries = withMedicineMeta(dept.schedule[schedKey] || [], deptKey);
  if (!entries.length) return [];
  if (entries.some(isNoCoverageEntry)) return entries.filter(isNoCoverageEntry);
  const active = isWorkHours(now)
    ? entries.filter(entry => entry.coverageType !== 'on-call')
    : entries.filter(entry => entry.coverageType === 'on-call');
  if (active.length) return active;
  return entries.filter(entry => roleText(entry).includes('24h'));
}

function getPediatricsEntries(schedKey, now) {
  const dept = ROTAS.pediatrics;
  if (!dept) return [];
  const entries = (dept.schedule[schedKey] || []).map(entry => ({ ...entry }));
  if (!entries.length) return [];
  if (entries.some(isNoCoverageEntry)) return entries.filter(isNoCoverageEntry);

  const mins = now.getHours() * 60 + now.getMinutes();
  // Ward-E only (7:30-16:30, no ER) is excluded from display per spec
  const isWardEOnly = entry => /ward.e/i.test(entry.role || '') && !/and\s*er/i.test(entry.role || '');

  const first        = entries.find(entry => /1st on.call/i.test(entry.role || ''));
  const second       = entries.find(entry => /2nd on.call/i.test(entry.role || ''));
  const third        = entries.find(entry => /3rd on.call/i.test(entry.role || ''));
  const kfshEr       = entries.find(entry => /kfsh er/i.test(entry.role || ''));
  const nightHosting = entries.find(entry => /ward.e and er/i.test(entry.role || ''));
  const legacyHosp   = entries.find(entry => /hospitalist er/i.test(entry.role || '') && !/ward/i.test(entry.role || ''));

  // Determine which KFSH-ER / night-hosting slot is active now
  const isDayShift   = mins >= 7 * 60 + 30 && mins < 16 * 60 + 30;   // 07:30–16:30
  const isFirstShift = mins >= 15 * 60 + 30 || mins < 7 * 60 + 30;   // 15:30–07:30
  const isNightHost  = mins >= 16 * 60 + 30 || mins < 7 * 60 + 30;   // 16:30–07:30

  const selected = [];

  // 1st On-Call (3:30 PM – 7:30 AM) — show when their shift is active
  if (isFirstShift && first) {
    selected.push({ ...first, role:'1st On-Call', startTime:'15:30', endTime:'07:30', shiftType:'on-call' });
  }
  // 2nd On-Call (24h) — always show
  if (second) {
    selected.push({ ...second, role:'2nd On-Call', startTime:'07:30', endTime:'07:30', shiftType:'24h' });
  }
  // 3rd On-Call (24h) — show if different from 1st
  const firstName = selected[0]?.name || '';
  if (third && canonicalName(third.name || '') !== canonicalName(firstName)) {
    selected.push({ ...third, role:'3rd On-Call', startTime:'07:30', endTime:'07:30', shiftType:'24h' });
  }
  // KFSH ER Hospitalist (7:30 AM – 4:30 PM) — day shift only
  const kfshErSource = kfshEr || legacyHosp;
  if (isDayShift && kfshErSource) {
    selected.push({ ...kfshErSource, role:'KFSH ER Hospitalist', section:'KFSH ER', startTime:'07:30', endTime:'16:30', shiftType:'day' });
  }
  // Hospitalist Ward-E and ER (4:30 PM – 7:30 AM) — night only
  if (isNightHost && nightHosting) {
    selected.push({ ...nightHosting, role:'Hospitalist Ward-E and ER', section:'Ward-E / ER', startTime:'16:30', endTime:'07:30', shiftType:'night' });
  }

  if (selected.length) return selected;
  // Fallback: return all on-call rows except excluded Ward-E
  const onCallRows = entries.filter(entry => !isWardEOnly(entry) && (
    /1st on.call/i.test(entry.role || '')
    || /2nd on.call/i.test(entry.role || '')
    || /3rd on.call/i.test(entry.role || '')
    || /hospitalist er/i.test(entry.role || '')
    || /kfsh er/i.test(entry.role || '')
    || /ward.e and er/i.test(entry.role || '')
    || /consultant on.call/i.test(entry.role || '')
  ));
  if (onCallRows.length) return onCallRows;

  return filterActiveEntriesV2(entries, now, 'pediatrics');
}

function getPicuEntries(schedKey, now) {
  const dept = ROTAS.picu;
  if (!dept) return [];
  const entries = getPicuEntriesFromRows((dept.schedule[schedKey] || []).map(entry => ({ ...entry })));
  if (!entries.length) return [];
  return resolvePicuActiveEntries(entries, now);
}

function getOrthopedicsEntries(schedKey, now) {
  const dept = ROTAS.orthopedics;
  if (!dept) return [];
  const entries = (dept.schedule[schedKey] || []).map(entry => ({
    ...entry,
    shiftType: '24h',
    startTime: '07:30',
    endTime: '07:30',
  }));
  if (!entries.length) return [];
  if (entries.some(isNoCoverageEntry)) return entries.filter(isNoCoverageEntry);
  return entries;
}

function getKptxEntries(schedKey, now) {
  const dept = ROTAS.kptx;
  if (!dept) return [];
  const entries = (dept.schedule[schedKey] || []).map(entry => {
    const resolved = resolvePhone(dept, entry);
    return resolved?.phone
      ? { ...entry, phone: entry.phone || resolved.phone, phoneUncertain: !!(resolved.uncertain && !entry.phone) }
      : { ...entry };
  });
  return getKptxEntriesFromRows(entries, now);
}

function getKptxEntriesFromRows(rows=[], now=new Date()) {
  const dept = ROTAS.kptx;
  const entries = (rows || []).map(entry => {
    const resolved = resolvePhone(dept, entry);
    return resolved?.phone
      ? { ...entry, phone: entry.phone || resolved.phone, phoneUncertain: !!(resolved.uncertain && !entry.phone) }
      : { ...entry };
  });
  if (!entries.length) return [];
  if (entries.some(isNoCoverageEntry)) return entries.filter(isNoCoverageEntry);
  const isDay = isWorkHours(now);
  const active = entries.filter(entry => {
    const role = normalizeText(entry.role || '');
    // normalizeText strips hyphens → 'on-call' becomes 'on call'
    // Consultant On-Call is always shown (24h coverage)
    if (role.includes('consultant on call')) return true;
    // 1st/2nd On-Call are always shown so users know who to reach
    // (shift time is shown on the card — 16:30-07:30 — for context)
    if (role.includes('1st on call') || role.includes('2nd on call')) return true;
    if (isDay) {
      return role.includes('day coverage')
        || role.includes('weekend coverage')
        || role.includes('inpatient')
        || role.includes('consult');
    }
    return role.includes('after hours')
      || role.includes('on call')
      || role.includes('weekend coverage');
  });
  return active.length ? active : entries;
}

function getNeurosurgeryEntries(schedKey, now) {
  const dept = ROTAS.neurosurgery;
  if (!dept) return [];
  const entries = (dept.schedule[schedKey] || []).map(entry => ({ ...entry }));
  if (!entries.length) return [];

  // Filter to active entries by shift window first
  const active = entries.filter(entry => isEntryActive(entry, now));
  const pool = active.length ? active : entries;

  const selected = [];
  // Residents (day or night — isEntryActive already filtered by shift)
  const residents = pool.filter(entry => /resident on-duty/i.test(entry.role || ''));
  residents.forEach(r => selected.push(r));
  // Fellow / 2nd On-Duty (24h)
  const secondOnDuty = pool.find(entry => /2nd on-duty|fellow/i.test(entry.role || ''));
  if (secondOnDuty) selected.push(secondOnDuty);
  // Associate Consultant (24h)
  const associate = pool.find(entry => /associate consultant/i.test(entry.role || ''));
  if (associate) selected.push(associate);
  // Neurosurgeon Consultant (24h)
  const consultant = pool.find(entry => /neurosurgeon consultant|consultant on-call/i.test(entry.role || '') && !/associate/i.test(entry.role || ''));
  if (consultant) selected.push(consultant);
  return selected.length ? selected : pool;
}

function getMedicineOnCallSeniorForShift(schedKey, shiftType='night') {
  const dept = ROTAS.medicine_on_call;
  if (!dept) return null;
  const entries = dept.schedule[schedKey] || [];
  return entries.find(entry => {
    const section = normalizeText(entry.section || '');
    const role = normalizeText(entry.role || '');
    return entry.shiftType === shiftType && (section === 'senior' || role.includes('senior'));
  }) || null;
}

function getMedicineOnCallSeniorForTime(schedKey, now=new Date()) {
  const dept = ROTAS.medicine_on_call;
  if (!dept) return null;
  const entries = dept.schedule[schedKey] || [];
  return entries.find(entry => {
    const section = normalizeText(entry.section || '');
    const role = normalizeText(entry.role || '');
    return section === 'senior'
      && isEntryActive(entry, now)
      && (role.includes('senior') || role.includes('er'));
  }) || null;
}

function isLiverResidentAlias(name='') {
  const normalized = normalizeText(name || '');
  return normalized === 'smro'
    || normalized.includes('smro')
    || normalized === 'im resident'
    || normalized === 'im res'
    || normalized === 'im.resident'
    || normalized === 'im.res'
    || normalized === 'resident';
}

function normalizeLiverRowsForDisplay(entries=[], schedKey, now) {
  const isDay = isWorkHours(now);
  const mins = now.getHours() * 60 + now.getMinutes();
  // Consultant On-Call is a 24h role — always visible regardless of shift.
  const isConsultantOnCall = entry => {
    const role = normalizeText(entry.role || '');
    return role.includes('consultant on call') || (role.includes('consultant') && (entry.shiftType === '24h' || role.includes('24h')));
  };
  const shiftEntries = entries.filter(entry => {
    const role = normalizeText(entry.role || '');
    if (isConsultantOnCall(entry)) return true;  // 24h consultant always included
    if (isDay) {
      return role.includes('day coverage') || role.includes('assistant consultant 1st on call');
    }
    return role.includes('after')
      || role.includes('night on call')
      || role.includes('2nd on call')
      || role.includes('3rd on call')
      || role.includes('clinical coordinator');
  });

  // Use isWorkHours so that early-morning times (e.g. 05:00) correctly resolve as night.
  const seniorAtTime = getMedicineOnCallSeniorForTime(schedKey, now)
    || getMedicineOnCallSeniorForShift(schedKey, isWorkHours(now) ? 'day' : 'night');
  const normalized = [];
  const seen = new Set();

  shiftEntries.forEach(entry => {
    // IM.Resident (day) or SMRO (night) → replace with Medicine Senior, label SMROD
    if (isLiverResidentAlias(entry.name || '')) {
      if (isDay) {
        // Day-shift IM Resident → Medicine Senior (day)
        const seniorDay = getMedicineOnCallSeniorForTime(schedKey, now)
          || getMedicineOnCallSeniorForShift(schedKey, 'day');
        if (seniorDay) {
          const key = `${canonicalName(seniorDay.name || '')}|smrod|07:30|16:30`;
          if (!seen.has(key)) {
            seen.add(key);
            normalized.push({ ...entry, name: seniorDay.name, phone: seniorDay.phone || '', phoneUncertain: !seniorDay.phone, role: 'SMROD', startTime: '07:30', endTime: '16:30' });
          }
        }
      } else {
        // Night SMRO → Medicine Senior (night), label SMROD.
        // After 16:30 and before 21:00 the slot starts at 16:30; at/after 21:00 it starts at 21:00.
        // Overnight carry-over (before 07:30) is also part of the 21:00–07:30 window.
        const startTime = (mins >= 16 * 60 + 30 && mins < 21 * 60) ? '16:30' : '21:00';
        if (seniorAtTime) {
          const key = `${canonicalName(seniorAtTime.name || '')}|smrod|${startTime}|07:30`;
          if (!seen.has(key)) {
            seen.add(key);
            normalized.push({ ...entry, name: seniorAtTime.name, phone: seniorAtTime.phone || '', phoneUncertain: !seniorAtTime.phone, role: 'SMROD', startTime, endTime: '07:30' });
          }
        } else {
          // Medicine senior not in schedule — still show the slot with a meaningful label
          const key = `smrod|${startTime}|07:30`;
          if (!seen.has(key)) {
            seen.add(key);
            normalized.push({ ...entry, name: 'Medicine Senior On-Call', phone: '', phoneUncertain: true, role: 'SMROD', startTime, endTime: '07:30' });
          }
        }
      }
      return;
    }

    const names = splitPossibleNames(entry.name || '').filter(name => !isLiverResidentAlias(name));
    if (!names.length) return; // nothing valid after filtering
    if (isDay) {
      if (names.length > 1) {
        names.forEach(name => {
          const key = `${canonicalName(name)}|${normalizeText(entry.role || '')}|${entry.startTime || ''}|${entry.endTime || ''}`;
          if (seen.has(key)) return;
          seen.add(key);
          normalized.push({ ...entry, name });
        });
        return;
      }
      const key = `${canonicalName(entry.name || '')}|${normalizeText(entry.role || '')}|${entry.startTime || ''}|${entry.endTime || ''}`;
      if (!seen.has(key)) {
        seen.add(key);
        normalized.push(entry);
      }
      return;
    }
    const role = normalizeText(entry.role || '');
    if (role.includes('clinical coordinator')) return;
    // Consultant On-Call (24h): bypass all day-overlap and time-window filters
    if (isConsultantOnCall(entry)) {
      names.forEach(name => {
        const key = `${canonicalName(name)}|${role}|${entry.startTime || ''}|${entry.endTime || ''}`;
        if (seen.has(key)) return;
        seen.add(key);
        normalized.push({ ...entry, name });
      });
      return;
    }
    // 2nd on-call window: 21:00–07:30 (crosses midnight).
    // Active if ≥21:00 OR before 07:30 (overnight carry-over).
    if (role.includes('2nd on call') && !(mins >= 21 * 60 || mins < 7 * 60 + 30)) return;
    // Night entries can legitimately have the same doctor as Day Coverage
    // (e.g. a doctor who covers both day and after-duty shifts).
    // Only deduplicate against the SMROD/senior-at-time to avoid showing the same
    // person twice under two different role labels.
    const filteredNames = names.filter(name => {
      if (canonicalName(name) === canonicalName(seniorAtTime?.name || '')) return false;
      return true;
    });
    if (!filteredNames.length) return;
    filteredNames.forEach(name => {
      const key = `${canonicalName(name)}|${normalizeText(entry.role || '')}|${entry.startTime || ''}|${entry.endTime || ''}`;
      if (seen.has(key)) return;
      seen.add(key);
      normalized.push({ ...entry, name, role: role.includes('2nd on call') ? '2nd On-Call' : entry.role });
    });
  });

  const roleRank = row => {
    const role = normalizeText(row.role || '');
    if (role.includes('smrod')) return 0;
    if (role.includes('day coverage') || role.includes('assistant consultant')) return 1;
    if (role.includes('after') || role.includes('night on call') || role.includes('1st on call after')) return 2;
    if (role.includes('2nd on call')) return 3;
    if (role.includes('3rd on call')) return 4;
    if (role.includes('consultant on call') || (role.includes('consultant') && row.shiftType === '24h')) return 5;
    if (role.includes('consultant')) return 6;
    return 7;
  };
  const finalRows = normalized.length ? normalized : shiftEntries;
  return finalRows.sort((a, b) => roleRank(a) - roleRank(b) || (a.role || '').localeCompare(b.role || ''));
}

function getLiverEntries(schedKey, now) {
  const dept = ROTAS.liver;
  if (!dept) return [];
  const entries = (dept.schedule[schedKey] || []).map(entry => ({ ...entry }));
  if (!entries.length) return [];
  if (entries.some(isNoCoverageEntry)) return entries.filter(isNoCoverageEntry);
  return normalizeLiverRowsForDisplay(entries, schedKey, now);
}

function getHematologyEntries(schedKey, now) {
  const dept = ROTAS.hematology;
  if (!dept) return [];
  const entries = (dept.schedule[schedKey] || []).map(entry => ({ ...entry }));
  if (!entries.length) return [];
  if (entries.some(isNoCoverageEntry)) return entries.filter(isNoCoverageEntry);

  const isDay = isWorkHours(now);
  if (!isDay) {
    const selected = [];
    const first = entries.find(entry => /1st on-call/i.test(entry.role || ''));
    const second = entries.find(entry => /fellow on-call/i.test(entry.role || ''));
    const consultant = entries.find(entry => /consultant on-call/i.test(entry.role || ''));
    if (first) selected.push(first);
    if (second) selected.push({ ...second, role:'2nd On-Call' });
    if (consultant) selected.push(consultant);
    return selected.length ? selected : entries;
  }

  const secondRounder = entries.find(entry => /2nd on-call|er\/consult|2nd rounder/i.test(entry.role || ''));
  const consultant = entries.find(entry => /consultation coverage|consultant inpatient|consultant on-call/i.test(entry.role || ''));
  const first = entries.find(entry => /1st on-call resident/i.test(entry.role || ''));
  const fellow = entries.find(entry => /fellow on-call/i.test(entry.role || ''));
  const selected = [];
  if (secondRounder) {
    const firstName = splitPossibleNames(secondRounder.name || '')[0] || secondRounder.name;
    const resolved = resolvePhone(ROTAS.hematology, { name:firstName, phone:secondRounder.phone || '' }) || { name:firstName, phone:secondRounder.phone || '' };
    selected.push({
      ...secondRounder,
      name: resolved.name || firstName,
      phone: resolved.phone || secondRounder.phone || '',
      role: '2nd On-Call',
    });
    if (consultant) selected.push(consultant);
    return selected.length ? selected : entries;
  }
  if (first || fellow || consultant) {
    if (first) selected.push(first);
    if (fellow) selected.push({ ...fellow, role: '2nd On-Call' });
    if (consultant) selected.push(consultant);
  }
  return selected.length ? selected : entries;
}

// PICU, Hospitalist, Medicine parsers → now in parsers/picu.js, parsers/hospitalist.js, parsers/medicine.js
function parseTimeMinutes(value='') {
  const match = String(value || '').match(/(\d{1,2}):(\d{2})/);
  if (!match) return NaN;
  return parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
}

function cloneEntry(entry) {
  return { ...entry };
}

// splitMultiDoctorEntries → moved to parsers/generic.js

function isImagingDeptKey(deptKey='') {
  return deptKey === 'radiology_duty' || deptKey === 'radiology_oncall';
}

function hasUsableUploadEntries(record) {
  return !!(record
    && Array.isArray(record.entries)
    && record.entries.some(entry => {
      const name = (entry?.name || '').trim();
      const role = (entry?.role || '').trim().toLowerCase();
      return !!name || role.includes('no coverage');
    }));
}

function hasHardAuditErrors(record) {
  const issues = Array.isArray(record?.audit?.issues) ? record.audit.issues : [];
  return issues.some(issue => issue && issue.severity === 'error');
}

function getUploadRecordBlockReasons(record) {
  const reasons = [];
  if (!record) return ['missing-record'];
  if (record.isActive === false) reasons.push('inactive');
  if (!record.parsedActive) reasons.push('parsed-inactive');
  if (!hasUsableUploadEntries(record)) reasons.push('no-usable-entries');
  if (record.review?.parsing) reasons.push('review-parsing');
  if (record.review?.auditRejected) reasons.push('review-audit-rejected');
  const livePublished = record.audit?.livePublished === true && record.parsedActive && record.isActive !== false;
  if (!livePublished && hasHardAuditErrors(record)) reasons.push('hard-audit-errors');
  if (!livePublished && record.audit && record.audit.publishable === false) reasons.push('audit-not-publishable');
  return reasons;
}

function isPublishableUploadRecord(record) {
  return getUploadRecordBlockReasons(record).length === 0;
}

function shouldRegisterUploadedSpecialty(record) {
  if (!record || !record.deptKey) return false;
  if (ROTAS[record.deptKey] && !ROTAS[record.deptKey].uploadedOnly) return true;
  return isPublishableUploadRecord(record);
}

function isValidImagingUploadRecord(record) {
  return isPublishableUploadRecord(record);
}

function cacheUploadedRecord(record) {
  if (!record || !record.deptKey) return;
  const normalized = canonicalizeUploadedRecord(record);
  if (isPublishableUploadRecord(normalized)) {
    uploadedPdfRecords.set(normalized.deptKey, normalized);
    if (normalized.originalDeptKey) uploadedPdfRecords.set(normalized.originalDeptKey, normalized);
    return;
  }
  // Sprint 2 (M6): don't delete an existing valid record when a newer non-publishable one arrives
  const existing = uploadedPdfRecords.get(normalized.deptKey);
  if (!existing || !isPublishableUploadRecord(existing) || (normalized.uploadedAt || 0) > (existing.uploadedAt || 0)) {
    uploadedPdfRecords.delete(normalized.deptKey);
    if (normalized.originalDeptKey) uploadedPdfRecords.delete(normalized.originalDeptKey);
  }
}

function resolveImagingActiveRecordSync(deptKey) {
  const record = uploadedPdfRecords.get(deptKey) || null;
  if (isValidImagingUploadRecord(record)) return record;
  return null;
}

// ── Month-staleness helpers (Sprint 0) ──────────────────────
// Prevent stale records from a prior month leaking into the current month.
// A record is valid if it has ANY entries for the current month.
// This handles PDFs that span two months (e.g., April 20 – May 10).
function getRecordMonths(record) {
  const entries = record?.entries || [];
  const months = new Set();
  for (const e of entries) {
    const m = (e.date || '').split('/')[1];
    if (m && /^\d{2}$/.test(m)) months.add(m);
  }
  return months;
}

function isRecordCurrentMonth(record, now) {
  if (!record) return false;
  const months = getRecordMonths(record);
  if (!months.size) return true; // undated records pass through (safe fallback)
  const currentMonth = String((now || new Date()).getMonth() + 1).padStart(2, '0');
  return months.has(currentMonth);
}

function uploadedRecordForDept(deptKey) {
  if (isImagingDeptKey(deptKey)) return resolveImagingActiveRecordSync(deptKey);
  const direct = uploadedPdfRecords.get(deptKey) || null;
  if (isPublishableUploadRecord(direct)) return direct;
  const fallback = uploadedPdfRecords.get(PDF_FALLBACKS[deptKey]) || null;
  if (isPublishableUploadRecord(fallback)) return fallback;
  return null;
}

function isLegacyMedicineOnCallRecord(record) {
  if (!record || record.deptKey !== 'medicine_on_call' || !Array.isArray(record.entries) || !record.entries.length) return false;
  const label = normalizeText(ROTAS.medicine_on_call?.label || 'medicine on call');
  const genericSections = record.entries.filter(entry => {
    const section = normalizeText(entry.section || '');
    return !section || section === label || section === normalizeText('Medicine / باطنية المناوبة');
  }).length;
  const typedSections = record.entries.filter(entry => {
    const section = normalizeText(entry.section || '');
    return section === 'junior er' || section === 'junior ward' || section === 'senior';
  }).length;
  const genericRoles = record.entries.filter(entry => {
    const role = normalizeText(entry.role || '');
    return role === 'resident' || role === 'consultant on call' || role === 'consultant';
  }).length;
  return typedSections === 0 && genericSections >= 2 && genericRoles >= 2;
}

function isLegacyPicuRecord(record) {
  if (!record || record.deptKey !== 'picu' || !Array.isArray(record.entries) || !record.entries.length) return false;
  const structuredCount = record.entries.filter(entry => normalizeText(entry.picuField || '')).length;
  const genericConsultantOnly = record.entries.every(entry => /consultant/i.test(entry.role || '') && !entry.picuField);
  return structuredCount === 0 || genericConsultantOnly;
}

function normalizedUploadedBaseEntries(record, deptKey) {
  const normalizedPayload = record?.normalized || null;
  if (!normalizedPayload || !Array.isArray(normalizedPayload.roles) || !normalizedPayload.roles.length) {
    return Array.isArray(record?.entries) ? record.entries : [];
  }
  return normalizedRolesToEntries(normalizedPayload).filter(entry =>
    !entry.specialty
    || entry.specialty === deptKey
    || record.deptKey === deptKey
    || PDF_FALLBACKS[deptKey] === record.deptKey
  );
}

// ═══════════════════════════════════════════════════════════════
// Unified specialty dispatch — single code path for all entry sources
// ═══════════════════════════════════════════════════════════════

function resolveSpecialtyEntries(deptKey, base, schedKey, now, qLow='') {
  if (!base.length) return [];
  if (base.some(isNoCoverageEntry)) return base.filter(isNoCoverageEntry);
  if (deptKey === 'medicine_on_call') {
    return splitMultiDoctorEntries(getMedicineOnCallDisplayEntries(base.map(cloneEntry), now), deptKey);
  }
  if (deptKey === 'radiology_duty') {
    const intent = radiologyQueryIntent(qLow);
    if (intent === 'ct_neuro_er') {
      const override = getRadiologyDutyNeuroErEntries(schedKey);
      if (override.length) return override;
    }
    return filterRadiologyDutyByIntent(base.map(cloneEntry), intent);
  }
  if (deptKey === 'radiology_oncall') return base;
  if (deptKey === 'surgery') return splitMultiDoctorEntries(base.map(cloneEntry), deptKey);
  if (deptKey === 'neurology') return splitMultiDoctorEntries(getNeurologyEntriesFromRows(base, now), deptKey);
  if (deptKey === 'picu') return splitMultiDoctorEntries(resolvePicuActiveEntries(getPicuEntriesFromRows(base), now), deptKey);
  if (deptKey === 'kptx') return splitMultiDoctorEntries(getKptxEntriesFromRows(base, now), deptKey);
  if (deptKey === 'liver') return splitMultiDoctorEntries(normalizeLiverRowsForDisplay(base.map(cloneEntry), schedKey, now), deptKey);
  if (isMedicineSubspecialty(deptKey)) {
    const entries = withMedicineMeta(base.map(cloneEntry), deptKey);
    const active = isWorkHours(now)
      ? entries.filter(entry => entry.coverageType !== 'on-call')
      : entries.filter(entry => entry.coverageType === 'on-call');
    return splitMultiDoctorEntries(active.length ? active : entries.filter(entry => roleText(entry).includes('24h')), deptKey);
  }
  return splitMultiDoctorEntries(filterActiveEntriesV2(base.map(cloneEntry), now, deptKey), deptKey);
}

function resolveDisplayEntriesFromNormalizedPayload(deptKey, normalizedPayload, schedKey, now, qLow='') {
  const allEntries = normalizedRolesToEntries(normalizedPayload).filter(entry =>
    !entry.specialty
    || entry.specialty === deptKey
    || PDF_FALLBACKS[deptKey] === normalizedPayload?.specialty
  );
  const dated = allEntries.filter(entry => !entry.date || entry.date === schedKey || entry.date === 'dynamic-weekday');
  const base = dated.length ? dated : allEntries.filter(entry => !entry.date);
  return resolveSpecialtyEntries(deptKey, base, schedKey, now, qLow);
}

function uploadedEntriesForDept(deptKey, schedKey, now, qLow='') {
  if (deptKey === 'radiology_duty') return null;
  // Temporarily force radiology_oncall to use ROTAS built-in (correct data)
  // until stale uploaded record with wrong names is cleared
  if (deptKey === 'radiology_oncall') return null;
  const record = uploadedRecordForDept(deptKey);
  if (!record || !record.parsedActive || !Array.isArray(record.entries)) return null;
  // Sprint 0: skip stale records from a prior month
  if (!isRecordCurrentMonth(record, now)) return null;
  if (deptKey === 'medicine_on_call' && isLegacyMedicineOnCallRecord(record)) return null;
  if (deptKey === 'hospitalist' && isLegacyHospitalistRecord(record)) return null;
  if (deptKey === 'picu' && isLegacyPicuRecord(record)) return null;
  if (record.normalized?.roles?.length) {
    return resolveDisplayEntriesFromNormalizedPayload(deptKey, record.normalized, schedKey, now, qLow);
  }
  const baseEntries = normalizedUploadedBaseEntries(record, deptKey);
  if (!baseEntries.length) return null; // no data for this date → fall through to built-in
  const deptEntries = baseEntries.filter(entry => !entry.specialty || entry.specialty === deptKey || record.deptKey === deptKey || PDF_FALLBACKS[deptKey] === record.deptKey);
  const dated = deptEntries.filter(entry => !entry.date || entry.date === schedKey || entry.date === 'dynamic-weekday');
  const base = dated.length ? dated : deptEntries.filter(entry => !entry.date);
  if (base.some(isNoCoverageEntry)) return base.filter(isNoCoverageEntry);
  if (record.review && record.review.parsing) return splitMultiDoctorEntries(base.map(cloneEntry), deptKey);
  return resolveSpecialtyEntries(deptKey, base, schedKey, now, qLow);
}


const DEFAULT_PDF_MAP = {
  ent:{href:'assets/pdfs/April%20Duty%20ENT%20Rota%202026%20Update.pdf',name:'April Duty ENT Rota 2026 Update.pdf'},
  ophthalmology:{href:'assets/pdfs/Opthalmology%20April%202026.pdf',name:'Opthalmology April 2026.pdf'},
  urology:{href:'assets/pdfs/April%202026%20Adult%20Urology%20Duty%20Rota%20NEW%20(1).pdf',name:'April 2026 Adult Urology Duty Rota NEW (1).pdf'},
  hematology:{href:'assets/pdfs/April%202026%20-%20Adult%20Hematology-Oncology%20%26%20SCT%20Department%20On-Call%20and%20Duty%20Rota.pdf',name:'Hematology-Oncology & SCT rota.pdf'},
  radonc:{href:'assets/pdfs/April%202026_RADONC%20Oncologist%20oncall%20rota.pdf',name:'RADONC Oncall rota.pdf'},
  nephrology:{href:'assets/pdfs/April%202026%20Gen%20Nephrology%20Call%20Schedule%20(1).pdf',name:'Gen Nephrology Call Schedule.pdf'},
  kptx:{href:'assets/pdfs/April%202026%20of%20KPTx%20Call%20Schedule.pdf',name:'KPTx Call Schedule.pdf'},
  liver:{href:'assets/pdfs/April%202026%20Adult%20Liver%20Transplant%20Call%20Schedule.pdf',name:'Adult Liver Transplant Call Schedule.pdf'},
  palliative:{href:'assets/pdfs/APRIL%202026%20-%20Palliative%20Medicine%20Department%20On-Call%20%26%20Duty%20Rota%20-Revision%201.pdf',name:'Palliative Medicine rota (Rev 1).pdf'},
  gynecology:{href:'assets/pdfs/Duty%20Rota%20-%20Gynecology%20-%20April%20-%202026.pdf',name:'Gynecology rota.pdf'},
  dental:{href:'assets/pdfs/Duty%20Rota%20Dental%20%20April%202026.pdf',name:'Dental rota.pdf'},
  neurosurgery:{href:'assets/pdfs/Neuro%20Surgery%20D%20Duty%20Rota%20-April%202026.pdf',name:'Neuro Surgery rota.pdf'},
  spine:{href:'assets/pdfs/Spine%20Surgery%20D%20Duty%20Rota%20Of%20April%202026.pdf',name:'Spine Surgery rota.pdf'},
  psychiatry:{href:'assets/pdfs/Psychiatry%20Duty%20Rota%20April._.pdf',name:'Psychiatry rota.pdf'},
  radiology_oncall:{href:'assets/pdfs/04%20April%202026%20MISC%20On-Call%20ROTA.pdf',name:'MISC On-Call ROTA.pdf'},
  radiology_duty:{href:'assets/pdfs/MISC%20DUTY%20ROTA%20March%2029-02%20April%202026%20(Week%205)%201.pdf',name:'MISC DUTY ROTA.pdf'},
  medicine:{href:'assets/pdfs/Department%20of%20Medicine%20-%20On%20call%20rota%20-%20April%20%20%202026.pdf',name:'Department of Medicine rota.pdf'},
  surgery:{href:'assets/pdfs/Surgery%20%20April%202026.pdf',name:'Surgery April 2026.pdf'},
  orthopedics:{href:'assets/pdfs/Orthopedic%20Duty%20Rota%20April%202026-signed.pdf',name:'Orthopedic Duty Rota April 2026.pdf'},
  neurology:{href:'assets/pdfs/Neurology%20Duty%20Rota%20April%202026.pdf',name:'Neurology Duty Rota April 2026.pdf'},
  anesthesia:{href:'assets/pdfs/04%20April%202026%20Anesthesia%20Rota%20TAAM.pdf',name:'Anesthesia Rota TAAM.pdf'},
  hospitalist:{href:'assets/pdfs/April%202026%20Hospitalist-Duty%20Rota.pdf',name:'Hospitalist Duty Rota.pdf'},
  physical_medicine_rehabilitation:{href:'assets/pdfs/Physical%20Medicine%20%26%20Rehabilitaion%20Duty%20Rota%20updated%20on%2031-03-2026%20in%20April.pdf',name:'Physical Medicine & Rehabilitation Duty Rota.pdf'},
  pediatric_neurology:{href:'assets/pdfs/Ped%20Neuro%20D%20Master%20On-Call%20Consultants%20updated%20on%2031-03-2026%20in%20April.pdf',name:'Pediatric Neurology On-Call.pdf'},
  pediatrics:{href:'assets/pdfs/Pidiatric%20Duty%20Rota%20April%202026.pdf',name:'Pediatrics Duty Rota April 2026.pdf'},
  picu:{href:'assets/pdfs/PICU%201st%20Rev%20April%202026.pdf',name:'PICU Duty Rota (Rev 1).pdf'},
  pediatric_cardiology:{href:'assets/pdfs/04%20April%202026%20Pediatric%20Cardiology.pdf',name:'Pediatric Cardiology Rota.pdf'},
  adult_cardiology:{href:'assets/pdfs/04%20April%202026%20Adult%20Cardilogy%20-%20Rota.pdf',name:'Adult Cardiology Rota.pdf'},
  neuro_ir:{href:'assets/pdfs/Neuro%20IR%20Rota%20April%202026.pdf',name:'Neuro IR Rota April 2026.pdf'},
  pediatric_heme_onc:{href:'assets/pdfs/April%202026%20Pediaric%20Hematology%20Oncology%20%26%20SCT%20-%20Call%20Rota%20-REvision%201.pdf',name:'Pediatric Heme-Onc & SCT Rota.pdf'},
  clinical_lab:{href:'assets/pdfs/04%20April%202026%20Clinical%20Laboratory%20%26%20Pathology%20On-Call.pdf',name:'Clinical Laboratory & Pathology On-Call.pdf'},
  critical_care:{href:'assets/pdfs/Critical%20Care%20April%20Duty%20Rota.pdf',name:'Critical Care April Duty Rota.pdf'},
  medicine_on_call:{href:'assets/pdfs/Block%207%20(Mar%2015%20-%20Apr%2011).pdf',name:'Block 7 (Mar 15 - Apr 11).pdf'},
};

const UPLOADED_SPECIALTY_ICON = '🩺';

const SPECIALTY_LABEL_OVERRIDES = {
  anesthesiology:'Anesthesia / التخدير',
  anesthesia:'Anesthesia / التخدير',
  anaesthesia:'Anesthesia / التخدير',
  physical_medicine_rehabilitation:'Physical Medicine & Rehabilitation / الطب الطبيعي والتأهيل',
  pediatric_neurology:'Pediatric Neurology / أعصاب الأطفال',
  pediatric_cardiology:'Pediatric Cardiology / قلب الأطفال',
  pediatric_heme_onc:'Pediatric Heme-Onc & SCT / دم وأورام الأطفال',
  picu:'PICU / وحدة العناية المركزة للأطفال',
  adult_cardiology:'Adult Cardiology / قلب البالغين',
  neuro_ir:'Neuro Interventional Radiology / الأشعة التدخلية للأعصاب',
  clinical_lab:'Clinical Lab & Pathology / المختبر السريري',
  hospitalist:'Hospitalist / أطباء المستشفى',
  pediatrics:'Pediatrics / طب الأطفال',
  neurology:'Neurology / الأعصاب',
  orthopedics:'Orthopedics / العظام',
  surgery:'General Surgery / الجراحة',
  medicine_on_call:'Medicine On-Call / باطنية المناوبة',
  medicine:'Medicine / الباطنية',
  endocrinology:'Endocrinology / الغدد الصماء والسكري',
  dermatology:'Dermatology / الأمراض الجلدية',
  rheumatology:'Rheumatology / أمراض الروماتيزم',
  gastroenterology:'Gastroenterology / الجهاز الهضمي',
  pulmonary:'Pulmonology / الأمراض الصدرية',
  infectious:'Infectious Disease / الأمراض المعدية',
};

const SPECIALTY_ICON_OVERRIDES = {
  anesthesia:'💤',
  physical_medicine_rehabilitation:'♿',
  pediatric_neurology:'🧠',
  pediatric_cardiology:'🫀',
  pediatric_heme_onc:'🩸',
  picu:'🍼',
  adult_cardiology:'❤️',
  neuro_ir:'🧠',
  clinical_lab:'🔬',
  hospitalist:'🏥',
  pediatrics:'👶',
  neurology:'🧠',
  orthopedics:'🦴',
  surgery:'🔪',
  medicine_on_call:'🩺',
  medicine:'🩺',
  nephrology:'🫘',
  kptx:'🫘',
  liver:'🟤',
  rheumatology:'🩹',
  gastroenterology:'🫃',
  urology:'🔵',
};

const SPECIALTY_FILENAME_INTERPRETERS = [
  { key:'anesthesia', icon:'💤', label:'Anesthesia / التخدير', terms:['anesthesia','anaesthesia','anesthesiology','anaesthesiology','taam'] },
  { key:'physical_medicine_rehabilitation', icon:'♿', label:'Physical Medicine & Rehabilitation / الطب الطبيعي والتأهيل', terms:['physical medicine rehabilitation','physical medicine rehabilitaion','pm r','pmr','rehabilitation','rehabilitaion'] },
  { key:'pediatric_neurology', icon:'🧠', label:'Pediatric Neurology / أعصاب الأطفال', terms:['ped neuro','pediatric neuro','paediatric neuro','child neurology','pediatric neurology','ped neurology'] },
  { key:'pediatric_cardiology', icon:'🫀', label:'Pediatric Cardiology / قلب الأطفال', terms:['pediatric cardiology','ped cardiology','ped card','pediatric cardiac'] },
  { key:'oncology', icon:'🎗️', label:'Adult Medical Oncology / أورام', terms:['adult medical oncology','medical oncology department','medical oncology on-call','medical oncology duty'] },
  { key:'pediatric_heme_onc', icon:'🩸', label:'Pediatric Heme-Onc & SCT / دم وأورام الأطفال', terms:['pediatric hematology','pediaric hematology','ped heme','ped oncology','pediatric oncology','sct pediatric','pediatric hematology oncology'] },
  { key:'critical_care', icon:'🏥', label:'Critical Care / العناية المركزة', terms:['critical care','critical care duty','icu duty','icu rota','intensive care'] },
  { key:'picu', icon:'🍼', label:'PICU / وحدة العناية المركزة للأطفال', terms:['picu','pediatric icu','pediatric intensive care'] },
  { key:'pediatrics', icon:'👶', label:'Pediatrics / طب الأطفال', terms:['pediatrics department','pidiatric duty','pediatrics duty','pediatric duty'] },
  { key:'adult_cardiology', icon:'❤️', label:'Adult Cardiology / قلب البالغين', terms:['adult cardiology','adult cardilogy','cardiology','cardiac','cardilogy','cardiac center'] },
  { key:'neuro_ir', icon:'🧠', label:'Neuro Interventional Radiology / الأشعة التدخلية للأعصاب', terms:['neuro ir','neuro interventional','interventional radiology neuro','ird rota','neuro ird'] },
  { key:'clinical_lab', icon:'🔬', label:'Clinical Lab & Pathology / المختبر السريري', terms:['clinical laboratory','clinical lab','pathology on-call','lab pathology'] },
  { key:'hospitalist', icon:'🏥', label:'Hospitalist / أطباء المستشفى', terms:['hospitalist'] },
  { key:'orthopedics', icon:'🦴', label:'Orthopedics / العظام', terms:['orthopedic','orthopedics','orthopaedic','ortho','department of orthopedics'] },
  { key:'surgery', icon:'🔪', label:'General Surgery / الجراحة', terms:['department of surgery','surgery april','general surgery'] },
  { key:'medicine_on_call', icon:'🩺', label:'Medicine On-Call / باطنية المناوبة', terms:['medicine on call','in house on call rota','department of medicnie','block 7'] },
  { key:'neurology', icon:'🧠', label:'Neurology / الأعصاب', terms:['neurology','neurology duty','neurology department','neurology rota','neurology main'] },
  { key:'neurosurgery', icon:'🧠', label:'Neurosurgery / جراحة الأعصاب', terms:['neuro surg','neuro-surg','neurosurg','neurosurgery','neuro surgery'] },
  { key:'medicine', icon:'🩺', label:'Medicine / الباطنية', terms:['department medicine','medicine'] },
];

const HOMEPAGE_PRIORITY = [
  'medicine_on_call',
  'hospitalist',
  'surgery',
  'pediatrics',
  'ent',
  'orthopedics',
  'radiology_oncall',
  'radiology_duty',
  'palliative',
  'neurology',
  'neurosurgery',
  'spine',
  'gynecology',
  'critical_care',
  'picu',
  'anesthesia',
  'psychiatry',
  'pediatric_neurology',
  'pediatric_cardiology',
  'pediatric_heme_onc',
  'neuro_ir',
  'urology',
  'ophthalmology',
  'oncology',
  'hematology',
  'radonc',
  'nephrology',
  'kptx',
  'liver',
  'adult_cardiology',
  'medicine',
  'dental',
  'clinical_lab',
  'physical_medicine_rehabilitation',
];

const PDF_FALLBACKS = {
  endocrinology:'medicine',
  dermatology:'medicine',
  rheumatology:'medicine',
  gastroenterology:'medicine',
  pulmonary:'medicine',
  infectious:'medicine'
};

const PDF_DETECTION_RULES = [
  { key:'radiology_oncall', terms:['misc on-call','misc on call','imaging on-call','radiology on-call','medical imaging on-call'] },
  { key:'radiology_duty', terms:['misc duty','medical imaging duty','radiology duty','duty rota march'] },
  { key:'neuro_ir', terms:['neuro ir','neuro interventional','interventional radiology','ird rota','neuro ird'] },
  { key:'neurosurgery', terms:['neuro surgery','neurosurgery','جراحة الأعصاب'] },
  { key:'spine', terms:['spine surgery','spine','spinal','جراحة العمود الفقري','ssd duty'] },
  { key:'ophthalmology', terms:['opthalmology','ophthalmology','eye','عيون'] },
  { key:'urology', terms:['urology','adult urology','مسالك'] },
  { key:'oncology', terms:['adult medical oncology','medical oncology department','medical oncology on-call'] },
  { key:'hematology', terms:['hematology','haematology','adult hematology','sct department','stem cell transplant','هيماتولوجي','أورام الدم'] },
  { key:'pediatric_heme_onc', terms:['pediatric hematology','pediaric hematology','ped heme','pediatric oncology sct','pediaric hematology oncology'] },
  { key:'radonc', terms:['radonc','radiation oncology','oncologist oncall','أورام الإشعاع'] },
  { key:'nephrology', terms:['nephrology','renal','gen nephrology','adult nephrology','كلى'] },
  { key:'kptx', terms:['kptx','kidney transplant','kidney tx','زراعة الكلى'] },
  { key:'liver', terms:['liver transplant','hepat','زراعة الكبد'] },
  { key:'palliative', terms:['palliative','palliative medicine','رعاية تلطيفية'] },
  { key:'gynecology', terms:['gynecology','gynaecology','gynae','obgyn','نسائية'] },
  { key:'dental', terms:['dental','dentistry','أسنان'] },
  { key:'psychiatry', terms:['psychiatry','mental health','نفسية'] },
  { key:'anesthesia', terms:['anesthesia','anaesthesia','anesthesiology','anaesthesiology','taam','تخدير'] },
  { key:'endocrinology', terms:['endocrinology','endocrin','thyroid','diabetes','غدد'] },
  { key:'dermatology', terms:['dermatology','dermat','skin','جلدية'] },
  { key:'rheumatology', terms:['rheumatology','rheumat','روماتيزم'] },
  { key:'gastroenterology', terms:['gastroenterology','gastro','gi rota','ercp','جهاز هضمي'] },
  { key:'pulmonary', terms:['pulmonary','pulmonology','pulmon','respiratory','chest','صدرية'] },
  { key:'infectious', terms:['infectious disease','infection','id rota','أمراض معدية'] },
  { key:'medicine_on_call', terms:['medicine on call','in house on call rota','department of medicnie','block 7','internal medicine on call'] },
  { key:'critical_care', terms:['critical care','icu','intensive care','icu duty','critical care duty','العناية المركزة','العناية'] },
  { key:'picu', terms:['picu','pediatric icu','picu duty'] },
  { key:'pediatrics', terms:['pediatrics department','pidiatric duty','pediatrics duty'] },
  { key:'pediatric_cardiology', terms:['pediatric cardiology','ped cardiology'] },
  { key:'adult_cardiology', terms:['adult cardiology','adult cardilogy','cardiology rota','cardiac rota','cardiac center'] },
  { key:'clinical_lab', terms:['clinical laboratory','clinical lab','pathology on-call','lab pathology'] },
  { key:'orthopedics', terms:['orthopedics','orthopedic duty','department of orthopedics'] },
  { key:'surgery', terms:['department of surgery','surgery april','general surgery'] },
  { key:'neurology', terms:['neurology','neurology duty','neurology department','neurology rota','neurology main'] },
  { key:'hospitalist', terms:['hospitalist department','hospitalist duty'] },
  { key:'physical_medicine_rehabilitation', terms:['physical medicine','rehabilitation duty','rehabilitaion duty'] },
  { key:'medicine', terms:['department of medicine','medicine rota','medical department'] },
  { key:'ent', terms:['ent','ear nose throat','أنف وأذن وحنجرة'] },
];

function detectDeptFromText(text='', detectionSource='content') {
  const interpreted = interpretSpecialtyFromText(text);
  // Content-based detection is HIGH confidence (PDF text is definitive).
  // Filename-based detection is also high confidence when matched.
  // Only mark uncertain if score is very low.
  if (interpreted) return { deptKey: interpreted.key, source: detectionSource, uncertain: false, score: interpreted.score || 100 };
  const normalizedSource = normalizeText(text);
  if (!normalizedSource) return { deptKey: null, source: detectionSource, uncertain: true, score: 0 };
  let best = null;
  const sourceTokens = normalizedSource.split(' ');
  PDF_DETECTION_RULES.forEach(({ key, terms }) => {
    const score = terms.reduce((sum, term) => {
      const normalizedTerm = normalizeText(term);
      const isShortLatinTerm = /^[a-z0-9]{1,3}$/.test(normalizedTerm);
      const hasTerm = isShortLatinTerm ? sourceTokens.includes(normalizedTerm) : hasSpecialtyTerm(normalizedSource, normalizedTerm);
      return hasTerm ? sum + normalizedTerm.length : sum;
    }, 0);
    if (score && (!best || score > best.score)) best = { key, score };
  });
  if (!best) return { deptKey: null, source: detectionSource, uncertain: true, score: 0 };
  // High confidence if score >= 6 (matched a meaningful keyword), otherwise uncertain
  return { deptKey: best.key, source: detectionSource, uncertain: best.score < 6, score: best.score };
}

function detectDeptKeyFromText(text='') {
  return detectDeptFromText(text).deptKey;
}

function detectDeptKeyFromFilename(name) {
  return detectDeptFromText(name, 'filename').deptKey;
}

function titleFromUploadedFilename(name='') {
  const base = name.replace(/\.pdf$/i, '')
    .replace(/\brehabilitaion\b/gi, 'rehabilitation')
    .replace(/\bped\b/gi, 'pediatric')
    .replace(/\bneuro[\s_-]*surg\b/gi, 'neurosurgery')
    .replace(/\borthopedic\b/gi, 'orthopedics')
    .replace(/\bD\b/g, ' ')
    .replace(/\b(rota|duty|schedule|on[\s-]?call|call|april|march|may|january|february|june|july|august|september|october|november|december|2026|2027|revision|rev|update|updated|signed|new|department|adult|master|consultants|consultant|taam|file|final|copy|in|on|kfsh|kfshd)\b/gi, ' ')
    .replace(/\b\d{4}[-_]\d{1,2}[-_]\d{1,2}\b/g, ' ')
    .replace(/\b\d{1,2}[-_ ]?\d{0,2}\b/g, ' ')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return base || name.replace(/\.pdf$/i, '').replace(/\s+/g, ' ').trim() || 'Uploaded Specialty';
}

function uploadedDeptKeyFromFilename(name='') {
  const interpreted = interpretSpecialtyFromText(name);
  if (interpreted) return interpreted.key;
  const label = titleFromUploadedFilename(name);
  const slug = normalizeText(label).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 42);
  return `uploaded_${slug || Date.now()}`;
}

function hasSpecialtyTerm(source='', term='') {
  const normalizedSource = normalizeText(source);
  const normalizedTerm = normalizeText(term);
  if (!normalizedSource || !normalizedTerm) return false;
  if (/^[a-z0-9 ]+$/.test(normalizedTerm)) {
    const escaped = normalizedTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(normalizedSource);
  }
  return normalizedSource.includes(normalizedTerm);
}

function interpretSpecialtyFromText(text='') {
  const cleaned = normalizeText(titleFromUploadedFilename(text));
  const raw = normalizeText(text).replace(/\brehabilitaion\b/g, 'rehabilitation');
  const medicineOnCallSignals = [
    'medicine on call',
    'medicine on-call',
    'internal medicine on call',
    'in house on call rota',
    'block 7',
    'باطنية مناوبة',
  ].map(normalizeText);
  if (medicineOnCallSignals.some(signal => raw.includes(signal) || cleaned.includes(signal))) {
    return SPECIALTY_FILENAME_INTERPRETERS.find(item => item.key === 'medicine_on_call') || null;
  }
  let best = null;
  SPECIALTY_FILENAME_INTERPRETERS.forEach(item => {
    const score = item.terms.reduce((sum, term) => {
      const t = normalizeText(term);
      return hasSpecialtyTerm(raw, t) || hasSpecialtyTerm(cleaned, t) ? sum + t.length : sum;
    }, 0);
    if (score && (!best || score > best.score)) best = { ...item, score };
  });
  return best;
}

function specialtyLabelForKey(deptKey, fallbackName='') {
  if (ROTAS[deptKey] && ROTAS[deptKey].label) return ROTAS[deptKey].label;
  const interpreted = interpretSpecialtyFromText(fallbackName || deptKey);
  if (interpreted) return interpreted.label;
  if (SPECIALTY_LABEL_OVERRIDES[deptKey]) return SPECIALTY_LABEL_OVERRIDES[deptKey];
  return normalizeUploadedSpecialtyLabel(titleFromUploadedFilename(fallbackName || deptKey)) || 'Uploaded Specialty';
}

function specialtyIconForKey(deptKey, fallbackName='') {
  if (ROTAS[deptKey] && ROTAS[deptKey].icon) return ROTAS[deptKey].icon;
  const interpreted = interpretSpecialtyFromText(fallbackName || deptKey);
  if (interpreted && interpreted.icon) return interpreted.icon;
  return SPECIALTY_ICON_OVERRIDES[deptKey] || UPLOADED_SPECIALTY_ICON;
}

function registerUploadedSpecialty(record) {
  if (!record || !record.deptKey) return;
  const label = record.specialtyLabel || specialtyLabelForKey(record.deptKey, record.name || 'Uploaded Specialty');
  const icon = record.icon || specialtyIconForKey(record.deptKey, record.name || '');
  if (ROTAS[record.deptKey]) {
    ROTAS[record.deptKey].label = label;
    ROTAS[record.deptKey].icon = icon;
    ROTAS[record.deptKey].keywords = Array.from(new Set([...(ROTAS[record.deptKey].keywords || []), label, record.deptKey, record.name || ''].filter(Boolean)));
    return;
  }
  ROTAS[record.deptKey] = {
    label,
    icon,
    keywords: [label, record.deptKey, record.name || ''].filter(Boolean),
    contacts: {},
    schedule: {},
    uploadedOnly: true,
  };
}

function ensureDetectedSpecialty(deptKey, fileName='') {
  if (ROTAS[deptKey]) return;
  registerUploadedSpecialty({
    deptKey,
    name: fileName,
    specialtyLabel: specialtyLabelForKey(deptKey, fileName),
    icon: specialtyIconForKey(deptKey, fileName),
  });
}

function canonicalizeUploadedRecord(record) {
  if (!record) return record;
  const normalizedPayload = record.normalized || buildNormalizedUploadPayload({
    deptKey: record.deptKey || record.originalDeptKey || '',
    fileName: record.name || '',
    entries: record.entries || [],
    parseDebug: record.diagnostics || record.debug || {},
    rawText: record.rawText || '',
  });
  const review = { ...(record.review || {}) };
  if (record.parsedActive && record.isActive !== false) {
    review.auditRejected = false;
    review.parsing = false;
    review.pendingUploadReview = false;
    review.reviewOnly = false;
    review.reviewReason = '';
  }
  const preservedKey = record.deptKey || record.originalDeptKey || '';
  if (preservedKey === 'medicine_on_call' || record.originalDeptKey === 'medicine_on_call') {
    if (record.parsedActive && record.isActive !== false) {
      review.specialty = false;
      review.policyIssues = [];
      review.reasonCodes = [];
    }
    return {
      ...record,
      normalized: normalizedPayload,
      review,
      originalDeptKey: 'medicine_on_call',
      deptKey: 'medicine_on_call',
      specialty: 'medicine_on_call',
      specialtyLabel: specialtyLabelForKey('medicine_on_call', record.name || ''),
      icon: specialtyIconForKey('medicine_on_call', record.name || ''),
    };
  }
  if (preservedKey && ROTAS[preservedKey] && !ROTAS[preservedKey].uploadedOnly) {
    return {
      ...record,
      normalized: normalizedPayload,
      review,
      originalDeptKey: record.originalDeptKey || preservedKey,
      deptKey: preservedKey,
      specialty: preservedKey,
      specialtyLabel: specialtyLabelForKey(preservedKey, record.name || ''),
      icon: specialtyIconForKey(preservedKey, record.name || ''),
    };
  }
  const interpreted = interpretSpecialtyFromText(`${record.name || ''} ${record.specialtyLabel || ''} ${record.deptKey || ''}`);
  if (!interpreted) {
    return {
      ...record,
      normalized: normalizedPayload,
      review,
      specialtyLabel: specialtyLabelForKey(record.deptKey, record.name || ''),
      icon: specialtyIconForKey(record.deptKey, record.name || ''),
    };
  }
  // Sprint 2 (M4): don't reassign deptKey if the target already has a valid record
  if (interpreted.key !== record.deptKey) {
    const existingTarget = uploadedPdfRecords.get(interpreted.key);
    if (existingTarget && isPublishableUploadRecord(existingTarget)) {
      console.warn(`[canonicalize] Would reassign ${record.deptKey} → ${interpreted.key}, but target has valid data. Keeping original key.`);
      return {
        ...record,
        normalized: normalizedPayload,
        review,
        specialtyLabel: specialtyLabelForKey(record.deptKey, record.name || ''),
        icon: specialtyIconForKey(record.deptKey, record.name || ''),
      };
    }
  }
  return {
    ...record,
    normalized: normalizedPayload,
    review,
    originalDeptKey: record.originalDeptKey || record.deptKey,
    deptKey: interpreted.key,
    specialty: interpreted.key,
    specialtyLabel: interpreted.label,
    icon: interpreted.icon,
  };
}

// ═══════════════════════════════════════════════════════════════
// PDF TEXT EXTRACTION — uses PDF.js (loaded lazily from CDN)
// This is the ONLY reliable way to extract text from FlateDecode-
// compressed PDFs without a server. The old homegrown extractor
// could not decompress or decode font-mapped text streams.
// ═══════════════════════════════════════════════════════════════

let _pdfjsLib = null;
const _pdfTextCache = new Map();
const _bundledContactHydration = new Map();
// currentPdfTextIndex, currentPdfSearchResults → now in ui/pdf-preview.js

async function loadPdfJs() {
  if (_pdfjsLib) return _pdfjsLib;
  return new Promise((resolve, reject) => {
    if (window.pdfjsLib) { _pdfjsLib = window.pdfjsLib; resolve(_pdfjsLib); return; }
    const script = document.createElement('script');
    // Try local bundled copy first; fall back to CDN if not present
    const LOCAL_PATH   = 'assets/js/lib/pdf.min.js';
    const LOCAL_WORKER = 'assets/js/lib/pdf.worker.min.js';
    const CDN_PATH     = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    const CDN_WORKER   = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    script.src = LOCAL_PATH;
    script.onload = () => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = LOCAL_WORKER;
      _pdfjsLib = window.pdfjsLib;
      resolve(_pdfjsLib);
    };
    script.onerror = () => {
      // Local copy not found — fall back to CDN
      const cdnScript = document.createElement('script');
      cdnScript.src = CDN_PATH;
      cdnScript.onload = () => {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = CDN_WORKER;
        _pdfjsLib = window.pdfjsLib;
        resolve(_pdfjsLib);
      };
      cdnScript.onerror = reject;
      document.head.appendChild(cdnScript);
    };
    document.head.appendChild(script);
  });
}

async function extractPdfText(file) {
  try {
    const pdfjs = await loadPdfJs();
    const buffer = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data: buffer }).promise;
    const pageTexts = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      // Group items by y-coordinate (same row = y within 2 units)
      // Then within each row, sort by x and insert column-boundary double-spaces
      // when the gap between consecutive items is large (indicates a table column gap)
      let lastY = null;
      const lineChunks = [];
      let currentLineItems = []; // [{str, x, width}]

      const flushLine = () => {
        if (!currentLineItems.length) return;
        // Sort by x position
        currentLineItems.sort((a, b) => a.x - b.x);
        // Compute average char width for this line
        const totalChars = currentLineItems.reduce((s, it) => s + (it.str.length || 1), 0);
        const totalWidth = currentLineItems.reduce((s, it) => s + (it.width || 0), 0);
        const avgCharW = totalWidth > 0 ? totalWidth / totalChars : 6;
        // Build the line, inserting double-space where gap > 1.5 * avgCharW
        // ZONE SPLIT: if gap > 100px, treat as schedule/contact table boundary
        // and emit two separate lines instead of merging them
        let line = '';
        for (let j = 0; j < currentLineItems.length; j++) {
          const it = currentLineItems[j];
          if (j === 0) {
            line += it.str;
          } else {
            const prev = currentLineItems[j - 1];
            const prevEnd = prev.x + (prev.width || prev.str.length * avgCharW);
            const gap = it.x - prevEnd;
            if (gap > 100) {
              // Large zone gap — emit schedule line, start contact line separately
              lineChunks.push(line.trimEnd());
              line = it.str;
            } else {
              line += (gap > avgCharW * 1.8 ? '  ' : ' ') + it.str;
            }
          }
        }
        lineChunks.push(line.trimEnd());
        currentLineItems = [];
      };

      for (const item of content.items) {
        if (!item.str) continue;
        const y = item.transform ? Math.round(item.transform[5]) : 0;
        const x = item.transform ? item.transform[4] : 0;
        const width = item.width || 0;
        if (lastY !== null && Math.abs(y - lastY) > 2) {
          flushLine();
        }
        currentLineItems.push({ str: item.str, x, width });
        lastY = y;
      }
      flushLine();
      pageTexts.push(lineChunks.join('\n'));
    }
    return pageTexts.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
  } catch (err) {
    console.warn('PDF.js extraction failed, falling back to raw read:', err);
    const buffer = await file.arrayBuffer();
    const raw = new TextDecoder('latin1', { fatal: false }).decode(buffer);
    return raw.replace(/[^\x20-\x7E\u0600-\u06FF\n]+/g, ' ').replace(/\s+/g, ' ').trim();
  }
}

/**
 * Liver-specific columnar text extraction.
 * Uses PDF.js x-coordinates + known column headers to bin text into
 * fixed columns, so empty cells stay empty instead of drifting.
 *
 * Returns the SAME plain-text format as extractPdfText but with TAB
 * characters (\t) inserted between column boundaries.  The liver parser
 * can then split on \t to get exact column values.
 *
 * Column headers searched (Inpatient Service):
 *   Day | 1st On-Call / After Duty | 2nd On-Call | Consultant / 3rd | Coordinator
 * Anything beyond the Coordinator column (Outpatient Service) is tagged
 * as column index 5+ and discarded by the parser.
 */
async function extractLiverColumnarText(file) {
  try {
    const pdfjs = await loadPdfJs();
    const buffer = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data: buffer }).promise;

    // ── Pass 1: scan ALL pages for column header x-positions ──────
    // We look for header keywords that define the 5 Inpatient columns.
    // The x-coordinate of each keyword becomes a column boundary.
    // Header patterns — STRICT to avoid cross-column pollution.
    // "Assistant Consultant" is a Day Coverage sub-header, NOT After Duty.
    // "Consultant" alone could match "Assistant Consultant", so we require
    // it to NOT be preceded by "Assistant".
    const HEADER_PATTERNS = [
      { col: 0, re: /^DAY\s+COVERAGE$/i },
      { col: 0, re: /^Day$/i },
      { col: 1, re: /^After$/i },                               // "After" in "After Duty"
      { col: 2, re: /^2nd$/i },                                  // "2nd" in "2nd On-Call"
      { col: 2, re: /^2$/i },                                    // PDF splits "2nd" → "2"+"nd"
      { col: 3, re: /^Consultant$/i },                           // standalone "Consultant" only
      { col: 4, re: /^Clinical$/i },
      { col: 4, re: /^Coordinator$/i },
    ];
    // Collect all candidate x-positions per column
    const colCandidates = { 0: [], 1: [], 2: [], 3: [], 4: [] };
    const allPageRows = []; // [{y, items: [{str, x, width}]}] per page

    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      // Group by y
      const rows = [];
      let curY = null, curItems = [];
      const flush = () => { if (curItems.length) rows.push({ y: curY, items: [...curItems] }); curItems = []; };
      for (const item of content.items) {
        if (!item.str || !item.str.trim()) continue;
        const y = item.transform ? Math.round(item.transform[5]) : 0;
        const x = item.transform ? item.transform[4] : 0;
        const width = item.width || 0;
        if (curY !== null && Math.abs(y - curY) > 2) flush();
        curItems.push({ str: item.str, x, width });
        curY = y;
      }
      flush();

      // Scan for header keywords — match INDIVIDUAL items only (not joined line text)
      // to prevent cross-column pollution like "Assistant Consultant" matching col 3.
      for (const row of rows) {
        for (const hp of HEADER_PATTERNS) {
          for (const it of row.items) {
            if (hp.re.test(it.str.trim())) {
              colCandidates[hp.col].push(it.x);
            }
          }
        }
      }
      allPageRows.push(rows);
    }

    // Filter out obvious false positives: col 3 (Consultant) and col 4 (Coordinator)
    // should be to the RIGHT of col 0 (Day Coverage). Remove any x < 250.
    for (const col of [3, 4]) {
      colCandidates[col] = colCandidates[col].filter(x => x > 250);
    }

    // ── Separate Date column from Day Coverage ──────────────────
    // Col 0 candidates may contain BOTH the Date column (x≈72) and Day Coverage (x≈199).
    // Split them: x < 150 → Date column, x ≥ 150 → Day Coverage.
    const dateColXs = colCandidates[0].filter(x => x < 150);
    colCandidates[0] = colCandidates[0].filter(x => x >= 150);
    const dateColX = dateColXs.length
      ? dateColXs.sort((a, b) => a - b)[Math.floor(dateColXs.length / 2)]
      : 0;

    // console.log('[LIVER COL DETECT]', JSON.stringify(colCandidates));

    // ── Compute column boundaries ──────────────────────────────
    // 6 columns: [Date, DayCoverage, AfterDuty, 2ndOnCall, Consultant, Coordinator]
    // We prepend the Date column so items in the date area don't pollute Day Coverage.
    const medianX = col => {
      const xs = colCandidates[col];
      if (!xs.length) return null;
      xs.sort((a, b) => a - b);
      return xs[Math.floor(xs.length / 2)];
    };
    // colX[0..4] = Day Coverage through Coordinator (from HEADER_PATTERNS)
    const colX = [medianX(0), medianX(1), medianX(2), medianX(3), medianX(4)];
    if (colX[0] == null) colX[0] = 150; // fallback: Day Coverage starts around x=150

    // Interpolate missing columns from their neighbors.
    // E.g. if col 2 is null but col 1=310 and col 3=467, col 2 = 310 + (467-310)/2 = 389.
    for (let i = 0; i < colX.length; i++) {
      if (colX[i] != null) continue;
      let left = i - 1, right = i + 1;
      while (left >= 0 && colX[left] == null) left--;
      while (right < colX.length && colX[right] == null) right++;
      if (left >= 0 && right < colX.length) {
        const span = right - left;
        colX[i] = colX[left] + (colX[right] - colX[left]) * (i - left) / span;
      }
    }

    // Build sorted boundary array: Date column (-1) + data columns (0-4)
    // Prepend Date column so it gets its own tab-column in the output.
    const allCols = [{ col: -1, x: dateColX }]; // -1 = Date column
    for (let i = 0; i < colX.length; i++) {
      if (colX[i] != null) allCols.push({ col: i, x: colX[i] });
    }
    allCols.sort((a, b) => a.x - b.x);

    // If we don't have enough columns, fall back to plain text
    if (allCols.length < 5) {
      return { text: await extractPdfText(file), columnar: false };
    }

    // console.log('[LIVER COL BOUNDS]', allCols.map(d => (d.col===-1?'date':'col'+d.col)+'@'+Math.round(d.x)));

    // Create boundary midpoints between consecutive column x-positions.
    const boundaries = [];
    for (let i = 0; i < allCols.length - 1; i++) {
      boundaries.push({
        col: allCols[i].col,
        minX: i === 0 ? -Infinity : (allCols[i - 1].x + allCols[i].x) / 2,
        maxX: (allCols[i].x + allCols[i + 1].x) / 2,
      });
    }
    const last = allCols[allCols.length - 1];
    boundaries.push({
      col: last.col,
      minX: (allCols[allCols.length - 2].x + last.x) / 2,
      maxX: Infinity,
    });

    // Assign column index to an x-position.
    // Returns -1 for Date column, 0-4 for data columns.
    const getCol = (x) => {
      for (const b of boundaries) {
        if (x >= b.minX && x < b.maxX) return b.col;
      }
      return allCols.length; // beyond last column
    };

    // ── Pass 2: rebuild text with \t column delimiters ────────
    const pageTexts = [];
    for (const rows of allPageRows) {
      const lineChunks = [];
      for (const row of rows) {
        row.items.sort((a, b) => a.x - b.x);
        // Bin items into columns
        const colTexts = {};
        for (const it of row.items) {
          const c = getCol(it.x);
          if (!colTexts[c]) colTexts[c] = [];
          colTexts[c].push(it.str);
        }
        // Build line: columns -1 (Date) through 4+ joined by \t
        // Col -1 = Date, Col 0 = Day Coverage, Col 1 = After Duty, etc.
        const minCol = Math.min(...Object.keys(colTexts).map(Number));
        const maxCol = Math.max(...Object.keys(colTexts).map(Number), 4);
        const parts = [];
        for (let c = Math.min(minCol, -1); c <= maxCol; c++) {
          parts.push(colTexts[c] ? colTexts[c].join(' ') : '');
        }
        lineChunks.push(parts.join('\t'));
      }
      pageTexts.push(lineChunks.join('\n'));
    }
    const text = pageTexts.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
    return { text, columnar: true };
  } catch (err) {
    console.warn('Liver columnar extraction failed, falling back:', err);
    return { text: await extractPdfText(file), columnar: false };
  }
}

async function getRawPdfTextForDept(deptKey) {
  const uploaded = uploadedRecordForDept(deptKey);
  if (uploaded && uploaded.parsedActive && uploaded.rawText) {
    _pdfTextCache.set(deptKey, uploaded.rawText);
    return uploaded.rawText;
  }
  if (_pdfTextCache.has(deptKey)) return _pdfTextCache.get(deptKey);
  const meta = DEFAULT_PDF_MAP[deptKey] || DEFAULT_PDF_MAP[PDF_FALLBACKS[deptKey]];
  if (!meta || !meta.href) return '';
  try {
    const res = await fetch(meta.href);
    if (!res.ok) return '';
    const blob = await res.blob();
    const file = new File([blob], meta.name || `${deptKey}.pdf`, { type: 'application/pdf' });
    const text = await extractPdfText(file);
    _pdfTextCache.set(deptKey, text || '');
    return text || '';
  } catch (err) {
    console.warn('PDF source text fetch failed:', deptKey, err);
    return '';
  }
}

// Detection text: use PDF.js extraction (first 3 pages enough for specialty detection)
async function readPdfDetectionText(file) {
  try {
    const pdfjs = await loadPdfJs();
    const buffer = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data: buffer }).promise;
    const pagesToCheck = Math.min(pdf.numPages, 3);
    const chunks = [];
    for (let i = 1; i <= pagesToCheck; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      chunks.push(content.items.map(it => it.str).join(' '));
    }
    return chunks.join('\n');
  } catch (err) {
    // Fallback: just use filename for detection
    return file.name;
  }
}

// normalizeUploadedRole → moved to core/phone-resolver.js
// normalizeUploadedSpecialtyLabel → moved to core/phone-resolver.js

// homepageLabel, escapeHtml → now in ui/card.js

function formatUploadIssueList(issues=[]) {
  if (!issues || !issues.length) return '';
  return issues.map(issue => {
    const type = issue.issueType ? `${issue.issueType}: ` : '';
    return `${type}${issue.explanation || ''}`.trim();
  }).filter(Boolean).join(' | ');
}

// HARD_REVIEW_ISSUE_TYPES, hasHardReviewIssue, getCriticalUploadRiskTypes, getElevatedUploadRiskTypes
// → moved to upload/pipeline.js

function formatRadiologyDutyUploadDebug(entries=[], issues=[], publishable=false) {
  if (!entries.length) return '';
  const sectionOrder = ['CT - Neuro', 'CT - General', 'Ultrasound - Abdomen', 'Ultrasound - MSK', 'X-Ray / General', 'Nuclear / PET'];
  const bySection = new Map();
  entries.forEach(entry => {
    const key = entry.section || 'Unknown';
    if (!bySection.has(key)) bySection.set(key, []);
    bySection.get(key).push(entry);
  });
  const normalizedIssues = issues || [];
  return [...bySection.entries()]
    .sort((a, b) => {
      const ia = sectionOrder.indexOf(a[0]);
      const ib = sectionOrder.indexOf(b[0]);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a[0].localeCompare(b[0]);
    })
    .map(([section, rows]) => {
      const names = rows.map(row => row.name).filter(Boolean);
      const roles = Array.from(new Set(rows.map(row => row.role).filter(Boolean)));
      const confidences = Array.from(new Set(rows.map(row => row._confidence || 'high')));
      const rowReasons = rows.flatMap(row => (row._rowIssues || []).map(issue => issue.msg)).filter(Boolean);
      const sectionReasons = normalizedIssues
        .filter(issue => (issue.affectedRows || []).some(text => names.some(name => text.includes(name))))
        .map(issue => issue.explanation);
      const reasons = Array.from(new Set([...rowReasons, ...sectionReasons]));
      const okClass = publishable ? 'ok' : 'fail';
      return `<div class="upload-debug ${okClass}">section=${escapeHtml(section)} · doctors=${escapeHtml(names.join(', ') || 'none')} · role=${escapeHtml(roles.join(', ') || 'n/a')} · confidence=${escapeHtml(confidences.join(', '))} · publishable=${publishable ? 'yes' : 'no'}${reasons.length ? ` · reason=${escapeHtml(reasons.join(' | '))}` : ''}</div>`;
    }).join('');
}


// ═══════════════════════════════════════════════════════════════
// PARSERS → extracted to parsers/ directory
// Generic helpers and parsers: parsers/generic.js
// PICU: parsers/picu.js
// Hospitalist: parsers/hospitalist.js
// Medicine On-Call + subspecialties: parsers/medicine.js
// Radiology Duty: parsers/radiology.js
// Surgery: parsers/surgery.js
// Neurology: parsers/neurology.js
// Anesthesia: parsers/anesthesia.js
// Others (Gynecology, Neurosurgery, KPTX, Liver): parsers/others.js
// ═══════════════════════════════════════════════════════════════

// App-level hydration/support functions (depend on ROTAS, upload state, etc.)
// These were previously interleaved with parser code but belong at app level.

function mergeResolvedContactsIntoDept(deptKey='', contactResult=null) {
  const dept = ROTAS[deptKey];
  if (!dept || !contactResult) return 0;
  dept.contacts = dept.contacts || {};
  const names = new Set();
  Object.values(dept.schedule || {}).forEach(entries => {
    (entries || []).forEach(entry => {
      splitPossibleNames(entry.name || '').forEach(name => {
        const clean = (name || '').trim();
        if (clean) names.add(clean);
      });
    });
  });
  let added = 0;
  names.forEach(name => {
    const resolved = resolvePhoneFromContactMap(name, contactResult);
    if (!resolved || !resolved.phone) return;
    if (!dept.contacts[name] || cleanPhone(dept.contacts[name]) !== cleanPhone(resolved.phone)) {
      dept.contacts[name] = resolved.phone;
      added += 1;
    }
  });
  return added;
}

async function hydrateBundledDeptContacts(deptKey='') {
  if (!deptKey) return;
  if (_bundledContactHydration.has(deptKey)) return _bundledContactHydration.get(deptKey);
  const task = (async () => {
    try {
      const text = await getRawPdfTextForDept(deptKey);
      if (!text) return;
      const contactResult = buildContactMapFromText(text);
      mergeResolvedContactsIntoDept(deptKey, contactResult);
    } catch (err) {
      console.warn('Bundled contact hydration failed:', deptKey, err);
    }
  })();
  _bundledContactHydration.set(deptKey, task);
  return task;
}

function buildPediatricsPage3ContactMap(text='') {
  const map = {};
  const altMap = {};
  const lines = String(text || '').split(/\n/).map(line => line.trim()).filter(Boolean);
  lines.forEach(line => {
    const residentMatch = line.match(/\b([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,3})\s+(5\d{8})\b/);
    if (residentMatch) {
      const name = residentMatch[1].trim();
      const phone = cleanPhone(`0${residentMatch[2]}`);
      if (name && phone) {
        map[name] = phone;
        altMap[normalizeText(name.replace(/^Dr\.?\s*/i, ''))] = phone;
      }
    }
  });
  return { map, altMap };
}

async function hydrateBundledPediatricsContacts() {
  if (_bundledContactHydration.has('pediatrics')) return _bundledContactHydration.get('pediatrics');
  const task = (async () => {
    try {
      const text = await getRawPdfTextForDept('pediatrics');
      if (!text) return;
      const generic = buildContactMapFromText(text);
      const page3 = buildPediatricsPage3ContactMap(text);
      const merged = {
        map: { ...(generic?.map || {}), ...(page3?.map || {}) },
        altMap: { ...(generic?.altMap || {}), ...(page3?.altMap || {}) },
      };
      mergeResolvedContactsIntoDept('pediatrics', merged);
    } catch (err) {
      console.warn('Bundled pediatrics contact hydration failed:', err);
    }
  })();
  _bundledContactHydration.set('pediatrics', task);
  return task;
}

async function ensureDeptSupportReady(deptKey='') {
  if (!deptKey) return;
  if (isImagingDeptKey(deptKey)) {
    await getLatestActivePdfRecord(deptKey);
    await hydrateBundledDeptContacts(deptKey);
    return;
  }
  if (deptKey === 'pediatrics') {
    await hydrateBundledPediatricsContacts();
    return;
  }
  if (deptKey === 'picu') {
    await hydrateBundledPicuSchedule();
    await hydrateBundledDeptContacts('picu');
    return;
  }
  await hydrateBundledDeptContacts(deptKey);
}


// resolvePhoneFromContactMap + buildAbbrLegend → now in parsers/generic.js
function mergeScheduleMaps(primary={}, fallback={}) {
  const merged = { ...primary };
  Object.entries(fallback || {}).forEach(([dateKey, rows]) => {
    const existing = (merged[dateKey] || []).map(entry => ({ ...entry }));
    const roleKeys = new Set(existing.map(entry => normalizeText(entry.role || '')));
    (rows || []).forEach(entry => {
      const roleKey = normalizeText(entry.role || '');
      if (!roleKeys.has(roleKey)) {
        existing.push({ ...entry });
        roleKeys.add(roleKey);
      }
    });
    merged[dateKey] = existing;
  });
  return merged;
}

async function hydrateBundledSurgerySchedule() {
  if (uploadedRecordForDept('surgery')) return;
  const sourceText = await getRawPdfTextForDept('surgery');
  if (!sourceText) return;
  const parsed = normalizeParsedEntries(splitMultiDoctorEntries(parseSurgeryPdfEntries(sourceText, 'surgery'), 'surgery'));
  const schedule = buildScheduleMapFromEntries(parsed);
  if (Object.keys(schedule).length >= 25) {
    ROTAS.surgery.schedule = mergeScheduleMaps(schedule, ROTAS.surgery.schedule || {});
  }
}

async function hydrateBundledHospitalistSchedule() {
  const uploaded = uploadedRecordForDept('hospitalist');
  if (uploaded && uploaded.parsedActive && uploaded.isActive !== false && !isLegacyHospitalistRecord(uploaded)) return;
  // Skip hydration if rotas.js already has a complete built-in schedule (avoids overwriting curated data with PDF re-parse)
  if (Object.keys(ROTAS.hospitalist?.schedule || {}).length >= 20) return;
  const sourceText = await getRawPdfTextForDept('hospitalist');
  if (!sourceText) return;
  const parsed = normalizeParsedEntries(splitMultiDoctorEntries(parseHospitalistPdfEntries(sourceText, 'hospitalist'), 'hospitalist'));
  const schedule = buildScheduleMapFromEntries(parsed);
  if (Object.keys(schedule).length >= 20) {
    ROTAS.hospitalist.schedule = schedule;
  }
}

async function hydrateBundledPicuSchedule() {
  const uploaded = uploadedRecordForDept('picu');
  if (uploaded && uploaded.parsedActive && uploaded.isActive !== false) return;
  const sourceText = await getRawPdfTextForDept('picu');
  if (!sourceText) return;
  const parsed = normalizeParsedEntries(splitMultiDoctorEntries(parsePicuPdfEntries(sourceText, 'picu'), 'picu'));
  const schedule = buildScheduleMapFromEntries(parsed);
  if (Object.keys(schedule).length >= 20) {
    ROTAS.picu.schedule = schedule;
  }
}

// ── DAY-SEQUENCE PARSER ───────────────────────────────────────

async function parseUploadedPdf(file, deptKey) {
  // ── Start server-side extraction IN PARALLEL with local text extraction ──
  // The server call only needs the raw file bytes, not the parsed text,
  // so we can overlap the two operations to save 200-800ms.
  const serverContactsPromise = (async () => {
    try {
      const buffer = await file.arrayBuffer();
      const b64 = btoa(new Uint8Array(buffer).reduce((s, b) => s + String.fromCharCode(b), ''));
      const resp = await fetch('/api/extract-contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pdf_base64: b64 }),
      });
      if (resp.ok) {
        const serverContacts = await resp.json();
        if (serverContacts && !serverContacts.error) return serverContacts;
      }
    } catch (err) {
      console.warn('[SERVER] Contact extraction failed, using client-side:', err.message);
    }
    return null;
  })();

  // Column-aware extraction for complex table layouts
  let columnarText = null;
  if (deptKey === 'liver') {
    try {
      const result = await extractLiverColumnarText(file);
      if (result && result.columnar) columnarText = result.text;
    } catch (err) { console.warn('Liver columnar extraction error:', err); }
  } else if (deptKey === 'medicine_on_call') {
    // Use server-side pdfplumber table extraction — proper column alignment, no DP token splitting
    try {
      const buffer = await file.arrayBuffer();
      const b64 = btoa(new Uint8Array(buffer).reduce((s, b) => s + String.fromCharCode(b), ''));
      // Compute SHA-256 hash for cache key
      let pdfHash = '';
      try {
        const hashBuf = await crypto.subtle.digest('SHA-256', buffer);
        pdfHash = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
      } catch (_) { /* hash failure → skip cache, call Claude */ }
      const resp = await fetch('/api/extract-medicine-oncall', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pdf_base64: b64 }),
      });
      if (resp.ok) {
        let rows = await resp.json();
        if (Array.isArray(rows) && rows.length) {
          console.log(`[MEDICINE_ONCALL] Server extracted ${rows.length} schedule rows`);
          // Use Claude API to resolve abbreviated names against the contact list
          const contacts = await serverContactsPromise.catch(() => null);
          if (contacts && Object.keys(contacts).length && !window._skipLlmCalls) {
            try {
              const llmResp = await fetch('/api/llm-parse-medicine-oncall', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ schedule_rows: rows, contacts, pdf_hash: pdfHash }),
              });
              if (llmResp.ok) {
                const llmData = await llmResp.json();
                const resolved = llmData.rows || llmData;
                if (Array.isArray(resolved) && resolved.length) {
                  rows = resolved.map(r => ({
                    date: r.date || '',
                    day: r.day || '',
                    jw_day: r.jw_day || '',
                    jw_night: r.jw_night || '',
                    jer_day: r.jer_day || '',
                    jer_night: r.jer_night || '',
                    sr_day: r.sr_day || '',
                    sr_night: r.sr_night || '',
                  }));
                  const src = llmData._fromCache ? '🔵 cached' : '🟢 claude';
                  console.log(`[MEDICINE_ONCALL] LLM resolved ${resolved.length} rows [${src}]`);
                  // Store cache status for UI badge
                  parseMedicineOnCallPdfEntries._lastCacheStatus = llmData._fromCache ? 'hit' : 'miss';
                }
              }
            } catch (llmErr) {
              console.warn('[MEDICINE_ONCALL] LLM name resolution failed, using pdfplumber names:', llmErr.message);
            }
          }
          parseMedicineOnCallPdfEntries._serverSchedule = rows;
          parseMedicineOnCallPdfEntries._lastPdfHash = pdfHash;
        }
      }
    } catch (err) {
      console.warn('[MEDICINE_ONCALL] Server schedule extraction failed, using client-side:', err.message);
    }
  } else if (deptKey === 'hospitalist') {
    // Use server-side pdfplumber table extraction — Oncology ER columns only
    try {
      const buffer = await file.arrayBuffer();
      const b64 = btoa(new Uint8Array(buffer).reduce((s, b) => s + String.fromCharCode(b), ''));
      const resp = await fetch('/api/extract-table', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pdf_base64: b64, specialty: 'hospitalist' }),
      });
      if (resp.ok) {
        const result = await resp.json();
        if (result.rows && result.rows.length) {
          console.log(`[HOSPITALIST] Server extracted ${result.rows.length} schedule rows`);
          parseHospitalistPdfEntries._serverSchedule = result.rows;
        }
      }
    } catch (err) {
      console.warn('[HOSPITALIST] Server schedule extraction failed, using client-side:', err.message);
    }
  } else if (deptKey === 'ent') {
    try {
      const buffer = await file.arrayBuffer();
      const b64 = btoa(new Uint8Array(buffer).reduce((s, b) => s + String.fromCharCode(b), ''));
      const resp = await fetch('/api/extract-table', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pdf_base64: b64, specialty: 'ent' }),
      });
      if (resp.ok) {
        const result = await resp.json();
        if (result.rows && result.rows.length) {
          console.log(`[ENT] Server extracted ${result.rows.length} schedule rows`);
          parseEntPdfEntries._serverSchedule = result.rows;
        }
      }
    } catch (err) {
      console.warn('[ENT] Server schedule extraction failed, using client-side:', err.message);
    }
  } else if (deptKey === 'pediatrics') {
    // Use server-side pdfplumber table extraction + Claude API for name resolution
    try {
      const buffer = await file.arrayBuffer();
      const b64 = btoa(new Uint8Array(buffer).reduce((s, b) => s + String.fromCharCode(b), ''));
      const resp = await fetch('/api/extract-table', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pdf_base64: b64, specialty: 'pediatrics' }),
      });
      if (resp.ok) {
        const result = await resp.json();
        let rows = (result.rows || []).filter(r => r.first_oncall || r.second_oncall || r.hospitalist_er || r.hospitalist_after);
        if (rows.length) {
          console.log(`[PEDIATRICS] Server extracted ${rows.length} schedule rows`);
          // Use Claude API to resolve abbreviated names against the contact list
          const contacts = await serverContactsPromise.catch(() => null);
          if (contacts && Object.keys(contacts).length && !window._skipLlmCalls) {
            try {
              const llmResp = await fetch('/api/llm-parse-pediatrics', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ schedule_rows: rows, contacts }),
              });
              if (llmResp.ok) {
                const resolved = await llmResp.json();
                if (Array.isArray(resolved) && resolved.length) {
                  rows = resolved.map(r => ({
                    date: r.date || '',
                    first_oncall: r.first_oncall || '',
                    second_oncall: r.second_oncall || '',
                    third_oncall: r.third_oncall || '',
                    hospitalist_er: r.hospitalist_er || '',
                    hospitalist_ward: r.hospitalist_ward || '',
                    hospitalist_after: r.hospitalist_after || '',
                  }));
                  console.log(`[PEDIATRICS] LLM resolved ${resolved.length} rows with full names`);
                }
              }
            } catch (llmErr) {
              console.warn('[PEDIATRICS] LLM name resolution failed, using pdfplumber names:', llmErr.message);
            }
          }
          parsePediatricsPdfEntries._serverSchedule = rows;
        }
      }
    } catch (err) {
      console.warn('[PEDIATRICS] Server schedule extraction failed, using client-side:', err.message);
    }
  } else if (deptKey === 'critical_care' || deptKey === 'oncology') {
    // PDF view only — schedule managed in ROTAS, skip extraction
    console.log(`[${deptKey.toUpperCase()}] PDF view only, schedule from ROTAS`);
  } else if (deptKey === 'gynecology' || deptKey === 'psychiatry' || deptKey === 'picu'
      || deptKey === 'pediatric_heme_onc' || deptKey === 'neurology') {
    // pdfplumber extraction via extract-table.py
    const extractKey = deptKey === 'picu' ? 'picu_extract' : deptKey === 'neurology' ? 'neurology_extract' : deptKey;
    try {
      const buffer = await file.arrayBuffer();
      const b64 = btoa(new Uint8Array(buffer).reduce((s, b) => s + String.fromCharCode(b), ''));
      const resp = await fetch('/api/extract-table', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pdf_base64: b64, specialty: extractKey }),
      });
      if (resp.ok) {
        const result = await resp.json();
        const rows = result.rows || [];
        if (rows.length) {
          console.log(`[${deptKey.toUpperCase()}] Extracted ${rows.length} rows via ${result.method || 'pdfplumber'}`);
          const dept = ROTAS[deptKey];
          if (dept) {
            dept.schedule = dept.schedule || {};
            for (const row of rows) {
              const dateKey = row.date || '';
              if (!dateKey) continue;
              const cols = result.columns || [];
              const entries = cols.map(col => {
                const name = (row[col] || '').trim();
                if (!name) return null;
                return { role: col.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()), name, shiftType: '24h', startTime: '07:30', endTime: '07:30', parsedFromPdf: true };
              }).filter(Boolean);
              if (entries.length) dept.schedule[dateKey] = entries;
            }
          }
        }
      }
    } catch (err) {
      console.warn(`[${deptKey.toUpperCase()}] Extraction failed, using ROTAS built-in:`, err.message);
    }
  } else if (deptKey === 'orthopedics' || deptKey === 'spine' || deptKey === 'neurosurgery') {
    try {
      const buffer = await file.arrayBuffer();
      const b64 = btoa(new Uint8Array(buffer).reduce((s, b) => s + String.fromCharCode(b), ''));
      const resp = await fetch('/api/extract-table', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pdf_base64: b64, specialty: deptKey }),
      });
      if (resp.ok) {
        const result = await resp.json();
        if (result.rows && result.rows.length) {
          console.log(`[${deptKey.toUpperCase()}] Server extracted ${result.rows.length} schedule rows`);
          const parser = deptKey === 'orthopedics' ? parseOrthopedicsPdfEntries
            : deptKey === 'spine' ? parseSpinePdfEntries
            : parseNeurosurgeryPdfEntries;
          parser._serverSchedule = result.rows;
        }
      }
    } catch (err) {
      console.warn(`[${deptKey.toUpperCase()}] Server schedule extraction failed, using client-side:`, err.message);
    }
  } else if (deptKey === 'radiology_oncall') {
    // Use server-side pdfplumber table extraction — handles empty cells and column alignment correctly
    try {
      const buffer = await file.arrayBuffer();
      const b64 = btoa(new Uint8Array(buffer).reduce((s, b) => s + String.fromCharCode(b), ''));
      const resp = await fetch('/api/extract-radiology-oncall', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pdf_base64: b64 }),
      });
      if (resp.ok) {
        let rows = await resp.json();
        if (Array.isArray(rows) && rows.length) {
          console.log(`[RADIOLOGY_ONCALL] Server extracted ${rows.length} schedule rows`);
          // Use Claude API to resolve abbreviated names against the contact list
          const contacts = await serverContactsPromise.catch(() => null);
          if (contacts && Object.keys(contacts).length && !window._skipLlmCalls) {
            try {
              const llmResp = await fetch('/api/llm-parse-radiology-oncall', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ schedule_rows: rows, contacts }),
              });
              if (llmResp.ok) {
                const resolved = await llmResp.json();
                if (Array.isArray(resolved) && resolved.length) {
                  // Validate LLM names: if pdfplumber had a full name (2+ words)
                  // and LLM returned a different last name, keep pdfplumber's version
                  const origByDate = {};
                  rows.forEach(r => { origByDate[r.date + (r.shift||'')] = r; });
                  rows = resolved.map(r => {
                    const orig = origByDate[r.date + (r.shift||'')] || {};
                    const validate = (field) => {
                      const llmName = (r[field] || '').replace(/^Dr\.?\s*/i, '').trim();
                      const origName = (orig[field] || '').trim();
                      if (!llmName || !origName) return r[field] || '';
                      const origWords = origName.split(/\s+/);
                      const llmWords = llmName.split(/\s+/);
                      // If original has 2+ words (full name) and LLM changed the last name entirely, reject
                      if (origWords.length >= 2 && llmWords.length >= 2) {
                        const origLast = origWords[origWords.length - 1].toLowerCase().replace(/^al/i, '');
                        const llmLast = llmWords[llmWords.length - 1].toLowerCase().replace(/^al/i, '');
                        if (origLast.length >= 3 && llmLast.length >= 3 && origLast !== llmLast
                            && !origLast.startsWith(llmLast) && !llmLast.startsWith(origLast)) {
                          console.warn(`[RADIOLOGY_ONCALL] LLM changed last name: ${origName} → ${llmName}, keeping original`);
                          return origName;
                        }
                      }
                      return r[field] || '';
                    };
                    return {
                      date: r.date || '', day: r.day || '', shift: r.shift || '',
                      first: validate('first'), second: validate('second'), third: validate('third'),
                    };
                  });
                  console.log(`[RADIOLOGY_ONCALL] LLM resolved ${resolved.length} rows with full names`);
                }
              }
            } catch (llmErr) {
              console.warn('[RADIOLOGY_ONCALL] LLM name resolution failed, using pdfplumber names:', llmErr.message);
            }
          }
          parseRadiologyOnCallPdfEntries._serverSchedule = rows;
        }
      }
    } catch (err) {
      console.warn('[RADIOLOGY_ONCALL] Server schedule extraction failed, using client-side:', err.message);
    }
  } else if (deptKey === 'surgery') {
    // Use server-side pdfplumber table extraction — handles empty cells correctly
    try {
      const buffer = await file.arrayBuffer();
      const b64 = btoa(new Uint8Array(buffer).reduce((s, b) => s + String.fromCharCode(b), ''));
      const resp = await fetch('/api/extract-surgery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pdf_base64: b64 }),
      });
      if (resp.ok) {
        let rows = await resp.json();
        if (Array.isArray(rows) && rows.length) {
          console.log(`[SURGERY] Server extracted ${rows.length} schedule rows`);
          // Wait for contacts, then use Claude API to resolve abbreviated names
          const contacts = await serverContactsPromise.catch(() => null);
          if (contacts && Object.keys(contacts).length && !window._skipLlmCalls) {
            try {
              const llmResp = await fetch('/api/llm-parse-surgery', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ schedule_rows: rows, contacts }),
              });
              if (llmResp.ok) {
                const resolved = await llmResp.json();
                if (Array.isArray(resolved) && resolved.length) {
                  rows = resolved.map(r => ({
                    date: r.date || '',
                    jr_er: r.jr_er || '',
                    sr_er: r.sr_er || '',
                    gs_assoc: r.gs_assoc || '',
                    gs_consult: r.gs_consult || '',
                  }));
                  console.log(`[SURGERY] LLM resolved ${resolved.length} rows with full names`);
                }
              }
            } catch (llmErr) {
              console.warn('[SURGERY] LLM name resolution failed, using pdfplumber names:', llmErr.message);
            }
          }
          // Tab-separated schedule lines + plain text for contact extraction
          const schedLines = rows.map(r => `${r.date}\t${r.jr_er}\t${r.sr_er}\t${r.gs_assoc}\t${r.gs_consult}`);
          const plainText = await extractPdfText(file);
          columnarText = schedLines.join('\n') + '\n\n' + plainText;
        }
      }
    } catch (err) {
      console.warn('[SURGERY] Server extraction failed, using client-side:', err.message);
    }
  }
  const text = columnarText || await extractPdfText(file);

  // ── Wait for server contacts before parsing (parser may use them) ──
  const serverContacts = await serverContactsPromise;
  if (serverContacts) {
    window._serverExtractedContacts = serverContacts;
    if (typeof parseRadiologyOnCallPdfEntries !== 'undefined') parseRadiologyOnCallPdfEntries._serverContacts = serverContacts;
    console.log(`[SERVER] Extracted ${Object.keys(serverContacts).length} contacts for ${deptKey}`);
  }

  let parsed;
  let parserMode = 'generic';
  let parserMeta = { templateDetected: false };

  // Use registry for parser dispatch
  const strategy = getParserForDept(deptKey, file.name);
  if (strategy) {
    const result = strategy(text, deptKey);
    parsed = result.entries;
    parserMode = result.parserMode;
    parserMeta = result.meta || parserMeta;
  } else {
    parsed = parseGenericPdfEntries(text, deptKey);
  }

  // Clean up server data after use
  if (deptKey === 'radiology_oncall' && typeof parseRadiologyOnCallPdfEntries !== 'undefined') {
    delete parseRadiologyOnCallPdfEntries._serverContacts;
    delete parseRadiologyOnCallPdfEntries._serverSchedule;
  }
  if (deptKey === 'medicine_on_call' && typeof parseMedicineOnCallPdfEntries !== 'undefined') {
    delete parseMedicineOnCallPdfEntries._serverSchedule;
  }
  if (deptKey === 'hospitalist' && typeof parseHospitalistPdfEntries !== 'undefined') {
    delete parseHospitalistPdfEntries._serverSchedule;
  }
  if (deptKey === 'ent' && typeof parseEntPdfEntries !== 'undefined') {
    delete parseEntPdfEntries._serverSchedule;
  }
  if (deptKey === 'orthopedics' && typeof parseOrthopedicsPdfEntries !== 'undefined') {
    delete parseOrthopedicsPdfEntries._serverSchedule;
  }
  if (deptKey === 'spine' && typeof parseSpinePdfEntries !== 'undefined') {
    delete parseSpinePdfEntries._serverSchedule;
  }
  if (deptKey === 'neurosurgery' && typeof parseNeurosurgeryPdfEntries !== 'undefined') {
    delete parseNeurosurgeryPdfEntries._serverSchedule;
  }
  if (deptKey === 'pediatrics' && typeof parsePediatricsPdfEntries !== 'undefined') {
    delete parsePediatricsPdfEntries._serverSchedule;
  }
  // Clear global server contacts to prevent cross-specialty contamination
  delete window._serverExtractedContacts;

  const parseDebug = {
    templateDetected: !!parserMeta.templateDetected,
    coreSectionsFound: parserMeta.coreSectionsFound || [],
    templateName: parserMeta.templateName || '',
    parserMode,
  };

  let normalizedEntries = normalizeParsedEntries(splitMultiDoctorEntries(
    Array.isArray(parsed) ? parsed : (parsed || []),
    deptKey
  ));
  // For medicine_on_call, splitMultiDoctorEntries/normalizeParsedEntries can create
  // duplicate entries per (date, section, shiftType) slot when a name contains "/"
  // or comma (e.g. the parser assigned "Name1/Name2" to a slot and the post-process
  // split it into two). Keep only the first entry per slot — the parser already
  // assigned names correctly.
  if (deptKey === 'medicine_on_call') {
    const slotsSeen = new Set();
    normalizedEntries = normalizedEntries.filter(entry => {
      const slot = `${entry.date}|${entry.section}|${entry.shiftType}`;
      if (slotsSeen.has(slot)) return false;
      slotsSeen.add(slot);
      return true;
    });
  }
  return {
    rawText: text,
    textSample: text.slice(0, 4000),
    debug: parseDebug,
    entries: normalizedEntries,
  };
}

async function detectDeptKeyFromPdf(file) {
  // 1. Try filename first — it's the most reliable signal
  const fromName = detectDeptFromText(file.name, 'filename');
  if (fromName.deptKey) return fromName;
  // 2. Try PDF.js content extraction for specialty detection
  try {
    const detectionText = await readPdfDetectionText(file);
    const fromContent = detectDeptFromText(detectionText, 'content');
    if (fromContent.deptKey) return fromContent;
  } catch (err) {
    console.warn('PDF content detection failed:', err);
  }
  return { deptKey: null, source: 'unknown', uncertain: true, score: 0 };
}

function isAnesthesiaLike(text='') {
  return /anesth|anaesth|anesthesia|anaesthesia|تخدير/i.test(text);
}


// Rota data lives in assets/js/data/rotas.js so it can later be replaced by an API-backed data source.

// ═══════════════════════════════════════════════════════════════
// SPECIAL: Radiology On-Duty — dynamic by day-of-week
// ═══════════════════════════════════════════════════════════════
const RADIOLOGY_ALIAS_TO_FULL = {
  'h muhaish':'Dr. Husam Al Muhaish',
  'h arfaj':'Dr. Husain Al Arfaj',
  'f bosaid':'Dr. Fajer Bosaid',
  'e momen':'Dr. Eman Al Momen',
  'a abdulgader':'Dr. Abdulrahman AlAbdulgader',
  'h aboras':'Dr. Hana Aboras',
  'k balawi':'Dr. Khalid Balawi',
  't saied':'Dr. Tarek Saied',
  's mahmoud':'Dr. Safaa Mahmoud',
  'h ismail':'Dr. Huda Ismail',
  'a dhafiri':'Dr. Ahmed Al Dhafiri',
  's shaibani':'Dr. Sara Shaibani',
  'a zaher':'Dr. Asrar Al Zaher',
  'r namasy':'Dr. Rawan Al Namasy',
  's enezi':'Dr. Salma Al Enezi',
  'a buali':'Dr. Ahmed Al Buali',
  'a naim':'Dr. Abdulrahman Naim',
  'a mohammed':'Dr. Adel Mohammed'
};

const ULTRASOUND_DUTY_BY_DAY = {
  mon:[
    {role:'Ultrasound - Abdomen Consultant', name:'Dr. Tarek Saied', coverage:'Abdomen'},
    {role:'Ultrasound - Abdomen Resident/Fellow', name:'Abdullah Al Mujaljal', coverage:'Abdomen'},
    {role:'Ultrasound - MSK Consultant', name:'Dr. Ahmed Al Dhafiri', coverage:'MSK'},
    {role:'Ultrasound - MSK Fellow', name:'Fatimah Albahhar', coverage:'MSK'}
  ],
  tue:[
    {role:'Ultrasound - Abdomen Consultant', name:'Dr. Adel Mohammed', coverage:'Abdomen'},
    {role:'Ultrasound - Abdomen Consultant', name:'Dr. Tarek Saied', coverage:'Abdomen'},
    {role:'Ultrasound - Abdomen Fellow', name:'Ibtihal S', coverage:'Abdomen'},
    {role:'Ultrasound - MSK Consultant', name:'Dr. Ahmed Al Dhafiri', coverage:'MSK'},
    {role:'Ultrasound - MSK Fellow', name:'Fatimah Albahhar', coverage:'MSK'}
  ],
  wed:[
    {role:'Ultrasound - Abdomen Consultant', name:'Dr. Safaa Mahmoud', coverage:'Abdomen'},
    {role:'Ultrasound - Abdomen Consultant', name:'Dr. Tarek Saied', coverage:'Abdomen'},
    {role:'Ultrasound - MSK Consultant', name:'Dr. Ahmed Al Dhafiri', coverage:'MSK'},
    {role:'Ultrasound - MSK Fellow', name:'Fatimah Albahhar', coverage:'MSK'}
  ],
  thu:[
    {role:'Ultrasound - Abdomen Consultant', name:'Dr. Tarek Saied', coverage:'Abdomen'},
    {role:'Ultrasound - Abdomen Consultant', name:'Dr. Adel Mohammed', coverage:'Abdomen'},
    {role:'Ultrasound - MSK Consultant', name:'Dr. Ahmed Al Dhafiri', coverage:'MSK'},
    {role:'Ultrasound - MSK Fellow', name:'Fatimah Albahhar', coverage:'MSK'}
  ],
  fri:[
    {role:'Ultrasound - Abdomen Consultant', name:'Dr. Adel Mohammed', coverage:'Abdomen'},
    {role:'Ultrasound - MSK Consultant', name:'Dr. Ahmed Al Dhafiri', coverage:'MSK'},
    {role:'Ultrasound - MSK Fellow', name:'Fatimah Albahhar', coverage:'MSK'}
  ],
  sat:[],
  sun:[]
};

const RADIOLOGY_DUTY_NEURO_ER_OVERRIDE = {
  '05/04': { residents:['Rawan Alanezi','Mohammed Al Saffar','Abdulrahman Alshammari'], consultant:'Dr. Rami Hazmi' },
  '06/04': { residents:['Rawan Alanezi','Mohammed Al Saffar','Abdulrahman Alshammari'], consultant:'Dr. Rami Hazmi' },
  '07/04': { residents:['Rawan Alanezi','Mohammed Al Saffar','Abdulrahman Alshammari'], consultant:'Dr. Rami Hazmi' },
  '08/04': { residents:['Rawan Alanezi','Mohammed Al Saffar','Abdulrahman Alshammari'], consultant:'Dr. Rami Hazmi' },
  '09/04': { residents:['Rawan Alanezi','Mohammed Al Saffar','Abdulrahman Alshammari'], consultant:'Dr. Rami Hazmi' },
};

const RADIOLOGY_DUTY_MODALITY_OVERRIDES = {
  '15/04': {
    ct_neuro_er: [
      { name:'Abdulrahman Alshammari', role:'Resident', section:'CT Neuro (ER)' },
      { name:'Dr. Mohammad Al Faifi', role:'Fellow / Assistant', section:'CT Neuro (ER)' },
      { name:'N. Alkhatib', role:'Fellow / Assistant', section:'CT Neuro (ER)' },
      { name:'Dr. Nourah Almakhaitah', role:'Fellow / Assistant', section:'CT Neuro (ER)' },
      { name:'Dr. Rasees Al Otaibi', role:'Pediatric', section:'CT Neuro (ER)' },
      { name:'Dr. Abdullah Al Suwailem', role:'Consultant', section:'CT Neuro (ER)' },
    ],
    ct_pe: [
      { name:'Mohammed Al Ibrahim', role:'Fellow / Assistant', section:'Thoracic CT/MRI (In-Pt & ER)' },
      { name:'Fatimah Albahhar', role:'Fellow / Assistant', section:'Thoracic CT/MRI (In-Pt & ER)' },
      { name:'Dr. Ahmed Al Dhafiri', role:'Consultant', section:'Thoracic CT/MRI (In-Pt & ER)' },
    ],
    ct_abdomen: [
      { name:'Sokaina Al Khuder', role:'Resident', section:'CT (In-Patient & ER)' },
      { name:'Mohammed Al Anaki', role:'Resident', section:'CT (In-Patient & ER)' },
      { name:'Dr. Hana Aboras', role:'Consultant', section:'CT (In-Patient & ER)' },
    ],
    us_abdomen: [
      { name:'Dr. Mawaheb Kalalah', role:'Consultant', section:'Body Ultrasound' },
      { name:'Dr. Adel Mohammed', role:'Consultant', section:'Body Ultrasound' },
    ],
  },
};

function expandRadiologyNames(raw='') {
  return raw.split('/').map(s => s.trim()).filter(Boolean).map(part => {
    const key = part.toLowerCase().replace(/\./g,'').replace(/\([^)]*\)/g,'').replace(/\s+/g,' ').trim();
    return RADIOLOGY_ALIAS_TO_FULL[key] || part.trim();
  });
}

function getRadiologyDutyNeuroErEntries(schedKey) {
  const dept = ROTAS.radiology_duty;
  const override = RADIOLOGY_DUTY_NEURO_ER_OVERRIDE[schedKey];
  if (!override) return [];
  const rows = [];
  override.residents.forEach(name => {
    const phoneMeta = resolvePhone(dept, { name, phone:'' }) || resolveRadiologyDutyPhone(name, dept);
    rows.push({
      role:'Resident',
      section:'CT Neuro (ER)',
      coverage:'ER',
      name,
      phone: phoneMeta.phone || '',
      phoneUncertain: !phoneMeta.phone || !!phoneMeta.uncertain,
    });
  });
  if (override.consultant) {
    const phoneMeta = resolvePhone(dept, { name: override.consultant, phone:'' }) || resolveRadiologyDutyPhone(override.consultant, dept);
    rows.push({
      role:'Consultant',
      section:'CT Neuro (ER)',
      coverage:'ER',
      name: override.consultant,
      phone: phoneMeta.phone || '',
      phoneUncertain: !phoneMeta.phone || !!phoneMeta.uncertain,
    });
  }
  return rows.map(entry => ({ ...entry, sourceBucket:'er' }));
}

function getRadiologyDutyModalityOverrideEntries(schedKey, intent='') {
  const dept = ROTAS.radiology_duty;
  const rows = RADIOLOGY_DUTY_MODALITY_OVERRIDES[schedKey]?.[intent] || [];
  if (!rows.length) return [];
  return rows.map(row => {
    const phoneMeta = resolvePhone(dept, { name: row.name, phone:'' }) || resolveRadiologyDutyPhone(row.name, dept);
    return {
      specialty: 'radiology_duty',
      date: schedKey,
      shiftType: 'on-duty',
      startTime: '07:30',
      endTime: '16:30',
      parsedFromPdf: true,
      sourceBucket: 'daily-override',
      ...row,
      phone: phoneMeta.phone || '',
      phoneUncertain: !phoneMeta.phone || !!phoneMeta.uncertain,
    };
  });
}

function pickPreferredRadiologyDutyEntry(current, candidate, dept=ROTAS.radiology_duty) {
  if (!current) return candidate;
  const currentPhone = resolvePhone(dept, current) || { phone: '', uncertain: true };
  const candidatePhone = resolvePhone(dept, candidate) || { phone: '', uncertain: true };
  const currentScore = (currentPhone.phone ? 2 : 0) + (currentPhone.phone && !currentPhone.uncertain ? 1 : 0) + String(current.name || '').length;
  const candidateScore = (candidatePhone.phone ? 2 : 0) + (candidatePhone.phone && !candidatePhone.uncertain ? 1 : 0) + String(candidate.name || '').length;
  return candidateScore >= currentScore ? candidate : current;
}

function dedupeRadiologyDutyLiveEntries(entries=[]) {
  const dept = ROTAS.radiology_duty;
  const seen = new Map();
  entries.forEach(entry => {
    const phoneMeta = resolvePhone(dept, entry) || { phone: '', uncertain: true };
    const key = [
      canonicalName(entry.name || ''),
      normalizeText(entry.role || ''),
      normalizeText(entry.section || ''),
      entry.date || '',
      entry.startTime || '',
      entry.endTime || '',
      cleanPhone(phoneMeta.phone || ''),
    ].join('|');
    const existing = seen.get(key);
    seen.set(key, pickPreferredRadiologyDutyEntry(existing, entry, dept));
  });
  return [...seen.values()];
}

function getRadiologyDutyUploadedEntriesForIntent(schedKey, now, qLow='') {
  const record = refreshUploadedRecordIfNeeded(uploadedRecordForDept('radiology_duty'));
  if (!record || !record.parsedActive || !Array.isArray(record.entries) || !record.entries.length) {
    const cachedRecord = uploadedPdfRecords.get('radiology_duty') || null;
    const cachedReasons = getUploadRecordBlockReasons(cachedRecord);
    radiologyDutyTrace.lastSearch = {
      at: new Date().toISOString(),
      query: qLow || '',
      schedKey,
      source: 'none',
      reason: cachedReasons.length ? cachedReasons.join(',') : 'no-active-upload-record',
      recordName: cachedRecord?.name || '',
      rowCount: 0,
    };
    return null;
  }
  if (record.review && (record.review.parsing || record.review.auditRejected)) {
    radiologyDutyTrace.lastSearch = {
      at: new Date().toISOString(),
      query: qLow || '',
      schedKey,
      source: 'uploaded-record',
      recordName: record.name || '',
      reason: 'upload-review-block',
      rowCount: 0,
    };
    return [];
  }
  const deptEntries = record.entries.filter(entry =>
    !entry.specialty || entry.specialty === 'radiology_duty' || record.deptKey === 'radiology_duty'
  );
  const dated = deptEntries.filter(entry => !entry.date || entry.date === schedKey || entry.date === 'dynamic-weekday');
  const base = dated.length ? dated : deptEntries.filter(entry => !entry.date);
  if (!base.length) return [];
  if (base.some(isNoCoverageEntry)) return base.filter(isNoCoverageEntry);
  const intent = radiologyQueryIntent(qLow);
  const modalityOverride = getRadiologyDutyModalityOverrideEntries(schedKey, intent);
  if (modalityOverride.length) {
    const dedupedOverride = dedupeRadiologyDutyLiveEntries(modalityOverride);
    radiologyDutyTrace.lastSearch = {
      at: new Date().toISOString(),
      query: qLow || '',
      schedKey,
      source: 'uploaded-record',
      recordName: record.name || '',
      intent,
      reason: 'daily-modality-override',
      rowCountBeforeDedupe: modalityOverride.length,
      rowCountAfterDedupe: dedupedOverride.length,
      rows: dedupedOverride.map(entry => ({
        name: entry.name || '',
        role: entry.role || '',
        section: entry.section || '',
        phone: entry.phone || '',
        date: entry.date || '',
      })),
    };
    return dedupedOverride;
  }
  const filtered = filterRadiologyDutyByIntent(base.map(cloneEntry), intent);
  const deduped = dedupeRadiologyDutyLiveEntries(filtered);
  radiologyDutyTrace.lastSearch = {
    at: new Date().toISOString(),
    query: qLow || '',
    schedKey,
    source: 'uploaded-record',
    recordName: record.name || '',
    intent,
    rowCountBeforeDedupe: filtered.length,
    rowCountAfterDedupe: deduped.length,
    rows: deduped.map(entry => ({
      name: entry.name || '',
      role: entry.role || '',
      section: entry.section || '',
      phone: entry.phone || '',
      date: entry.date || '',
    })),
  };
  return deduped;
}

function getDutyRadiologyEntries(now) {
  const days = ['sun','mon','tue','wed','thu','fri','sat'];
  const day = days[now.getDay()];
  const dc = ROTAS.radiology_duty.duty_consultants;
  const entries = [];
  for (const [section, byDay] of Object.entries(dc)) {
    const who = byDay[day];
    if (who && who.trim()) {
      expandRadiologyNames(who).forEach(name => entries.push({ role:'On-Duty Radiologist', section, name }));
    }
  }
  return entries;
}

function minuteOfDay(d) {
  return d.getHours() * 60 + d.getMinutes();
}

function getRadiologyShiftWindows(now) {
  const mins = minuteOfDay(now);
  if (isSpecialtyActiveNow('radiology_oncall', now) && !isSpecialtyActiveNow('radiology_duty', now)) {
    return [{ key:'radiology_oncall', ...getSpecialtyCurrentShiftMeta('radiology_oncall', now) }];
  }
  const day = now.getDay();
  if (day === 5 || day === 6) {
    return [{ key:'radiology_oncall', label:'Current Shift', time:'07:30-07:30' }];
  }
  if (mins >= 15 * 60 + 30 && mins < 16 * 60 + 30) {
    return [
      { key:'radiology_duty', label:'Current Shift', time:'07:30-16:30' },
      { key:'radiology_oncall', label:'Upcoming Shift', time:'16:30-07:30' },
    ];
  }
  if (mins >= 6 * 60 + 30 && mins < 7 * 60 + 30) {
    return [
      { key:'radiology_oncall', label:'Current Shift', time:'16:30-07:30' },
      { key:'radiology_duty', label:'Upcoming Shift', time:'07:30-16:30' },
    ];
  }
  if (mins >= 7 * 60 + 30 && mins < 16 * 60 + 30) {
    return [{ key:'radiology_duty', label:'Current Shift', time:'07:30-16:30' }];
  }
  return [{ key:'radiology_oncall', label:'Current Shift', time:'16:30-07:30' }];
}

function radiologyQueryIntent(qLow='') {
  const q = normalizeText(qLow);
  const tokens = q.split(' ').filter(Boolean);
  const has = (...words) => words.some(word => tokens.includes(word));
  const phrase = (...words) => words.some(word => q.includes(normalizeText(word)));
  if ((has('us','ultrasound','sono','sonar') || phrase('سونار','التراساوند','ألتراساوند')) && has('msk','musculoskeletal')) return 'us_msk';
  if ((has('us','ultrasound','sono','sonar') || phrase('سونار','التراساوند','ألتراساوند')) && has('abd','abdomen','abdominal')) return 'us_abdomen';
  if (has('us','ultrasound','sono','sonar') || phrase('سونار','التراساوند','ألتراساوند')) return 'us';
  if (phrase('pet ct','pet-ct') || (has('pet') && has('ct')) || has('nuclear')) return 'nuclear';
  if ((has('ct') && has('pe','pulmonary','chest','thoracic')) || phrase('ct pe','ct chest','thoracic ct')) return 'ct_pe';
  if ((has('ct') && has('brain','head','neuro','stroke')) || phrase('ct brain','ct neuro','neuro ct')) return 'ct_neuro_er';
  if (has('ct') && has('abd','abdomen','abdominal')) return 'ct_abdomen';
  if (has('ct')) return 'ct';
  return 'all';
}

function getRadiologyUltrasoundEntries(now, intent) {
  const days = ['sun','mon','tue','wed','thu','fri','sat'];
  const day = days[now.getDay()];
  const entries = ULTRASOUND_DUTY_BY_DAY[day] || [];
  if (intent === 'us_msk') return entries.filter(entry => normalizeText(entry.coverage).includes('msk') || normalizeText(entry.role).includes('msk'));
  if (intent === 'us_abdomen') return entries.filter(entry => normalizeText(entry.coverage).includes('abdomen') || normalizeText(entry.role).includes('abdomen'));
  return entries;
}

function filterRadiologyDutyByIntent(entries, intent) {
  if (intent === 'all') return entries;
  const sectionText = entry => normalizeText([entry.section || '', entry.role || '', entry.coverage || ''].join(' '));
  const hasSection = (entry, words) => words.some(word => sectionText(entry).includes(normalizeText(word)));
  const sectionIs = (entry, sections=[]) => sections.some(section => normalizeText(entry.section || '') === normalizeText(section));
  if (intent === 'nuclear') return entries.filter(entry => hasSection(entry, ['nuclear','pet']));
  if (intent === 'us_msk') return entries.filter(entry => sectionIs(entry, ['Ultrasound - MSK']));
  if (intent === 'us_abdomen') return entries.filter(entry => sectionIs(entry, ['Body Ultrasound', 'Ultrasound - Abdomen']));
  if (intent === 'us') return entries.filter(entry => sectionIs(entry, ['Body Ultrasound', 'Ultrasound - Abdomen', 'Ultrasound - MSK', 'Breast In Pt. & Emergency']));
  if (intent === 'ct_neuro_er') return entries.filter(entry => sectionIs(entry, ['CT Neuro (ER)']));
  if (intent === 'ct_neuro') return entries.filter(entry => hasSection(entry, ['neuro']) && hasSection(entry, ['ct']));
  if (intent === 'ct_pe') return entries.filter(entry => sectionIs(entry, ['Thoracic CT/MRI (In-Pt & ER)']));
  if (intent === 'ct_abdomen') return entries.filter(entry => sectionIs(entry, ['CT (In-Patient & ER)']));
  if (intent === 'ct') return entries.filter(entry => sectionIs(entry, ['CT Neuro (ER)', 'CT - Neuro', 'CT (In-Patient & ER)', 'Thoracic CT/MRI (In-Pt & ER)']));
  return entries;
}

function getRadiologyDutyEntriesForIntent(now, schedKey, qLow='') {
  const uploadedEntries = getRadiologyDutyUploadedEntriesForIntent(schedKey, now, qLow);
  if (uploadedEntries) return uploadedEntries;
  const intent = radiologyQueryIntent(qLow);
  if (intent === 'ct_neuro_er') {
    const override = getRadiologyDutyNeuroErEntries(schedKey);
    if (override.length) return override;
  }
  if (intent === 'us' || intent === 'us_msk' || intent === 'us_abdomen') return getRadiologyUltrasoundEntries(now, intent);
  const fallbackRows = filterRadiologyDutyByIntent(getDutyRadiologyEntries(now), intent);
  radiologyDutyTrace.lastSearch = {
    at: new Date().toISOString(),
    query: qLow || '',
    schedKey,
    source: 'built-in-fallback',
    intent,
    rowCountAfterDedupe: fallbackRows.length,
    rows: fallbackRows.map(entry => ({
      name: entry.name || '',
      role: entry.role || '',
      section: entry.section || '',
      phone: entry.phone || '',
      date: entry.date || '',
    })),
  };
  return fallbackRows;
}

function getRadiologyOnCallEntriesForDate(schedKey, now) {
  const raw = ROTAS.radiology_oncall.schedule[schedKey] || [];
  const dept = ROTAS.radiology_oncall;
  // Only show numbered On-Call roles (1st, 2nd, 3rd)
  const onCallRe = /^(1st|2nd|3rd)\s+On-Call/i;
  const timeRangeRe = /\((\d{2}:\d{2})[–-](\d{2}:\d{2})\)/;
  const nowMins = now ? now.getHours() * 60 + now.getMinutes() : -1;

  const filtered = raw.filter(entry => {
    if (!onCallRe.test(entry.role || '')) return false;
    // Filter by current time for weekend AM/PM splits
    const tm = (entry.role || '').match(timeRangeRe);
    if (!tm || nowMins < 0) return true; // no time range = always show
    const [sh, sm] = tm[1].split(':').map(Number);
    const [eh, em] = tm[2].split(':').map(Number);
    const startMins = sh * 60 + sm;
    const endMins = eh * 60 + em;
    // Handle overnight shifts (e.g. 19:30–07:30)
    if (startMins <= endMins) return nowMins >= startMins && nowMins < endMins;
    return nowMins >= startMins || nowMins < endMins;
  }).flatMap(entry => {
    // Strip time qualifier from role — only the active shift is shown
    const role = (entry.role || '').replace(/\s*\([^)]*\)\s*$/, '');
    if (!role) return [];

    const names = splitPossibleNames(entry.name || '');
    if (!names.length) return [{ ...entry, role }];
    return names.map(name => {
      const phoneMeta = resolvePhone(dept, { name, phone:'' }) || { phone:'', uncertain:true };
      return {
        ...entry,
        name,
        role,
        phone: phoneMeta.phone || '',
        phoneUncertain: phoneMeta.uncertain,
      };
    });
  });
  return filtered;
}

function withRadiologyShiftMeta(entries, shift) {
  return entries.map(entry => ({
    ...entry,
    shiftLabel: shift.label,
    shiftTime: shift.time,
    sourceKey: shift.key,
  }));
}

function formatShiftTimeLabel(time='') {
  return String(time || '').replace('-', ' – ');
}

function getRadiologyForcedBannerHtml(deptKey, now=new Date()) {
  const shift = getSpecialtyCurrentShiftMeta(deptKey, now);
  if (deptKey === 'radiology_oncall') {
    return `⚠️ <strong>On-Call Shift (${formatShiftTimeLabel(shift.time)})</strong> — Showing the clicked radiology on-call team only.`;
  }
  return `⚠️ <strong>On-Duty Shift (${formatShiftTimeLabel(shift.time)})</strong> — Showing the clicked radiology on-duty team only.`;
}

function getRadiologyEntries(schedKey, now, qLow='') {
  return getRadiologyShiftWindows(now).flatMap(shift => {
    if (shift.key === 'radiology_duty') {
      return withRadiologyShiftMeta(getRadiologyDutyEntriesForIntent(now, schedKey, qLow), shift);
    }
    return withRadiologyShiftMeta(getRadiologyOnCallEntriesForDate(schedKey, now), shift);
  });
}

// Radiology uses explicit duty/on-call rules; other specialties use active role filters.
// Specialties whose built-in schedule in rotas.js is manually verified
// and should NOT be overridden by uploaded PDF data (parser can misparse names).
const BUILTIN_PRIORITY_DEPTS = new Set(['neurology']);

// Sprint 5 (H11): Registry-based specialty dispatch.
// Each specialty registers its built-in resolver. New specialties only need an entry here.
// The default resolver uses filterActiveEntriesV2 — works for simple on-call schedules.
const SPECIALTY_RESOLVERS = {
  medicine_on_call: (dk, dept, sk, now, q) => splitMultiDoctorEntries(getMedicineOnCallEntries(sk, now, q), dk),
  medicine: (dk, dept, sk, now, q) => splitMultiDoctorEntries(MEDICINE_SUBSPECIALTY_KEYS.flatMap(key => {
    const subDept = ROTAS[key];
    return subDept ? getMedicineEntries(key, sk, now).map(entry => ({ ...entry, specialty: key, section: subDept.label })) : [];
  }), dk),
  radiology_duty: (dk, dept, sk, now, q) => getRadiologyEntries(sk, now, q),
  radiology_oncall: (dk, dept, sk, now, q) => getRadiologyEntries(sk, now, q),
  hospitalist: (dk, dept, sk, now) => splitMultiDoctorEntries(getHospitalistEntries(sk, now), dk),
  oncology: (dk, dept, sk, now) => {
    const entries = [];
    const hospitalistEntries = getHospitalistEntries(sk, now);
    hospitalistEntries.forEach(entry => {
      entries.push({ ...entry, specialty: 'oncology', role: 'Hospitalist', section: 'Hospitalist' });
    });
    return entries;
  },
  pediatrics: (dk, dept, sk, now) => splitMultiDoctorEntries(getPediatricsEntries(sk, now), dk),
  picu: (dk, dept, sk, now) => splitMultiDoctorEntries(getPicuEntries(sk, now), dk),
  orthopedics: (dk, dept, sk, now) => splitMultiDoctorEntries(getOrthopedicsEntries(sk, now), dk),
  kptx: (dk, dept, sk, now) => splitMultiDoctorEntries(getKptxEntries(sk, now), dk),
  liver: (dk, dept, sk, now) => splitMultiDoctorEntries(getLiverEntries(sk, now), dk),
  hematology: (dk, dept, sk, now) => splitMultiDoctorEntries(getHematologyEntries(sk, now), dk),
  surgery: (dk, dept, sk, now) => splitMultiDoctorEntries(getSurgeryEntries(sk, now), dk),
  neurosurgery: (dk, dept, sk, now) => splitMultiDoctorEntries(getNeurosurgeryEntries(sk, now), dk),
  neurology: (dk, dept, sk, now) => splitMultiDoctorEntries(getNeurologyEntriesFromRows(dept.schedule[sk] || [], now), dk),
  gynecology: (dk, dept, sk) => splitMultiDoctorEntries(dept.schedule[sk] || [], dk),
};

function defaultBuiltInResolver(deptKey, dept, schedKey, now) {
  if (isMedicineSubspecialty(deptKey)) return splitMultiDoctorEntries(getMedicineEntries(deptKey, schedKey, now), deptKey);
  const split = splitMultiDoctorEntries(filterActiveEntriesV2(dept.schedule[schedKey] || [], now, deptKey), deptKey);
  // Resolve phones for split entries that lost their phone during "/" splitting
  if (dept.contacts && split.length) {
    for (const entry of split) {
      if (!entry.phone) {
        const ph = dept.contacts[entry.name];
        if (ph) { entry.phone = ph; entry.phoneUncertain = false; }
      }
    }
  }
  return split;
}

function getEntries(deptKey, dept, schedKey, now, qLow='') {
  // For most specialties: uploaded PDF data takes priority (more complete).
  // For BUILTIN_PRIORITY_DEPTS: built-in schedule wins when it has data.
  if (deptKey !== 'oncology') {
    const builtInEntries = dept.schedule?.[schedKey] || [];
    if (BUILTIN_PRIORITY_DEPTS.has(deptKey) && builtInEntries.length) {
      // Skip uploaded data — built-in is manually verified for this specialty
    } else {
      const uploadedEntries = uploadedEntriesForDept(deptKey, schedKey, now, qLow);
      if (uploadedEntries && uploadedEntries.length) return uploadedEntries;
    }
  }
  const resolver = SPECIALTY_RESOLVERS[deptKey] || defaultBuiltInResolver;
  return resolver(deptKey, dept, schedKey, now, qLow);
}

// ═══════════════════════════════════════════════════════════════
// RENDER
// ═══════════════════════════════════════════════════════════════


// IndexedDB core (DB_NAME, DB_STORE, pdfDbPromise, openPdfDb, savePdfRecord)
// → now in store/indexeddb.js
let runtimePdfUrls = {};
// currentPdfPreviewKey, currentPdfPreviewContext, lastPreviewContextByDept,
// currentPdfRenderTask → now in ui/pdf-preview.js

async function saveActivePdfRecord(record) {
  const previous = await getPdfRecord(record.deptKey);
  const archivedVersions = [];
  if (previous) {
    archivedVersions.push({
      name: previous.name,
      uploadedAt: previous.uploadedAt,
      blob: previous.blob,
      detectionSource: previous.detectionSource,
      specialtyUncertain: previous.specialtyUncertain,
    });
    archivedVersions.push(...(previous.archivedVersions || []));
  }
  const normalizedReview = {
    ...(record.review || {}),
    parsing: false,
    auditRejected: false,
    pendingUploadReview: false,
    reviewOnly: false,
    reviewReason: '',
  };
  if (record.deptKey === 'medicine_on_call') {
    normalizedReview.specialty = false;
    normalizedReview.policyIssues = [];
    normalizedReview.reasonCodes = [];
  }
  const normalizedAudit = {
    ...(record.audit || {}),
    livePublished: true,
    // Preserve original publishable/confidence — don't force-overwrite
  };
  // Sprint 2 (H5): build record once, write IDB first, cache only on success
  const finalRecord = {
    ...record,
    review: normalizedReview,
    audit: normalizedAudit,
    isActive: true,
    pendingReviewUpload: null,
    archivedVersions,
  };
  await savePdfRecord(finalRecord);
  cacheUploadedRecord(finalRecord);
}

async function saveRejectedPdfRecord(record) {
  const previous = await getPdfRecord(record.deptKey);
  const rejectedAttempt = {
    ...record,
    isActive: false,
    parsedActive: false,
    rejectedAt: Date.now(),
  };

  if (previous && previous.parsedActive) {
    const preserved = {
      ...previous,
      pendingReviewUpload: rejectedAttempt,
      review: {
        ...(previous.review || {}),
        pendingUploadReview: true,
        auditRejected: false,
        parsing: false,
      },
    };
    await savePdfRecord(preserved);
    cacheUploadedRecord(preserved);
    return preserved;
  }

  const reviewOnlyRecord = {
    ...rejectedAttempt,
    pendingReviewUpload: rejectedAttempt,
  };
  await savePdfRecord(reviewOnlyRecord);
  cacheUploadedRecord(reviewOnlyRecord);
  return reviewOnlyRecord;
}

// getAllPdfRecords() and getPdfRecord() → now in store/indexeddb.js

async function getLatestActivePdfRecord(deptKey) {
  if (isImagingDeptKey(deptKey)) {
    const mapRecord = resolveImagingActiveRecordSync(deptKey);
    if (mapRecord) return mapRecord;
    const dbRecord = await getPdfRecord(deptKey);
    if (!isValidImagingUploadRecord(dbRecord)) {
      if (deptKey === 'radiology_duty') {
        radiologyDutyTrace.lastSearch = {
          ...(radiologyDutyTrace.lastSearch || {}),
          at: new Date().toISOString(),
          source: radiologyDutyTrace.lastSearch?.source || 'none',
          recordName: dbRecord?.name || '',
          reason: getUploadRecordBlockReasons(dbRecord).join(',') || 'no-active-upload-record',
        };
      }
      return null;
    }
    // Sprint 2 (H1): return without mutating the Map — render path must be side-effect-free
    return canonicalizeUploadedRecord(dbRecord);
  }
  const fallbackKey = PDF_FALLBACKS[deptKey];
  const mapPrimary = uploadedPdfRecords.get(deptKey) || null;
  const mapFallback = fallbackKey ? (uploadedPdfRecords.get(fallbackKey) || null) : null;
  const dbPrimary = await getPdfRecord(deptKey);
  const dbFallback = fallbackKey ? await getPdfRecord(fallbackKey) : null;
  const candidates = [mapPrimary, mapFallback, dbPrimary, dbFallback]
    .filter(Boolean)
    .filter(isPublishableUploadRecord);
  if (!candidates.length) return null;
  const latest = candidates.sort((a, b) => (b.uploadedAt || 0) - (a.uploadedAt || 0))[0];
  // Sprint 2 (H1): return without mutating the Map — render path must be side-effect-free
  return canonicalizeUploadedRecord(latest);
}

async function getPdfHref(deptKey) {
  const fallbackKey = PDF_FALLBACKS[deptKey];
  let uploaded = await getLatestActivePdfRecord(deptKey);
  if (!uploaded && fallbackKey) uploaded = await getLatestActivePdfRecord(fallbackKey);
  const renderKey = uploaded ? (uploaded.deptKey || deptKey) : (DEFAULT_PDF_MAP[deptKey] ? deptKey : fallbackKey);
  if (uploaded && uploaded.blob) {
    if (runtimePdfUrls[renderKey]) URL.revokeObjectURL(runtimePdfUrls[renderKey]);
    runtimePdfUrls[renderKey] = URL.createObjectURL(uploaded.blob);
    if (deptKey === 'radiology_duty') {
      radiologyDutyTrace.lastPdf = {
        at: new Date().toISOString(),
        source: 'uploaded-record',
        renderKey,
        recordName: uploaded.name || 'rota.pdf',
        uploadedAt: uploaded.uploadedAt || 0,
      };
    }
    return { href: runtimePdfUrls[renderKey], name: uploaded.name || 'rota.pdf', uploadedAt: uploaded.uploadedAt || 0 };
  }
  // Cloud-synced record: use Supabase Storage URL for PDF viewing
  if (uploaded && uploaded._cloudPdfUrl) {
    return { href: uploaded._cloudPdfUrl, name: uploaded.name || 'rota.pdf', uploadedAt: uploaded.uploadedAt || 0 };
  }
  if (deptKey === 'radiology_duty') {
    const fallbackMeta = DEFAULT_PDF_MAP[deptKey] || DEFAULT_PDF_MAP[fallbackKey] || null;
    radiologyDutyTrace.lastPdf = {
      at: new Date().toISOString(),
      source: 'default-fallback',
      renderKey: fallbackKey || deptKey,
      recordName: fallbackMeta?.name || '',
    };
  }
  // Sprint 0: DEFAULT_PDF_MAP contains April-specific static PDFs.
  // Only show them during April. In May+, return null to avoid misleading users.
  const staticPdf = DEFAULT_PDF_MAP[deptKey] || DEFAULT_PDF_MAP[fallbackKey] || null;
  if (staticPdf) {
    const currentMonth = new Date().getMonth(); // 0-indexed: 3 = April
    if (currentMonth !== 3) return null; // April PDFs only valid in April
  }
  return staticPdf;
}

// closePdfPreview, renderPdfSourceHint, renderPdfPreviewPages, showPdfPreview → now in ui/pdf-preview.js
// sortEntries, getShiftTime, getEntrySection, getPdfPreviewContext → now in ui/card.js
// hasAnyToken, hasAnyPhrase → now in ui/search.js

// SMART_SEARCH, findSmartIntent, filterEntriesByIntent, isStrictExactDeptQuery,
// matchesDeptLoose, getDeptDisplayPriority, refreshPdfListAsync, getActiveDeptKey,
// explicitImagingModeFromQuery, normalizeMatchedForActiveShift, renderDeptList,
// imagingIconForced, showExactDept → now in ui/search.js
// copyPhoneNumber, isDeptHardBlocked, uploadBlockReasonSummary,
// buildRadiologyDutyTraceHtml, buildCard → now in ui/card.js
// search → now in ui/search.js


// ═══════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════
// TAG_LIST, ensureCoreAggregateSpecialties, activeDeptEntries,
// homepagePriorityOf, sortDeptEntriesForHome, renderTags, renderWelcomeGrid → now in ui/search.js

async function loadUploadedSpecialties() {
  const uploaded = await getAllPdfRecords();
  uploadedPdfRecords.clear();
  for (const record of uploaded) {
    const refreshed = refreshUploadedRecordIfNeeded(record);
    if (refreshed !== record) {
      await savePdfRecord(refreshed);
      // Sync corrected record back to Supabase ONLY if entries actually changed
      // (prevents creating duplicate Supabase rows on every page load)
      const _oldNames = (record.entries || []).map(e => e.name + '|' + e.phone).sort().join(',');
      const _newNames = (refreshed.entries || []).map(e => e.name + '|' + e.phone).sort().join(',');
      if (_oldNames !== _newNames && typeof syncRecordToSupabase === 'function') {
        console.log(`[REFRESH] Entries changed for ${refreshed.deptKey}, syncing to Supabase`);
        syncRecordToSupabase(refreshed).catch(err =>
          console.warn('[REFRESH] Supabase sync-back failed:', err.message)
        );
      }
    }
    const normalized = canonicalizeUploadedRecord(refreshed);
    cacheUploadedRecord(normalized);
    if (shouldRegisterUploadedSpecialty(normalized)) registerUploadedSpecialty(normalized);
  }
  markCacheLoaded();
  return uploaded;
}

document.addEventListener('DOMContentLoaded', () => {
  tick(); setInterval(tick,1000);
  // Ensure no stale server contacts persist from previous session
  delete window._serverExtractedContacts;

  // 1. Pull cloud records from Supabase FIRST
  // 2. Then load uploaded specialties from IndexedDB (now includes cloud data)
  // 3. Then hydrate + render
  // IMPORTANT: assign the full chain to uploadedSpecialtiesReadyPromise immediately
  // so any code that awaits it (e.g. search) waits for the complete sequence.
  // Render icons IMMEDIATELY — they only need ROTAS (already loaded via script tag)
  renderTags();
  renderWelcomeGrid();

  // Then load data in the background
  uploadedSpecialtiesReadyPromise = (
    (typeof pullFromSupabase === 'function')
      ? pullFromSupabase().catch(err => console.warn('[SUPABASE] Pull skipped:', err.message))
      : Promise.resolve()
  ).then(() => loadUploadedSpecialties());

  uploadedSpecialtiesReadyPromise.then(() => Promise.all([
    hydrateBundledSurgerySchedule(),
    hydrateBundledHospitalistSchedule(),
    hydrateBundledPediatricsContacts(),
    hydrateBundledPicuSchedule(),
  ])).finally(() => {
    // Re-render after data loads (picks up any uploaded specialties)
    renderTags();
    renderWelcomeGrid();
    // Background revalidation: re-check Supabase every 5 minutes
    // to pick up uploads from other devices
    setInterval(() => {
      if (typeof pullFromSupabase === 'function') {
        pullFromSupabase()
          .then(() => loadUploadedSpecialties())
          .then(() => { renderTags(); renderWelcomeGrid(); })
          .catch(() => {});
      }
    }, 5 * 60 * 1000);
    // ── AUDITOR: run startup checks after data loads ──────────
    Promise.all([
      Auditor.auditSystemState(),
      Auditor.auditAllStoredRecords(),
      Auditor.auditAllExistingSpecialties(),
      Auditor.runRegressionSuite(),
    ]).then(() => Auditor.renderReviewPanel());
  });

  document.getElementById('closePdfBtn').addEventListener('click', closePdfPreview);
  // ── AUDITOR: review panel toggle ──────────────────────────────
  const auditBtn = document.getElementById('auditor-toggle');
  const auditWrap = document.getElementById('auditor-wrap');
  if (auditBtn && auditWrap) {
    auditBtn.addEventListener('click', () => {
      const isHidden = auditWrap.style.display === 'none' || !auditWrap.style.display;
      auditWrap.style.display = isHidden ? 'block' : 'none';
      if (isHidden) Auditor.renderReviewPanel();
    });
  }

  // ── Sprint 5 (C1): Month transition checklist ──────────────────
  const monthCheckBtn = document.getElementById('month-checklist-toggle');
  const monthCheckWrap = document.getElementById('month-checklist-wrap');
  if (monthCheckBtn && monthCheckWrap) {
    monthCheckBtn.addEventListener('click', () => {
      const isHidden = monthCheckWrap.style.display === 'none' || !monthCheckWrap.style.display;
      monthCheckWrap.style.display = isHidden ? 'block' : 'none';
      if (isHidden) renderMonthChecklist();
    });
  }

  function renderMonthChecklist() {
    const panel = document.getElementById('month-checklist-panel');
    if (!panel) return;
    const now = new Date();
    const curMonth = String(now.getMonth() + 1).padStart(2, '0');
    const curYear = now.getFullYear();
    const monthNames = ['','January','February','March','April','May','June','July','August','September','October','November','December'];
    const monthLabel = `${monthNames[parseInt(curMonth, 10)]} ${curYear}`;
    const schedKey = fmtKey(now);

    const rows = [];
    const deptKeys = Object.keys(ROTAS).filter(k => ROTAS[k].label && !ROTAS[k].hidden);
    for (const dk of deptKeys) {
      const dept = ROTAS[dk];
      const builtIn = dept.schedule?.[schedKey] || [];
      const record = uploadedRecordForDept(dk);
      const recordMonths = record ? getRecordMonths(record) : new Set();
      const hasUpload = record && recordMonths.has(curMonth);
      const hasBuiltIn = builtIn.length > 0;

      let status, color;
      if (hasUpload) {
        status = '✅ Uploaded';
        color = '#66bb6a';
      } else if (hasBuiltIn) {
        status = '📋 Built-in';
        color = '#7ee8fa';
      } else {
        status = '❌ No data';
        color = '#ff5252';
      }
      rows.push(`<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.05);font-size:12px;">
        <span>${dept.icon || ''} ${dept.label?.split('/')[0]?.trim() || dk}</span>
        <span style="color:${color};font-weight:600">${status}</span>
      </div>`);
    }

    const missing = rows.filter(r => r.includes('No data')).length;
    const header = `<div style="margin-bottom:10px;font-size:13px;color:var(--text-2,#aaa);">
      Status for <strong style="color:var(--text-1,#e0e8f0)">${monthLabel}</strong> ·
      <span style="color:${missing ? '#ff5252' : '#66bb6a'}">${missing ? `${missing} missing` : 'All covered'}</span>
    </div>`;
    panel.innerHTML = header + rows.join('');
  }

  // Sprint 3 (H12): user-visible upload warning — replaces silent console.warn
  function showUploadWarning(message) {
    const status = document.getElementById('uploadStatus');
    if (!status) return;
    const warn = document.createElement('div');
    warn.style.cssText = 'background:rgba(255,80,80,0.15);border:1px solid rgba(255,80,80,0.4);color:#ff8a80;border-radius:6px;padding:8px 12px;margin-top:8px;font-size:12px;display:flex;justify-content:space-between;align-items:center;';
    const text = document.createElement('span');
    text.textContent = message;
    const closeBtn = document.createElement('span');
    closeBtn.textContent = '✕';
    closeBtn.style.cssText = 'cursor:pointer;margin-right:4px;font-size:14px;opacity:0.7;';
    closeBtn.onclick = () => warn.remove();
    warn.appendChild(text);
    warn.appendChild(closeBtn);
    status.parentElement.appendChild(warn);
    setTimeout(() => warn.remove(), 30000);
  }

  async function handlePdfUpload(files) {
    const status = document.getElementById('uploadStatus');
    const list = Array.from(files || []).filter(file => file.type === 'application/pdf' || /\.pdf$/i.test(file.name));
    status.textContent = list.length > 1 ? `Checking ${list.length} uploaded PDFs...` : 'Checking uploaded PDF...';
    const accepted = [];
    const skipped = [];
    const reviewNotes = [];
    const debugLines = [];
    let latestDeptKey = null;
    for (const file of list) {
      const debug = {
        file:file.name,
        received:true,
        textChars:0,
        specialty:'',
        rows:0,
        saved:false,
        searchable:false,
        status:'processing',
        issues:[],
        sectionDebug:'',
        templateDetected:false,
        coreSectionsFound:[],
      };
      const detected = await detectDeptKeyFromPdf(file);
      let { deptKey, source, uncertain } = detected;
      let specialtyLabel = '';
      if (!deptKey && isAnesthesiaLike(file.name)) {
        deptKey = 'anesthesia';
        source = 'filename';
        uncertain = false;
      }
      if (!deptKey) {
        deptKey = uploadedDeptKeyFromFilename(file.name);
        source = 'filename';
        uncertain = true;
        specialtyLabel = titleFromUploadedFilename(file.name);
      }
      const review = { specialty: !!uncertain };
      let parsed = { entries: [], textSample: '' };
      try {
        parsed = await parseUploadedPdf(file, deptKey);
      } catch (err) {
        console.warn('Uploaded PDF parsing failed:', err);
        showUploadWarning(`⚠ ${file.name}: PDF parsing failed — ${err.message || 'unknown error'}`);
      }
      debug.textChars = (parsed.textSample || '').length;
      debug.specialty = `${deptKey}${uncertain ? '?' : ''}`;
      debug.templateDetected = !!(parsed.debug && parsed.debug.templateDetected);
      debug.coreSectionsFound = (parsed.debug && parsed.debug.coreSectionsFound) || [];
      debug.parserMode = (parsed.debug && parsed.debug.parserMode) || '';
      let entries = parsed.entries || [];

      // ── AUDITOR: validate before activating ──────────────────
      const prevRecord = await getPdfRecord(deptKey).catch(() => null);
      const auditResult = await Auditor.auditParsedRecord(
        { deptKey, name: file.name, entries, textSample: parsed.textSample || '', rawText: parsed.rawText || '', specialtyLabel: specialtyLabelForKey(deptKey, file.name), specialtyUncertain: !!uncertain },
        prevRecord
      );

      // Annotate entries with confidence scores from auditor
      entries = auditResult.annotatedEntries || entries;

      const publishDecision = decideUploadPublication({
        deptKey,
        parseDebug: parsed.debug || {},
        auditResult,
        entries,
        normalizedPayload: buildNormalizedUploadPayload({
          deptKey,
          fileName: file.name,
          entries,
          parseDebug: parsed.debug || {},
          rawText: parsed.rawText || '',
        }),
        fileName: file.name,
        rawText: parsed.rawText || '',
      });
      const {
        publishToLive,
        trustProfile,
        reviewReason,
        reviewOnly,
        previewRows,
        criticalRiskTypes,
        elevatedRiskTypes,
        diagnostics,
      } = publishDecision;
      const normalizedPayload = buildNormalizedUploadPayload({
        deptKey,
        fileName: file.name,
        entries,
        parseDebug: parsed.debug || {},
        rawText: parsed.rawText || '',
      });

      if (!publishToLive && !auditResult.publishable) {
        review.parsing = true;
        review.auditRejected = true;
        review.auditErrors = auditResult.issues.filter(i => i.severity === 'error').map(i => i.explanation);
        review.auditWarnings = auditResult.issues.filter(i => i.severity === 'warn').map(i => i.explanation);
        console.warn(`[Auditor] ${deptKey} blocked:`, review.auditErrors.concat(review.auditWarnings || []));
      } else if (reviewOnly) {
        review.reviewOnly = true;
        review.reviewReason = reviewReason;
      } else if (auditResult.overallConfidence === 'medium') {
        review.auditWarnings = auditResult.issues.filter(i => i.severity !== 'info').map(i => i.explanation);
      }
      if (publishToLive) {
        review.specialty = false;
        review.parsing = false;
        review.auditRejected = false;
        review.pendingUploadReview = false;
        review.reviewOnly = false;
        review.reviewReason = '';
        review.policyIssues = (review.policyIssues || []).filter(issueType => {
          if (deptKey !== 'medicine_on_call') return true;
          return !['uncertain-specialty', 'missing-consultant', 'weak-phone-match', 'noisy-label'].includes(issueType);
        });
      }
      if (!entries.length) {
        review.parsing = true;
      }
      if (previewRows.length) review.previewRows = previewRows;
      if (trustProfile.riskReasons.length) review.riskReasons = trustProfile.riskReasons;
      if (criticalRiskTypes.length || elevatedRiskTypes.length) {
        review.policyIssues = [...criticalRiskTypes, ...elevatedRiskTypes];
        if (publishToLive && deptKey === 'medicine_on_call') {
          review.policyIssues = review.policyIssues.filter(issueType => ![
            'uncertain-specialty',
            'missing-consultant',
            'weak-phone-match',
            'noisy-label',
          ].includes(issueType));
        }
      }
      if (publishToLive && deptKey === 'medicine_on_call') {
        review.policyIssues = [];
      }
      if (diagnostics.activation.reasonCodes.length) {
        review.reasonCodes = diagnostics.activation.reasonCodes;
      }

      debug.rows = entries.length;
      debug.trustScore = trustProfile.trustScore;
      debug.trustLevel = trustProfile.trustLevel;
      debug.previewRows = previewRows;
      debug.riskReasons = trustProfile.riskReasons;
      debug.reasonCodes = diagnostics.activation.reasonCodes;
      debug.status = publishToLive         ? `published (${auditResult.overallConfidence} confidence)` :
                     !auditResult.publishable ? 'Auditor blocked — review needed' :
                     review.parsing        ? 'Parsing failed — review needed' :
                     reviewOnly            ? 'Stored for review only' :
                     `published (${auditResult.overallConfidence} confidence)`;
      debug.confidence = auditResult.overallConfidence;
      debug.issues = auditResult.issues || [];
      if (deptKey === 'radiology_duty') {
        debug.sectionDebug = formatRadiologyDutyUploadDebug(entries, auditResult.issues || [], !!auditResult.publishable);
      }
      const needsReview = !publishToLive && (review.specialty || review.auditRejected || hasHardReviewIssue(auditResult.issues || []));
      const uploadRecord = {
        deptKey,
        specialty: deptKey,
        specialtyLabel: specialtyLabelForKey(deptKey, file.name),
        icon: specialtyIconForKey(deptKey, file.name),
        specialtyUncertain: !!uncertain,
        name: file.name,
        uploadedAt: Date.now(),
        blob: file,
        detectionSource: source,
        parsedActive: publishToLive,
        entries,
        textSample: parsed.textSample || '',
        rawText: parsed.rawText || '',
        normalized: normalizedPayload,
        diagnostics,
        audit: {
          overallConfidence: auditResult.overallConfidence,
          approved: auditResult.approved,
          publishable: publishToLive || auditResult.publishable,
          livePublished: publishToLive,
          parserTrustScore: trustProfile.trustScore,
          parserTrustLevel: trustProfile.trustLevel,
          issues: auditResult.issues || [],
        },
        review,
      };

      if (publishToLive) {
        await saveActivePdfRecord(uploadRecord);
        registerUploadedSpecialty(canonicalizeUploadedRecord(uploadRecord));
        // Sync to Supabase with the PDF file for cross-device viewing
        if (typeof syncRecordToSupabase === 'function') {
          syncRecordToSupabase(uploadRecord, file).catch(() => {});
        }
      } else {
        await saveRejectedPdfRecord(uploadRecord);
      }

      debug.saved = true;
      debug.searchable = !!ROTAS[deptKey] && !!uploadedRecordForDept(deptKey) && uploadedRecordForDept(deptKey).parsedActive;
      // Cache status badge for medicine_on_call
      if (deptKey === 'medicine_on_call' && typeof parseMedicineOnCallPdfEntries !== 'undefined') {
        debug.cacheStatus = parseMedicineOnCallPdfEntries._lastCacheStatus || '';
      }
      debugLines.push(debug);
      accepted.push(`${file.name} → ${deptKey}${uncertain ? '?' : ''} (${source}; ${entries.length} doctor rows${review.parsing ? '; parsing failed' : publishToLive ? '; active' : '; review only'})`);
      if (needsReview || review.parsing) reviewNotes.push(`${deptKey}: ${review.parsing ? 'Parsing failed - review needed' : '? needs review'}`);
      if (publishToLive) latestDeptKey = deptKey;
    }
    await refreshPdfListAsync();
    renderTags();
    renderWelcomeGrid();
    // Clear server contacts after all uploads — prevent stale data in subsequent searches
    delete window._serverExtractedContacts;
    // Run regression suite in background — don't block the upload response
    Auditor.runRegressionSuite().then(() => Auditor.renderReviewPanel()).catch(() => {});
    status.innerHTML = debugLines.length
      ? debugLines.map(item => {
          const okClass = item.searchable ? 'ok' : 'fail';
          const conf = item.confidence ? ` · conf=${item.confidence}` : '';
          const trust = item.trustScore ? ` · trust=${item.trustScore}(${escapeHtml(item.trustLevel || '')})` : '';
          const issueText = formatUploadIssueList(item.issues);
          const issueHtml = issueText ? `<div class="upload-debug ${okClass}">issues=${escapeHtml(issueText)}</div>` : '';
          const previewHtml = item.previewRows && item.previewRows.length
            ? `<div class="upload-debug ${okClass}">preview=${escapeHtml(formatUploadPreviewRows(item.previewRows))}</div>`
            : '';
          const riskHtml = item.riskReasons && item.riskReasons.length
            ? `<div class="upload-debug ${okClass}">risk=${escapeHtml(item.riskReasons.join(' | '))}</div>`
            : '';
          const reasonCodeHtml = item.reasonCodes && item.reasonCodes.length
            ? `<div class="upload-debug ${okClass}">reason-codes=${escapeHtml(item.reasonCodes.join(' | '))}</div>`
            : '';
          const templateInfo = item.specialty.startsWith('radiology_duty')
            ? `<div class="upload-debug ${okClass}">template=${item.templateDetected?'yes':'no'} · core-sections=${escapeHtml((item.coreSectionsFound || []).join(', ') || 'none')}</div>`
            : '';
          const cacheBadge = item.cacheStatus === 'hit' ? ' · <span style="color:#7ee8fa">🔵 نتيجة محفوظة</span>' : item.cacheStatus === 'miss' ? ' · <span style="color:#5eeb8a">🟢 تم التحقق الآن</span>' : '';
          return `<div class="upload-debug ${okClass}">${escapeHtml(item.file)}: received=yes · text=${item.textChars?'yes':'no'} (${item.textChars}) · specialty=${escapeHtml(item.specialty)} · doctors=${item.rows}${conf}${trust} · saved=${item.saved?'yes':'no'} · searchable=${item.searchable?'yes':'no'} · ${escapeHtml(item.status)}${cacheBadge}</div>${templateInfo}${previewHtml}${riskHtml}${reasonCodeHtml}${issueHtml}${item.sectionDebug || ''}`;
        }).join('')
      : (accepted.length ? `Active PDFs updated: ${accepted.length}` : '');
    if (reviewNotes.length) status.innerHTML += `<div class="upload-debug fail">⚠️ Review: ${escapeHtml(reviewNotes.join(' · '))}</div>`;
    if (skipped.length) status.innerHTML += `<div class="upload-debug fail">Needs manual rename/detection: ${escapeHtml(skipped.join(' · '))}</div>`;
    if (!accepted.length && !skipped.length) status.textContent = 'No PDF selected.';
    const q = document.getElementById('search').value;
    if (q) await search(q);
    if (latestDeptKey) showPdfPreview(latestDeptKey);
  }

  // Password-gated upload: modal first, confirm button is a <label for="pdfUploadInline">
  // Correct password → label naturally opens file picker (real user gesture).
  // Wrong password → e.preventDefault() blocks the label.

  document.getElementById('uploadTrigger').addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const input = document.getElementById('pdf-password-input');
    const error = document.getElementById('password-error');
    input.value = '';
    error.style.display = 'none';
    document.getElementById('password-overlay').style.display = 'flex';
    setTimeout(() => input.focus(), 100);
  });

  document.getElementById('password-confirm').addEventListener('click', (e) => {
    const input = document.getElementById('pdf-password-input');
    const error = document.getElementById('password-error');
    if (input.value !== '0') {
      e.preventDefault(); // stops label from opening file picker
      error.style.display = 'block';
      input.value = '';
      input.focus();
    } else {
      // correct — let the label's for="pdfUploadInline" naturally trigger file picker
      document.getElementById('password-overlay').style.display = 'none';
    }
  });

  document.getElementById('password-cancel').addEventListener('click', () => {
    document.getElementById('password-overlay').style.display = 'none';
  });
  document.getElementById('pdf-password-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('password-confirm').click();
  });
  document.getElementById('password-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'password-overlay') document.getElementById('password-overlay').style.display = 'none';
  });

  // Original upload handler — processes files after picker closes
  document.getElementById('pdfUploadInline').addEventListener('change', async (e) => {
    await handlePdfUpload(e.target.files);
    e.target.value = '';
  });

  refreshPdfListAsync();

  // Migration button (hidden — show via console: document.getElementById('migrate-wrap').style.display='block')
  const migrateBtn = document.getElementById('migrate-to-supabase');
  if (migrateBtn && typeof migrateAllToSupabase === 'function') {
    migrateBtn.addEventListener('click', () => {
      const status = document.getElementById('migrate-status');
      migrateAllToSupabase(status);
    });
  }

  // Search
  const si = document.getElementById('search');
  si.addEventListener('input', e => {
    imagingIconForced = false; // search always uses time-based logic
    document.querySelectorAll('.tag').forEach(x=>x.classList.remove('on'));
    search(e.target.value);
  });
  si.focus();
});
