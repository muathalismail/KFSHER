// ═══════════════════════════════════════════════════════════════
// SHIFT / DATE LOGIC
// ═══════════════════════════════════════════════════════════════
// On-Call schedule: starts 07:30 and covers 24h (next day 07:30)
// So if current time < 07:30 → we are still in YESTERDAY's schedule

function getScheduleDate(now) {
  // If before 07:30, use yesterday's date
  const mins = now.getHours() * 60 + now.getMinutes();
  const cutoff = 7 * 60 + 30; // 07:30
  if (mins < cutoff) {
    const y = new Date(now.getTime() - 86400000);
    return { date: y, isOvernight: true };
  }
  return { date: now, isOvernight: false };
}

function fmtKey(d) {
  return String(d.getDate()).padStart(2,'0') + '/' + String(d.getMonth()+1).padStart(2,'0');
}

function getShiftLabel(now) {
  const mins = now.getHours() * 60 + now.getMinutes();
  if (mins < 7*60+30)  return '🌙 Night carry-over (07:30 tomorrow)';
  if (mins < 16*60+30) return '🌅 Day shift (07:30–16:30)';
  return '🌆 Evening/Night shift (16:30–07:30)';
}

// ═══════════════════════════════════════════════════════════════
// CLOCK
// ═══════════════════════════════════════════════════════════════
const DAYS_AR = ['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];

function tick() {
  const now = new Date();
  const h = String(now.getHours()).padStart(2,'0');
  const m = String(now.getMinutes()).padStart(2,'0');
  const s = String(now.getSeconds()).padStart(2,'0');
  const dd = String(now.getDate()).padStart(2,'0');
  const mo = String(now.getMonth()+1).padStart(2,'0');
  document.getElementById('ldate').textContent = `${dd}/${mo}/${now.getFullYear()}`;
  document.getElementById('lday').textContent = DAYS_AR[now.getDay()];
  document.getElementById('ltime').textContent = `${h}:${m}:${s}`;
  const { isOvernight, date } = getScheduleDate(now);
  const warn = document.getElementById('shift-warn');
  if (isOvernight) {
    warn.textContent = `⚠️ الوقت الحالي ${h}:${m} — قبل 07:30. المناوب المعروض هو دكتور ${fmtKey(date)} (مناوبة بدأت 07:30 أمس ولا تزال سارية)`;
    warn.classList.add('show');
  } else {
    warn.classList.remove('show');
  }
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════
function initials(name) {
  return name.replace(/^Dr\.?\s*/i,'').split(' ').filter(Boolean).slice(0,2).map(w=>w[0]).join('').toUpperCase() || '?';
}

function levenshtein(a='', b='') {
  a = a.toLowerCase(); b = b.toLowerCase();
  const dp = Array.from({length: b.length + 1}, () => Array(a.length + 1).fill(0));
  for (let i = 0; i <= b.length; i++) dp[i][0] = i;
  for (let j = 0; j <= a.length; j++) dp[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      dp[i][j] = b[i-1] === a[j-1] ? dp[i-1][j-1] : Math.min(dp[i-1][j-1] + 1, dp[i][j-1] + 1, dp[i-1][j] + 1);
    }
  }
  return dp[b.length][a.length];
}

function canonicalName(s='') {
  return s.toLowerCase()
    .replace(/^dr\.?\s*/i,' ')
    .replace(/\([^)]*\)/g,' ')
    .replace(/\bdr\b/g,' ')
    .replace(/[^a-z0-9\u0600-\u06FF]+/g,' ')
    .replace(/\s+/g,' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map(token => {
      if (token === 'al') return '';
      if (/^al[a-z]{3,}$/.test(token)) return token.slice(2);
      return token;
    })
    .filter(Boolean)
    .join(' ');
}

function splitPossibleNames(name='') {
  const withoutRoleNotes = name.replace(/\([^)]*\)/g, ' ');
  const slashParts = withoutRoleNotes.split(/\s*\/\s*/).filter(Boolean);
  const parts = slashParts.length ? slashParts : [withoutRoleNotes];
  return parts.map(part => part.trim()).filter(Boolean);
}

function scoreNameMatch(target, candidate) {
  const targetNorm = canonicalName(target);
  const candNorm = canonicalName(candidate);
  if (!targetNorm || !candNorm) return null;
  if (targetNorm === candNorm) return { score: 100, uncertain: false };

  const targetTokens = targetNorm.split(' ').filter(Boolean);
  const candTokens = candNorm.split(' ').filter(Boolean);
  const overlap = targetTokens.filter(t => candTokens.includes(t)).length;
  const initialMatches = targetTokens.filter((token, i) => token.length === 1 && candTokens[i] && candTokens[i].startsWith(token)).length;
  const sharedPrefix = !!(targetTokens[0] && candTokens[0] === targetTokens[0]);
  const sharedLast = !!(targetTokens[targetTokens.length-1] && candTokens[candTokens.length-1] === targetTokens[targetTokens.length-1]);
  const dist = levenshtein(targetNorm, candNorm);
  const maxLen = Math.max(targetNorm.length, candNorm.length);
  const closeSpelling = maxLen >= 6 && dist <= Math.max(1, Math.floor(maxLen * 0.18));
  const tokenNearMiss = targetTokens.some(t => candTokens.some(c => Math.max(t.length, c.length) >= 5 && levenshtein(t, c) <= 1));
  const accepted = overlap >= 2 || initialMatches >= 1 || (overlap >= 1 && (sharedPrefix || sharedLast || tokenNearMiss)) || closeSpelling;
  if (!accepted) return null;

  const score = overlap * 16 + initialMatches * 10 + (sharedPrefix ? 5 : 0) + (sharedLast ? 8 : 0) + (tokenNearMiss ? 4 : 0) - dist;
  const uncertain = !(overlap >= 2 && dist <= 2) && !(sharedPrefix && sharedLast && dist <= 3) && initialMatches < 2;
  return { score, uncertain };
}

function resolvePhone(dept, entry) {
  if (entry.phone) return { phone: entry.phone, uncertain: !!entry.phoneUncertain };
  const c = dept.contacts || {};
  if (c[entry.name]) return { phone: c[entry.name], uncertain: false };
  let best = null;
  for (const targetName of splitPossibleNames(entry.name)) {
    if (c[targetName]) return { phone: c[targetName], uncertain: false };
    for (const [contactName, phone] of Object.entries(c)) {
      if (!phone) continue;
      const match = scoreNameMatch(targetName, contactName);
      if (!match) continue;
      if (!best || match.score > best.score) best = { ...match, phone };
    }
  }
  if (!best) return null;
  return { phone: best.phone, uncertain: best.uncertain };
}

function parseRoleMeta(role='') {
  const r = role.toLowerCase();
  const time = role.match(/(\d{1,2})(?::(\d{2}))?\s*(?:–|-|to)\s*(\d{1,2})(?::(\d{2}))?/);
  let shiftType = 'on-call';
  if (r.includes('day') || r.includes('07:30') || r.includes('16:30')) shiftType = 'day';
  if (r.includes('night') || r.includes('after') || r.includes('evening')) shiftType = 'night';
  if (r.includes('24h')) shiftType = '24h';
  return {
    shiftType,
    startTime: time ? `${time[1].padStart(2,'0')}:${time[2] || '00'}` : '',
    endTime: time ? `${time[3].padStart(2,'0')}:${time[4] || '00'}` : '',
  };
}

function isNameUncertain(name='') {
  const parts = splitPossibleNames(name);
  return parts.length > 1 || parts.some(part => canonicalName(part).split(' ').some(token => token.length === 1));
}

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
    const sampleDate = new Date(2026, 3, 6);
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

// Helper: is it working hours (07:30–16:30)?
function isWorkHours(now) {
  const m = now.getHours()*60 + now.getMinutes();
  return m >= 7*60+30 && m < 16*60+30;
}

function activeShiftMode(now) {
  return isWorkHours(now) ? 'on-duty' : 'on-call';
}

function timeRangeActive(now, startMinutes, endMinutes) {
  const mins = now.getHours() * 60 + now.getMinutes();
  if (endMinutes > startMinutes) return mins >= startMinutes && mins < endMinutes;
  return mins >= startMinutes || mins < endMinutes;
}

const SPECIALTY_SCHEDULE_RULES = {
  radiology_oncall: {
    isActive(now=new Date()) {
      const day = now.getDay();
      if (day === 5 || day === 6) return true; // Friday/Saturday full 24h
      return timeRangeActive(now, 16 * 60 + 30, 7 * 60 + 30);
    },
    currentShift(now=new Date()) {
      const day = now.getDay();
      if (day === 5 || day === 6) return { label:'Current Shift', time:'07:30-07:30' };
      return { label:'Current Shift', time:'16:30-07:30' };
    },
  },
  radiology_duty: {
    isActive(now=new Date()) {
      const day = now.getDay();
      if (day === 5 || day === 6) return false;
      return timeRangeActive(now, 7 * 60 + 30, 16 * 60 + 30);
    },
    currentShift() {
      return { label:'Current Shift', time:'07:30-16:30' };
    },
  },
};

function getSpecialtyScheduleRule(deptKey='') {
  return SPECIALTY_SCHEDULE_RULES[deptKey] || null;
}

function isSpecialtyActiveNow(deptKey='', now=new Date()) {
  const rule = getSpecialtyScheduleRule(deptKey);
  if (rule && typeof rule.isActive === 'function') return !!rule.isActive(now);
  return deptKey === 'radiology_oncall' ? !isWorkHours(now) : isWorkHours(now);
}

function getSpecialtyCurrentShiftMeta(deptKey='', now=new Date()) {
  const rule = getSpecialtyScheduleRule(deptKey);
  if (rule && typeof rule.currentShift === 'function') return rule.currentShift(now);
  return deptKey === 'radiology_oncall'
    ? { label:'Current Shift', time:'16:30-07:30' }
    : { label:'Current Shift', time:'07:30-16:30' };
}

function runSpecialtyScheduleRuleTests() {
  const makeDate = (iso) => new Date(`${iso}+03:00`);
  const tests = [
    { label:'Friday 10:00 AM', deptKey:'radiology_oncall', at:'2026-04-10T10:00:00', expected:true },
    { label:'Friday 11:00 PM', deptKey:'radiology_oncall', at:'2026-04-10T23:00:00', expected:true },
    { label:'Saturday 2:00 PM', deptKey:'radiology_oncall', at:'2026-04-11T14:00:00', expected:true },
    { label:'Saturday 11:30 PM', deptKey:'radiology_oncall', at:'2026-04-11T23:30:00', expected:true },
    { label:'Sunday 10:00 AM', deptKey:'radiology_oncall', at:'2026-04-12T10:00:00', expected:false },
    { label:'Sunday 5:00 PM', deptKey:'radiology_oncall', at:'2026-04-12T17:00:00', expected:true },
    { label:'Monday 3:00 AM', deptKey:'radiology_oncall', at:'2026-04-13T03:00:00', expected:true },
    { label:'Monday 10:00 AM', deptKey:'radiology_oncall', at:'2026-04-13T10:00:00', expected:false },
  ];
  return tests.map(test => {
    const actual = isSpecialtyActiveNow(test.deptKey, makeDate(test.at));
    return { ...test, actual, passed: actual === test.expected };
  });
}

function roleText(entry={}) {
  return `${entry.role || ''} ${entry.hours || ''} ${entry.section || ''} ${entry.coverage || ''} ${entry.coverageType || ''} ${entry.shiftType || ''}`.toLowerCase();
}

function isNoteEntry(entry={}) {
  return roleText(entry).includes('note');
}

function isExplicitDayEntry(entry={}) {
  const r = roleText(entry);
  return /\b(day|duty|coverage|er\/consult|inpatient|outpatient|clinic|adult duty|pediatric duty)\b/.test(r)
    || r.includes('07:30')
    || r.includes('16:30');
}

function isExplicitOnCallEntry(entry={}) {
  const r = roleText(entry);
  return r.includes('on-call')
    || r.includes('oncall')
    || r.includes('on duty')
    || r.includes('on-duty')
    || r.includes('senior resident')
    || r.includes('after')
    || r.includes('night')
    || r.includes('24h')
    || r.includes('weekend');
}

function isNoCoverageEntry(entry={}) {
  const text = `${entry.role || ''} ${entry.name || ''}`.toLowerCase();
  return text.includes('no coverage');
}

function isLikelyClinicalRole(entry={}) {
  const r = roleText(entry);
  return /\b(resident|fellow|consultant|consult|associate|assistant|registrar|staff)\b/.test(r);
}

function isEntryActive(entry={}, now=new Date()) {
  if (!entry) return false;
  const start = String(entry.startTime || '').trim();
  const end = String(entry.endTime || '').trim();
  if (start && end) {
    const [sh, sm='00'] = start.split(':');
    const [eh, em='00'] = end.split(':');
    const startMinutes = Number(sh) * 60 + Number(sm);
    const endMinutes = Number(eh) * 60 + Number(em);
    if (!Number.isNaN(startMinutes) && !Number.isNaN(endMinutes)) {
      return timeRangeActive(now, startMinutes, endMinutes);
    }
  }
  if (entry.shiftType === '24h') return true;
  if (entry.shiftType === 'day') return isWorkHours(now);
  if (entry.shiftType === 'night' || entry.shiftType === 'on-call') return !isWorkHours(now);
  if (isExplicitDayEntry(entry) && !roleText(entry).includes('after')) return isWorkHours(now);
  if (isExplicitOnCallEntry(entry)) return !isWorkHours(now);
  return false;
}

function filterActiveEntries(entries=[], now=new Date()) {
  const usable = entries.filter(entry => !isNoteEntry(entry));
  if (!usable.length) return [];
  const noCoverage = usable.filter(isNoCoverageEntry);
  if (noCoverage.length) return noCoverage;
  if (isWorkHours(now)) {
    const explicitDay = usable.filter(entry => isExplicitDayEntry(entry) && !roleText(entry).includes('after'));
    if (explicitDay.length) return explicitDay;
    const allDay = usable.filter(entry => roleText(entry).includes('24h'));
    return allDay.length ? allDay : usable.filter(isLikelyClinicalRole);
  }
  const explicitOnCall = usable.filter(isExplicitOnCallEntry);
  if (explicitOnCall.length) return explicitOnCall;
  return usable.filter(entry => roleText(entry).includes('consultant'));
}

const MEDICINE_SUBSPECIALTY_KEYS = [
  'endocrinology',
  'dermatology',
  'rheumatology',
  'gastroenterology',
  'pulmonary',
  'infectious',
];

const AUTO_PUBLISH_SPECIALTIES = new Set([
  'neurology',
  'surgery',
  'radiology_duty',
  'hospitalist',
  'picu',
  ...MEDICINE_SUBSPECIALTY_KEYS,
]);

const REVIEW_ONLY_SPECIALTIES = new Set([
  'medicine_on_call',
  'radiology_oncall',
  'pediatrics',
  'ent',
]);

const UPLOAD_TRUST_PROFILES = {
  trusted_template: { label:'trusted-template', score:92 },
  trusted_specialized: { label:'trusted-specialized', score:84 },
  fallback: { label:'fallback', score:52 },
  generic: { label:'generic', score:30 },
};

const UPLOAD_REASON_CODES = {
  LOW_PARSE_CONFIDENCE: 'LOW_PARSE_CONFIDENCE',
  NO_DOCTOR_ROWS_FOUND: 'NO_DOCTOR_ROWS_FOUND',
  BLOCK_DATE_MISMATCH: 'BLOCK_DATE_MISMATCH',
  AMBIGUOUS_LAYOUT: 'AMBIGUOUS_LAYOUT',
  FAILED_SPECIALTY_VALIDATION: 'FAILED_SPECIALTY_VALIDATION',
  MISSING_REQUIRED_ROLE: 'MISSING_REQUIRED_ROLE',
  PHONE_BINDING_INCOMPLETE: 'PHONE_BINDING_INCOMPLETE',
  REVIEW_ONLY_SPECIALTY: 'REVIEW_ONLY_SPECIALTY',
};

const SPECIALTY_PIPELINE_RULES = {
  surgery: {
    requiredRoles: ['1st on-call', '2nd on-call', 'associate', 'consultant'],
    autoActivate: true,
  },
  neurology: {
    requiredRoles: ['1st on-call', '2nd on-call', 'consultant'],
    autoActivate: true,
  },
  hospitalist: {
    requiredRoles: ['medical er', 'oncology er', 'inpatient'],
    autoActivate: true,
  },
  picu: {
    requiredRoles: ['resident 24h', 'after-hours', 'consultant'],
    autoActivate: true,
  },
  radiology_duty: {
    requiredRoles: ['ct - neuro', 'ct - general', 'ultrasound', 'x-ray'],
    autoActivate: true,
  },
  radiology_oncall: {
    requiredRoles: ['1st on-call', '2nd on-call', 'consultant'],
    autoActivate: false,
  },
  medicine_on_call: {
    requiredRoles: ['junior er', 'senior er'],
    autoActivate: true,
  },
  pediatrics: {
    requiredRoles: ['1st on-call', '2nd on-call', 'hospitalist'],
    autoActivate: false,
  },
  hematology: {
    requiredRoles: ['1st on-call', 'consultant'],
    autoActivate: false,
  },
  kptx: {
    requiredRoles: ['day coverage', 'consultant'],
    autoActivate: false,
  },
  liver: {
    requiredRoles: ['assistant consultant', '2nd on-call', '3rd on-call'],
    autoActivate: false,
  },
  ent: {
    requiredRoles: ['1st on-call', '2nd on-call', 'consultant'],
    autoActivate: false,
  },
};

let uploadedPdfRecords = new Map();

function isMedicineSubspecialty(deptKey) {
  return MEDICINE_SUBSPECIALTY_KEYS.includes(deptKey);
}

function uploadModeForSpecialty(deptKey='') {
  if (AUTO_PUBLISH_SPECIALTIES.has(deptKey)) return 'trusted';
  if (REVIEW_ONLY_SPECIALTIES.has(deptKey)) return 'review-only';
  return 'review-only';
}

function isTrustedAutoPublishSpecialty(deptKey='') {
  return uploadModeForSpecialty(deptKey) === 'trusted';
}

function hasTrustedUploadParser(deptKey='', parseDebug={}) {
  const parserMode = parseDebug?.parserMode || '';
  if (deptKey === 'radiology_duty') return parserMode === 'specialized' && !!parseDebug.templateDetected;
  if (deptKey === 'surgery') return parserMode === 'specialized' && !!parseDebug.templateDetected;
  if (deptKey === 'hospitalist') return parserMode === 'specialized' && !!parseDebug.templateDetected;
  if (deptKey === 'neurology') return parserMode === 'specialized' && !!parseDebug.templateDetected;
  if (deptKey === 'picu') return parserMode === 'specialized' && !!parseDebug.templateDetected;
  if (isMedicineSubspecialty(deptKey)) return parserMode === 'specialized';
  return false;
}

function countUsableParsedEntries(entries=[]) {
  return (entries || []).filter(entry => {
    if (!entry) return false;
    if (isNoCoverageEntry(entry)) return true;
    return !!String(entry.name || '').trim() && !isNoteEntry(entry);
  }).length;
}

function summarizeUploadPreviewRows(entries=[], limit=4) {
  return (entries || [])
    .filter(entry => entry && (entry.name || isNoCoverageEntry(entry)))
    .slice(0, limit)
    .map(entry => {
      if (isNoCoverageEntry(entry)) return 'No coverage';
      const name = String(entry.name || '').trim();
      const role = String(entry.role || '').trim();
      return role ? `${name} (${role})` : name;
    })
    .filter(Boolean);
}

function formatUploadPreviewRows(rows=[]) {
  if (!rows.length) return '';
  return rows.join(' · ');
}

function getUploadIssueTypes(issues=[]) {
  return new Set((issues || []).map(issue => issue?.issueType || '').filter(Boolean));
}

function getParserTrustProfile(deptKey='', parseDebug={}, auditResult=null, entries=[]) {
  const parserMode = parseDebug?.parserMode || 'generic';
  const templateDetected = !!parseDebug?.templateDetected;
  const trustedParser = hasTrustedUploadParser(deptKey, parseDebug);
  const issueTypes = getUploadIssueTypes(auditResult?.issues || []);
  const usableCount = countUsableParsedEntries(entries);
  let profile = UPLOAD_TRUST_PROFILES.generic;
  const riskReasons = [];

  if (parserMode === 'specialized' && templateDetected) profile = UPLOAD_TRUST_PROFILES.trusted_template;
  else if (parserMode === 'specialized') profile = UPLOAD_TRUST_PROFILES.trusted_specialized;
  else if (parserMode === 'generic-fallback') profile = UPLOAD_TRUST_PROFILES.fallback;

  let trustScore = profile.score;

  if (parserMode === 'generic') riskReasons.push('Generic parser output');
  if (parserMode === 'generic-fallback') riskReasons.push('Fallback parser path used');
  if (['radiology_duty', 'surgery', 'hospitalist', 'neurology'].includes(deptKey) && !templateDetected) {
    riskReasons.push('Expected template was not detected');
    trustScore -= 12;
  }
  if (auditResult?.overallConfidence === 'medium') trustScore -= 8;
  if (auditResult?.overallConfidence === 'low') {
    trustScore -= 30;
    riskReasons.push('Low parser confidence');
  }
  if (issueTypes.has('data-loss')) {
    trustScore -= 18;
    riskReasons.push('Row count dropped sharply compared with live data');
  }
  if (issueTypes.has('missing-consultant') && deptKey !== 'medicine_on_call') {
    trustScore -= 18;
    riskReasons.push('Previously known consultant names disappeared');
  } else if (issueTypes.has('missing-consultant') && deptKey === 'medicine_on_call') {
    riskReasons.push('Previous consultant names changed compared with the older upload');
  }
  if (issueTypes.has('row-mapping')) {
    trustScore -= 18;
    riskReasons.push('Date or column mapping looks inconsistent');
  }
  if (issueTypes.has('obvious-names-missed')) {
    trustScore -= 22;
    riskReasons.push('Obvious source names were missed');
  }
  if (!usableCount) {
    trustScore -= 25;
    riskReasons.push('No usable doctor rows extracted');
  }

  const strongGenericStructure = (parserMode === 'generic' || parserMode === 'generic-fallback')
    && auditResult?.overallConfidence === 'high'
    && usableCount >= 3
    && ![...issueTypes].some(type => getElevatedUploadRiskTypes().has(type));

  if (strongGenericStructure) {
    trustScore = Math.max(trustScore, 72);
  }

  return {
    parserMode,
    templateDetected,
    trustLevel: profile.label,
    trustScore: Math.max(0, Math.min(100, trustScore)),
    trustedParser,
    strongGenericStructure,
    riskReasons: Array.from(new Set(riskReasons)),
  };
}

function getMedicineOnCallRoleCoverage(entries=[]) {
  const searchable = (entries || []).map(entry => normalizeText([
    entry.role || '',
    entry.section || '',
    entry.shiftType || '',
  ].join(' ')));
  const required = ['junior er', 'senior er'];
  const found = required.filter(target => searchable.some(text => text.includes(target)));
  const missing = required.filter(target => !found.includes(target));
  return { required, found, missing };
}

function resolveMedicineOnCallActiveRowsFromNormalized(normalizedPayload=null, now=new Date(), qLow='') {
  if (!normalizedPayload?.roles?.length) return [];
  const sched = getScheduleDate(now);
  const schedKey = fmtKey(sched.date);
  return resolveDisplayEntriesFromNormalizedPayload('medicine_on_call', normalizedPayload, schedKey, now, qLow);
}

function isMedicineOnCallCurrentResolutionUsable(normalizedPayload=null, now=new Date()) {
  const rows = resolveMedicineOnCallActiveRowsFromNormalized(normalizedPayload, now, '');
  if (!rows.length) return { ok:false, rows:[], missing:['junior er', 'senior er'] };
  const searchable = rows.map(entry => normalizeText([entry.role || '', entry.section || ''].join(' ')));
  const required = ['junior er', 'senior er'];
  const found = required.filter(target => searchable.some(text => text.includes(target)));
  const missing = required.filter(target => !found.includes(target));
  return { ok: found.length === required.length, rows, found, missing };
}

function summarizeNormalizedDateRange(roles=[]) {
  const dateKeys = Array.from(new Set((roles || []).map(role => role.dateKey).filter(Boolean)));
  if (!dateKeys.length) return { start:'', end:'', label:'' };
  const sortable = dateKeys
    .map(dateKey => {
      const [day, month] = dateKey.split('/').map(Number);
      return {
        dateKey,
        stamp: Number.isFinite(day) && Number.isFinite(month) ? (month * 100 + day) : Number.MAX_SAFE_INTEGER,
      };
    })
    .sort((a, b) => a.stamp - b.stamp);
  const start = sortable[0]?.dateKey || '';
  const end = sortable[sortable.length - 1]?.dateKey || '';
  return {
    start,
    end,
    label: start && end ? `${start}${start === end ? '' : ` → ${end}`}` : '',
  };
}

function normalizedCoverageType(entry={}) {
  return entry.coverageType || entry.shiftType || (isExplicitOnCallEntry(entry) ? 'on-call' : 'on-duty');
}

function buildNormalizedUploadPayload({ deptKey='', fileName='', entries=[], parseDebug={}, rawText='' } = {}) {
  const roles = (entries || []).map((entry, index) => ({
    roleType: entry.role || '',
    doctorName: entry.name || '',
    doctorPhone: entry.phone || '',
    startTime: entry.startTime || '',
    endTime: entry.endTime || '',
    coverageType: normalizedCoverageType(entry),
    shiftType: entry.shiftType || '',
    sourceConfidence: entry._confidence || 'unknown',
    sourceReference: entry.sourceReference || `${fileName || 'upload'}#row-${index + 1}`,
    sourceSection: entry.section || '',
    specialty: entry.specialty || deptKey,
    dateKey: entry.date || '',
    phoneUncertain: !!entry.phoneUncertain,
    review: { ...(entry.review || {}) },
  }));
  return {
    specialty: deptKey,
    sourceFile: fileName || '',
    parserMode: parseDebug?.parserMode || 'generic',
    templateDetected: !!parseDebug?.templateDetected,
    rawTextLength: String(rawText || '').length,
    dateRange: summarizeNormalizedDateRange(roles),
    roles,
  };
}

function normalizedRolesToEntries(normalizedPayload=null) {
  const roles = normalizedPayload?.roles || [];
  return roles.map(role => ({
    specialty: role.specialty || normalizedPayload?.specialty || '',
    date: role.dateKey || '',
    role: role.roleType || '',
    name: role.doctorName || '',
    phone: role.doctorPhone || '',
    phoneUncertain: !!role.phoneUncertain,
    section: role.sourceSection || '',
    coverageType: role.coverageType || '',
    shiftType: role.shiftType || '',
    startTime: role.startTime || '',
    endTime: role.endTime || '',
    review: { ...(role.review || {}) },
    _confidence: role.sourceConfidence || 'unknown',
    sourceReference: role.sourceReference || '',
    parsedFromPdf: true,
  }));
}

function findRequiredRoleCoverage(deptKey='', roles=[]) {
  const profile = SPECIALTY_PIPELINE_RULES[deptKey] || null;
  const required = profile?.requiredRoles || [];
  const searchable = (roles || []).map(role => normalizeText([
    role.roleType || '',
    role.coverageType || '',
    role.sourceSection || '',
  ].join(' ')));
  const found = required.filter(target => searchable.some(text => text.includes(normalizeText(target))));
  const missing = required.filter(target => !found.includes(target));
  return { required, found, missing };
}

function mapValidationReasonCodes({ deptKey='', parseDebug={}, auditResult=null, normalizedPayload=null, now=new Date() } = {}) {
  const reasonCodes = new Set();
  const issues = auditResult?.issues || [];
  const issueTypes = getUploadIssueTypes(issues);
  const trustProfile = getParserTrustProfile(deptKey, parseDebug, auditResult, normalizedPayload?.roles || []);
  const requiredRoles = findRequiredRoleCoverage(deptKey, normalizedPayload?.roles || []);
  const medicineCurrentResolution = deptKey === 'medicine_on_call'
    ? isMedicineOnCallCurrentResolutionUsable(normalizedPayload, now)
    : null;
  const medicineStructurallyUsable = !!(medicineCurrentResolution && medicineCurrentResolution.ok);

  if (!(normalizedPayload?.roles || []).length) {
    reasonCodes.add(UPLOAD_REASON_CODES.NO_DOCTOR_ROWS_FOUND);
  }
  if (
    (!auditResult?.publishable && !(deptKey === 'medicine_on_call' && medicineStructurallyUsable))
    || (issueTypes.has('uncertain-specialty') && !(deptKey === 'medicine_on_call' && medicineStructurallyUsable))
  ) {
    reasonCodes.add(UPLOAD_REASON_CODES.FAILED_SPECIALTY_VALIDATION);
  }
  if ((auditResult?.overallConfidence === 'low' || trustProfile.trustScore < 60) && !(deptKey === 'medicine_on_call' && medicineStructurallyUsable)) {
    reasonCodes.add(UPLOAD_REASON_CODES.LOW_PARSE_CONFIDENCE);
  }
  if (issueTypes.has('row-mapping') || issueTypes.has('data-loss')) {
    reasonCodes.add(UPLOAD_REASON_CODES.BLOCK_DATE_MISMATCH);
  }
  if (requiredRoles.missing.length) {
    reasonCodes.add(UPLOAD_REASON_CODES.MISSING_REQUIRED_ROLE);
  }
  if (issueTypes.has('all-missing-phones') || issueTypes.has('weak-phone-match')) {
    reasonCodes.add(UPLOAD_REASON_CODES.PHONE_BINDING_INCOMPLETE);
  }
  if (
    parseDebug?.parserMode === 'generic'
    || parseDebug?.parserMode === 'generic-fallback'
    || issueTypes.has('merged-names')
    || issueTypes.has('template-sections-missing')
  ) {
    reasonCodes.add(UPLOAD_REASON_CODES.AMBIGUOUS_LAYOUT);
  }

  return {
    trustProfile,
    requiredRoles,
    reasonCodes: Array.from(reasonCodes),
  };
}

function buildUploadPipelineDiagnostics({ deptKey='', detectedSpecialty='', parseDebug={}, parsed=null, auditResult=null, fileName='', normalizedPayload=null, now=new Date() } = {}) {
  const validation = mapValidationReasonCodes({ deptKey, parseDebug, auditResult, normalizedPayload, now });
  const profile = SPECIALTY_PIPELINE_RULES[deptKey] || { autoActivate:false };
  const medicineCurrentResolution = deptKey === 'medicine_on_call'
    ? isMedicineOnCallCurrentResolutionUsable(normalizedPayload, now)
    : null;
  const medicineUsableNow = !!(medicineCurrentResolution && medicineCurrentResolution.ok);
  const validationPassed = !!auditResult?.approved;
  const publishable = !!auditResult?.publishable || (deptKey === 'medicine_on_call' && validationPassed && medicineUsableNow);
  const hardBlockerIssue = (auditResult?.issues || []).find(issue => {
    const type = issue?.issueType || '';
    if (!getCriticalUploadRiskTypes().has(type)) return false;
    if (deptKey === 'medicine_on_call' && medicineUsableNow && (type === 'uncertain-specialty' || type === 'missing-consultant')) return false;
    return true;
  }) || null;
  const ambiguityOnly = validation.reasonCodes.length > 0 && validation.reasonCodes.every(code =>
    code === UPLOAD_REASON_CODES.AMBIGUOUS_LAYOUT
    || code === UPLOAD_REASON_CODES.MISSING_REQUIRED_ROLE
    || code === UPLOAD_REASON_CODES.PHONE_BINDING_INCOMPLETE
    || code === UPLOAD_REASON_CODES.LOW_PARSE_CONFIDENCE
  );
  const eligibleForActivation = validationPassed
    && publishable
    && profile.autoActivate
    && !validation.reasonCodes.some(code => [
      UPLOAD_REASON_CODES.NO_DOCTOR_ROWS_FOUND,
      UPLOAD_REASON_CODES.BLOCK_DATE_MISMATCH,
      UPLOAD_REASON_CODES.FAILED_SPECIALTY_VALIDATION,
      UPLOAD_REASON_CODES.AMBIGUOUS_LAYOUT,
      UPLOAD_REASON_CODES.MISSING_REQUIRED_ROLE,
    ].includes(code));
  const activationStatus = eligibleForActivation
    ? 'activated'
    : ((validationPassed && publishable && ambiguityOnly) ? 'needs_review' : 'rejected');
  const activationReasonCodes = eligibleForActivation
    ? []
    : (
      validation.reasonCodes.length
        ? validation.reasonCodes
        : [profile.autoActivate ? UPLOAD_REASON_CODES.FAILED_SPECIALTY_VALIDATION : UPLOAD_REASON_CODES.REVIEW_ONLY_SPECIALTY]
    );

  return {
    specialty: deptKey,
    sourceFile: fileName,
    detectedSpecialty,
    parserMode: parseDebug?.parserMode || 'generic',
    templateDetected: !!parseDebug?.templateDetected,
    parseSuccess: !!((parsed?.entries || []).length),
    extractedTextLength: String(parsed?.rawText || '').length,
    extractedRowsCount: (parsed?.entries || []).length,
    requiredRolesFound: validation.requiredRoles.found,
    requiredRolesMissing: validation.requiredRoles.missing,
    detectedDateRange: normalizedPayload?.dateRange || { start:'', end:'', label:'' },
    confidenceScore: validation.trustProfile.trustScore,
    confidenceLabel: auditResult?.overallConfidence || 'low',
    validation: {
      approved: validationPassed,
      publishable,
      reasonCodes: validation.reasonCodes,
      issueTypes: (auditResult?.issues || []).map(issue => issue.issueType).filter(Boolean),
      hardBlocker: hardBlockerIssue?.issueType || '',
      status: validationPassed ? (publishable ? 'publishable' : 'review') : 'rejected',
    },
    activation: {
      status: activationStatus,
      autoActivateEligible: profile.autoActivate,
      activated: activationStatus === 'activated',
      reasonCodes: activationReasonCodes,
    },
    medicine: deptKey === 'medicine_on_call' ? {
      rolesFound: getMedicineOnCallRoleCoverage(parsed?.entries || []).found,
      rolesMissing: getMedicineOnCallRoleCoverage(parsed?.entries || []).missing,
      consultantIssue: (auditResult?.issues || []).some(issue => issue.issueType === 'missing-consultant')
        ? 'historical-diff-warning'
        : ((auditResult?.issues || []).some(issue => issue.issueType === 'consultant-gap') ? 'parser-miss' : 'none'),
      currentActiveRolesResolved: medicineUsableNow,
      currentActiveRows: (medicineCurrentResolution?.rows || []).map(entry => ({
        name: entry.name || '',
        role: entry.role || '',
        section: entry.section || '',
      })),
      hardBlocker: hardBlockerIssue?.issueType || '',
    } : null,
  };
}

function reasonCodeExplanation(code='') {
  if (code === UPLOAD_REASON_CODES.LOW_PARSE_CONFIDENCE) return 'Low parser confidence';
  if (code === UPLOAD_REASON_CODES.NO_DOCTOR_ROWS_FOUND) return 'No doctor rows found';
  if (code === UPLOAD_REASON_CODES.BLOCK_DATE_MISMATCH) return 'Date/block mapping mismatch';
  if (code === UPLOAD_REASON_CODES.AMBIGUOUS_LAYOUT) return 'Layout is ambiguous or fallback parsing was used';
  if (code === UPLOAD_REASON_CODES.FAILED_SPECIALTY_VALIDATION) return 'Specialty validation failed';
  if (code === UPLOAD_REASON_CODES.MISSING_REQUIRED_ROLE) return 'Required role is missing';
  if (code === UPLOAD_REASON_CODES.PHONE_BINDING_INCOMPLETE) return 'Phone binding is incomplete';
  if (code === UPLOAD_REASON_CODES.REVIEW_ONLY_SPECIALTY) return 'Specialty is stored for review instead of auto-activation';
  return code || 'Unknown';
}

function decideUploadPublication({ deptKey='', parseDebug={}, auditResult=null, entries=[], normalizedPayload=null, fileName='', rawText='', now=new Date() } = {}) {
  const trustProfile = getParserTrustProfile(deptKey, parseDebug, auditResult, entries);
  const previewRows = summarizeUploadPreviewRows(entries);
  const diagnostics = buildUploadPipelineDiagnostics({
    deptKey,
    detectedSpecialty: deptKey,
    parseDebug,
    parsed: { entries, rawText },
    auditResult,
    fileName,
    normalizedPayload,
    now,
  });
  const activationReasons = diagnostics.activation.reasonCodes.map(reasonCodeExplanation);
  const reviewReason = activationReasons[0] || (diagnostics.activation.activated ? '' : 'Upload requires review.');
  const issueTypes = getUploadIssueTypes(auditResult?.issues || []);
  const criticalRiskTypes = [...issueTypes].filter(type => getCriticalUploadRiskTypes().has(type));
  const elevatedRiskTypes = [...issueTypes].filter(type => getElevatedUploadRiskTypes().has(type) && !criticalRiskTypes.includes(type));

  return {
    publishToLive: diagnostics.activation.activated,
    autoPublishAllowed: diagnostics.activation.autoActivateEligible,
    trustedSpecialty: isTrustedAutoPublishSpecialty(deptKey),
    trustProfile,
    previewRows,
    reviewOnly: diagnostics.activation.status !== 'activated',
    reviewReason,
    criticalRiskTypes,
    elevatedRiskTypes,
    diagnostics,
  };
}

function runUploadPolicyChecks() {
  const cases = [
    {
      label:'Trusted template parser publishes',
      deptKey:'neurology',
      parseDebug:{ parserMode:'specialized', templateDetected:true },
      auditResult:{ publishable:true, overallConfidence:'high', issues:[] },
      entries:[{ name:'Dr. Example', role:'1st On-Call Resident' }],
      expected:true,
    },
    {
      label:'Trusted specialty fallback stays review-only',
      deptKey:'neurology',
      parseDebug:{ parserMode:'generic-fallback', templateDetected:false },
      auditResult:{ publishable:true, overallConfidence:'high', issues:[] },
      entries:[{ name:'Dr. Example', role:'1st On-Call Resident' }],
      expected:false,
    },
    {
      label:'Review-only specialty never auto-publishes',
      deptKey:'medicine_on_call',
      parseDebug:{ parserMode:'generic', templateDetected:false },
      auditResult:{ publishable:true, overallConfidence:'high', issues:[] },
      entries:[
        { name:'Dr. Example One', role:'Junior ER', section:'Junior ER', shiftType:'day', date:fmtKey(getScheduleDate(new Date()).date) },
        { name:'Dr. Example Two', role:'Senior ER', section:'Senior', shiftType:'day', date:fmtKey(getScheduleDate(new Date()).date) },
      ],
      expected:true,
    },
  ];
  return cases.map(test => {
    const decision = decideUploadPublication(test);
    return { ...test, actual: decision.publishToLive, passed: decision.publishToLive === test.expected };
  });
}

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
  const resolved = resolvePhone(ROTAS.medicine_on_call || { contacts:{} }, next);
  if (resolved?.phone) {
    next.phone = resolved.phone;
    next.phoneUncertain = !!resolved.uncertain;
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
  const hasStructuredOnCallTeam = entries.some(entry => /junior resident|senior resident|associate on-call|consultant on-call/i.test(entry.role || ''));
  if (hasStructuredOnCallTeam) return entries;
  return filterActiveEntries(entries, now);
}

function getNeurologyEntriesFromRows(rows=[]) {
  const entries = (rows || []).map(entry => ({ ...entry }));
  if (!entries.length) return [];
  if (entries.some(isNoCoverageEntry)) return entries.filter(isNoCoverageEntry);
  const roleMatches = pattern => entries.filter(entry => pattern.test((entry.role || '').toLowerCase()));
  const first = roleMatches(/1st on-call resident|resident on-call/);
  const second = roleMatches(/2nd on-call senior resident|2nd on-call|senior resident/);
  const associate = roleMatches(/associate consultant on-call/);
  const consultant = roleMatches(/consultant on-call/).filter(entry => !/stroke/i.test(entry.role || '') && !/associate/i.test(entry.role || ''));

  const selected = [];
  if (first[0]) selected.push(first[0]);
  if (second[0]) selected.push(second[0]);
  if (associate[0]) selected.push(associate[0]);
  else if (consultant[0]) selected.push(consultant[0]);

  return selected.length ? selected : filterActiveEntries(entries, new Date());
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

  const onCallRows = entries.filter(entry => {
    const role = normalizeText(entry.role || '');
    return role.includes('1st on call')
      || role.includes('2nd on call')
      || role.includes('3rd on call')
      || role.includes('hospitalist er')
      || role.includes('consultant on-call');
  });

  const first = onCallRows.find(entry => /1st on-call/i.test(entry.role || ''));
  const second = onCallRows.find(entry => /2nd on-call/i.test(entry.role || ''));
  const third = onCallRows.find(entry => /3rd on-call/i.test(entry.role || ''));
  const hospitalist = onCallRows.find(entry => /hospitalist er/i.test(entry.role || ''));
  const kfshEr = entries.find(entry => /kfsh er/i.test(entry.role || ''));
  const mins = now.getHours() * 60 + now.getMinutes();
  const isMorningFirstWindow = mins >= 7 * 60 + 30 && mins < 15 * 60 + 30;
  const selected = [];

  if (isMorningFirstWindow && hospitalist) {
    selected.push({
      ...hospitalist,
      role: '1st On-Call',
      section: 'Hospitalist Morning Coverage',
      startTime: hospitalist.startTime || '07:30',
      endTime: hospitalist.endTime || '15:30',
      shiftType: hospitalist.shiftType || 'day',
    });
  } else if (first) {
    selected.push({
      ...first,
      role: '1st On-Call',
      startTime: first.startTime || '15:30',
      endTime: first.endTime || '07:30',
      shiftType: first.shiftType || 'on-call',
    });
  }

  if (second) {
    selected.push({
      ...second,
      role: '2nd On-Call',
      startTime: second.startTime || '07:30',
      endTime: second.endTime || '07:30',
      shiftType: second.shiftType || '24h',
    });
  }
  const firstName = selected[0]?.name || '';
  if (third && canonicalName(third.name || '') !== canonicalName(firstName)) {
    selected.push({
      ...third,
      role: '3rd On-Call',
      startTime: third.startTime || '07:30',
      endTime: third.endTime || '07:30',
      shiftType: third.shiftType || '24h',
    });
  }
  if (kfshEr) {
    selected.push({
      ...kfshEr,
      role: 'KFSH ER Hospitalist',
      section: 'KFSH ER',
      startTime: kfshEr.startTime || '07:30',
      endTime: kfshEr.endTime || '16:30',
      shiftType: kfshEr.shiftType || 'day',
    });
  }

  if (selected.length) return selected;
  if (onCallRows.length) return onCallRows.filter(entry => !/kfsh er/i.test(entry.role || ''));

  return filterActiveEntries(entries, now);
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
    if (role.includes('consultant on-call')) return true;
    if (isDay) {
      return role.includes('day coverage')
        || role.includes('weekend coverage')
        || role.includes('inpatient')
        || role.includes('consult');
    }
    return role.includes('after-hours')
      || role.includes('1st on-call')
      || role.includes('2nd on-call')
      || role.includes('on-call')
      || role.includes('weekend coverage');
  });
  return active.length ? active : entries;
}

function getNeurosurgeryEntries(schedKey, now) {
  const dept = ROTAS.neurosurgery;
  if (!dept) return [];
  const entries = (dept.schedule[schedKey] || []).map(entry => ({ ...entry }));
  if (!entries.length) return [];
  const mins = now.getHours() * 60 + now.getMinutes();
  const isDay = mins >= 7 * 60 + 30 && mins < 17 * 60;
  const selected = [];
  const resident = isDay
    ? entries.find(entry => /1st resident|resident on-duty \(day\)|resident on-duty/i.test(entry.role || ''))
    : entries.find(entry => /2nd resident|resident on-duty \(night\)|resident on-duty/i.test(entry.role || ''));
  const secondOnCall = entries.find(entry => /2nd on-duty|second on-call/i.test(entry.role || ''));
  const consultant = entries.find(entry => /neurosurgeon consultant|consultant on-call/i.test(entry.role || '') && !/associate/i.test(entry.role || ''));
  const associate = entries.find(entry => /associate consultant on-call|neurovascular consultant/i.test(entry.role || ''));
  if (resident) selected.push(resident);
  if (secondOnCall) selected.push(secondOnCall);
  if (consultant) selected.push(consultant);
  if (associate && canonicalName(associate.name || '') !== canonicalName(secondOnCall?.name || '')) selected.push(associate);
  return selected.length ? selected : entries.filter(entry => !/staff contact/i.test(entry.role || ''));
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
    || normalized === 'im.res';
}

function normalizeLiverRowsForDisplay(entries=[], schedKey, now) {
  const isDay = isWorkHours(now);
  const mins = now.getHours() * 60 + now.getMinutes();
  const shiftEntries = entries.filter(entry => {
    const role = normalizeText(entry.role || '');
    if (isDay) {
      return role.includes('day coverage') || role.includes('assistant consultant 1st on call');
    }
    return role.includes('after')
      || role.includes('night on call')
      || role.includes('2nd on call')
      || role.includes('3rd on call')
      || role.includes('consultant')
      || role.includes('clinical coordinator');
  });

  const seniorAtTime = getMedicineOnCallSeniorForTime(schedKey, now)
    || getMedicineOnCallSeniorForShift(schedKey, mins >= 21 * 60 ? 'night' : 'day');
  const normalized = [];
  const dayNameList = entries
    .filter(entry => {
      const role = normalizeText(entry.role || '');
      return role.includes('day coverage') || role.includes('assistant consultant 1st on call');
    })
    .flatMap(entry => splitPossibleNames(entry.name || ''))
    .filter(Boolean);
  const dayNames = new Set(
    dayNameList
      .map(name => canonicalName(name))
      .filter(Boolean)
  );
  const seen = new Set();
  const overlapsDayCoverage = (name='') => {
    const canon = canonicalName(name);
    if (!canon) return false;
    if (dayNames.has(canon)) return true;
    return dayNameList.some(dayName => {
      const match = scoreNameMatch(name, dayName);
      return !!match && match.score >= 10;
    });
  };

  shiftEntries.forEach(entry => {
    const names = splitPossibleNames(entry.name || '').filter(name => !isLiverResidentAlias(name));
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
    if (isLiverResidentAlias(entry.name || '')) {
      if (seniorAtTime) {
        const liverRole = 'SMROD';
        const startTime = mins < 21 * 60 ? '16:30' : '21:00';
        const key = `${canonicalName(seniorAtTime.name || '')}|${normalizeText(liverRole)}|${startTime}|07:30`;
        if (seen.has(key)) return;
        seen.add(key);
        normalized.push({
          ...entry,
          name: seniorAtTime.name,
          phone: seniorAtTime.phone || '',
          phoneUncertain: !seniorAtTime.phone,
          role: liverRole,
          startTime,
          endTime: '07:30',
        });
      }
      return;
    }
    const role = normalizeText(entry.role || '');
    if (role.includes('clinical coordinator')) return;
    if (role.includes('2nd on call') && mins < 21 * 60) return;
    const allowDayOverlap = role.includes('2nd on call') && mins >= 21 * 60;
    const filteredNames = names.filter(name => {
      if (canonicalName(name) === canonicalName(seniorAtTime?.name || '')) return false;
      if (!allowDayOverlap && overlapsDayCoverage(name)) return false;
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
    if (role.includes('2nd on call')) return 1;
    if (role.includes('3rd on call')) return 2;
    if (role.includes('consultant')) return 3;
    return 4;
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
  'Dr. Elrayess',
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
  if (dateKey === '11/04' && canonicalName(normalized) === canonicalName('Dr. Ayman')) {
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
  const contactMap = buildContactMapFromText(text);
  const entries = [];
  const rowRe = /^(Wed|Thu|Fri|Sat|Sun|Mon|Tue)\s+(\d{1,2})\/04\/2026\s+(.+)$/i;
  const lines = String(text || '').split(/\n/).map(line => line.trim()).filter(Boolean);

  lines.forEach(line => {
    const match = line.match(rowRe);
    if (!match) return;
    const dateKey = `${String(parseInt(match[2], 10)).padStart(2, '0')}/04`;
    const body = match[3].replace(/\b\d{6,}.*$/, '').trim();
    let tokens = extractPicuDoctorTokens(body);
    tokens = stripPicuContactListBleed(tokens, match[3]);
    const rowEntries = buildPicuRowEntries(dateKey, tokens, contactMap);
    entries.push(...rowEntries);
  });

  const deduped = dedupeParsedEntries(entries);
  const sectionSet = new Set(deduped.map(entry => entry.picuField).filter(Boolean));
  deduped._templateDetected = deduped.length >= 20 && sectionSet.has('consultant_24h') && sectionSet.has('after_hours_doctor');
  deduped._templateName = deduped._templateDetected ? 'picu-monthly-2026' : '';
  deduped._coreSectionsFound = [...sectionSet];
  return deduped;
}

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
  const dayRowRe = /^(Wed|Thu|Fri|Sat|Sun|Mon|Tue)\s+(\d{1,2})\/4\/2026\s+(.+)$/i;
  const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
  lines.forEach(line => {
    const match = line.match(dayRowRe);
    if (!match) return;
    const day = String(parseInt(match[2], 10)).padStart(2, '0');
    const date = `${day}/04`;
    const tokens = extractHospitalistRowTokens(match[3]);
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
  deduped._templateName = deduped._templateDetected ? 'hospitalist-monthly-2026' : '';
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

function parseMedicineOnCallDateBlocks(lines=[]) {
  const dayLineRe = /\b(?:Sun|Mon|Tue|Wed|Wen|Thu|Fri|Sat)\s+\d{1,2}\/\d{1,2}\b/gi;
  return (lines || [])
    .filter(line => line.match(dayLineRe))
    .map(line => Array.from(line.matchAll(/(?:Sun|Mon|Tue|Wed|Wen|Thu|Fri|Sat)\s+(\d{1,2})\/(\d{1,2})/gi)).map(match => ({
      dateKey: `${String(parseInt(match[1], 10)).padStart(2, '0')}/${String(parseInt(match[2], 10)).padStart(2, '0')}`,
    })))
    .filter(group => group.length >= 3);
}

function compactMedicineAlias(value='') {
  return String(value || '')
    .toLowerCase()
    .replace(/^dr\.?\s*/i, '')
    .replace(/[^a-z0-9]+/g, '');
}

function cleanMedicineOnCallResolvedName(name='') {
  return String(name || '')
    .replace(/\bResiden\s*t?\b.*$/i, '')
    .replace(/\bResident\b.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildMedicineOnCallAliasIndex(contactResult=null) {
  const dept = ROTAS.medicine_on_call || { contacts:{} };
  const phoneToFullName = new Map();
  Object.entries(contactResult?.map || {}).forEach(([name, phone]) => {
    if (/^Dr/i.test(name || '') && phone) phoneToFullName.set(cleanPhone(phone), name);
  });
  const aliasIndex = new Map();
  Object.entries(dept.contacts || {}).forEach(([alias, phone]) => {
    const compact = compactMedicineAlias(alias);
    if (!compact) return;
    const canonical = phoneToFullName.get(cleanPhone(phone || '')) || (/^Dr/i.test(alias) ? alias : `Dr. ${alias}`);
    aliasIndex.set(compact, cleanMedicineOnCallResolvedName(canonical.replace(/\s+/g, ' ').trim()));
  });
  Object.keys(contactResult?.map || {}).forEach(name => {
    const compact = compactMedicineAlias(name);
    if (!compact) return;
    aliasIndex.set(compact, cleanMedicineOnCallResolvedName(name.replace(/\s+/g, ' ').trim()));
  });
  return aliasIndex;
}

function splitMedicineOnCallRowNames(body='', aliasIndex=null, expectedCount=MEDICINE_ON_CALL_ROLE_SEQUENCE.length) {
  const tokens = String(body || '').trim().split(/\s+/).filter(Boolean);
  const memo = new Map();
  const maxWidth = 4;

  function solve(index, slot) {
    const key = `${index}|${slot}`;
    if (memo.has(key)) return memo.get(key);
    const remainingTokens = tokens.length - index;
    const remainingSlots = expectedCount - slot;
    if (remainingSlots === 0) return index === tokens.length ? { score:0, groups:[] } : null;
    if (remainingTokens < remainingSlots || remainingTokens > remainingSlots * maxWidth) return null;

    let best = null;
    for (let width = 1; width <= Math.min(maxWidth, remainingTokens); width += 1) {
      const raw = tokens.slice(index, index + width).join(' ');
      const compact = compactMedicineAlias(raw);
      const canonical = aliasIndex?.get(compact) || '';
      const tail = solve(index + width, slot + 1);
      if (!tail) continue;
      const score = tail.score + (canonical ? 4 : 0) + width;
      const candidate = { score, groups:[canonical || raw, ...tail.groups] };
      if (!best || candidate.score > best.score) best = candidate;
    }
    memo.set(key, best);
    return best;
  }

  return solve(0, 0)?.groups || [];
}

function resolveMedicineOnCallName(raw='', contactResult=null) {
  const token = String(raw || '').trim().replace(/^[.-]+|[.-]+$/g, '');
  if (!token) return '';
  const dept = ROTAS.medicine_on_call || { contacts:{} };
  const directCandidates = [
    token,
    token.replace(/\s+/g, ''),
    token.replace(/\s+/g, '.'),
  ];
  for (const candidate of directCandidates) {
    if (dept.contacts?.[candidate]) {
      if (/^dr\.?/i.test(candidate)) return candidate;
    }
  }
  const normalizedToken = normalizeText(token.replace(/\./g, ' '));
  const bareToken = normalizedToken.replace(/^dr\b/, '').trim();
  let best = null;
  Object.keys(contactResult?.map || {}).forEach(name => {
    const candidateNorm = normalizeText(String(name || '').replace(/^Dr\.?\s*/i, '').replace(/\./g, ' '));
    if (!candidateNorm) return;
    const candidateTokens = candidateNorm.split(' ').filter(Boolean);
    const tokenBits = bareToken.split(' ').filter(Boolean);
    if (!tokenBits.length) return;
    const firstBit = tokenBits[0];
    const lastBit = tokenBits[tokenBits.length - 1];
    const firstMatch = firstBit.length === 1
      ? !!candidateTokens[0]?.startsWith(firstBit)
      : candidateTokens.some(bit => bit === firstBit || bit.startsWith(firstBit));
    const lastMatch = lastBit.length >= 3
      ? candidateTokens.some(bit => bit === lastBit || bit.startsWith(lastBit))
      : true;
    if (!firstMatch || !lastMatch) return;
    const score = scoreNameMatch(token, name) || scoreNameMatch(`Dr. ${token}`, name);
    if (!score) return;
    if (!best || score.score > best.score) best = { name, score: score.score };
  });
  if (best?.name) return cleanMedicineOnCallResolvedName(best.name);
  const fallback = token.replace(/\b([A-Z])\./g, '$1. ').replace(/\s+/g, ' ').trim();
  return cleanMedicineOnCallResolvedName(/^dr\.?/i.test(fallback) ? fallback : `Dr. ${fallback}`.trim());
}

function buildMedicineOnCallRow(dateKey='', roleMeta={}, rawName='', contactResult=null, deptKey='medicine_on_call') {
  const name = resolveMedicineOnCallName(rawName, contactResult);
  const phoneMeta = resolvePhoneFromContactMap(name, contactResult)
    || resolvePhone(ROTAS[deptKey] || { contacts:{} }, { name, phone:'' })
    || { phone:'', uncertain:true };
  return {
    specialty: deptKey,
    date: dateKey,
    role: roleMeta.role,
    name,
    phone: phoneMeta.phone || '',
    phoneUncertain: !phoneMeta.phone || !!phoneMeta.uncertain,
    section: roleMeta.section,
    shiftType: roleMeta.shiftType,
    startTime: roleMeta.startTime,
    endTime: roleMeta.endTime,
    parsedFromPdf: true,
  };
}

function parseMedicineOnCallWeekendBlocks(lines=[], contactResult=null, deptKey='medicine_on_call') {
  const entries = [];
  const headerRe = /^(Fri|Sat)\s+(\d{1,2})\/(\d{1,2})$/i;
  for (let i = 0; i < lines.length; i += 1) {
    const match = String(lines[i] || '').trim().match(headerRe);
    if (!match) continue;
    const dateKey = `${String(parseInt(match[2], 10)).padStart(2, '0')}/${String(parseInt(match[3], 10)).padStart(2, '0')}`;
    const rawNames = [];
    let cursor = i + 1;
    while (cursor < lines.length && rawNames.length < MEDICINE_ON_CALL_ROLE_SEQUENCE.length) {
      const candidate = String(lines[cursor] || '').trim();
      if (!candidate) {
        cursor += 1;
        continue;
      }
      if (headerRe.test(candidate)) break;
      rawNames.push(candidate);
      cursor += 1;
    }
    if (rawNames.length === MEDICINE_ON_CALL_ROLE_SEQUENCE.length) {
      rawNames.forEach((rawName, index) => {
        entries.push(buildMedicineOnCallRow(dateKey, MEDICINE_ON_CALL_ROLE_SEQUENCE[index], rawName, contactResult, deptKey));
      });
    }
    i = cursor - 1;
  }
  return entries;
}

function parseMedicineOnCallPdfEntries(text='', deptKey='medicine_on_call') {
  const contactResult = buildContactMapFromText(text);
  const aliasIndex = buildMedicineOnCallAliasIndex(contactResult);
  const lines = String(text || '').split(/\n/).map(line => line.trim()).filter(Boolean);
  const entries = [];
  const dayRowRe = /^(Sun|Mon|Tue|Wed|Wen|Thu|Fri|Sat)\s+(\d{1,2})\/(\d{1,2})\s+(.+)$/i;

  lines.forEach(line => {
    const match = line.match(dayRowRe);
    if (!match) return;
    if (/Day\s*\/\s*Date/i.test(line) || /Junior\s+Ward/i.test(line)) return;
    const dateKey = `${String(parseInt(match[2], 10)).padStart(2, '0')}/${String(parseInt(match[3], 10)).padStart(2, '0')}`;
    const groups = splitMedicineOnCallRowNames(match[4], aliasIndex, MEDICINE_ON_CALL_ROLE_SEQUENCE.length);
    if (groups.length !== MEDICINE_ON_CALL_ROLE_SEQUENCE.length) return;
    groups.forEach((rawName, index) => {
      entries.push(buildMedicineOnCallRow(dateKey, MEDICINE_ON_CALL_ROLE_SEQUENCE[index], rawName, contactResult, deptKey));
    });
  });

  const deduped = dedupeParsedEntries(entries);
  deduped._templateDetected = deduped.length >= 60;
  deduped._templateName = deduped._templateDetected ? 'medicine-on-call-grid' : '';
  deduped._coreSectionsFound = Array.from(new Set(deduped.map(entry => entry.section).filter(Boolean)));
  return deduped;
}

function isLegacyHospitalistRecord(record) {
  if (!record || record.deptKey !== 'hospitalist' || !Array.isArray(record.entries) || !record.entries.length) return false;
  const oncologyStructured = record.entries.filter(entry =>
    normalizeText(entry.section || '') === 'oncology er'
    && !!entry.startTime
    && !!entry.endTime
  ).length;
  const oncologyNames = record.entries.filter(entry =>
    normalizeText(entry.section || '') === 'oncology er'
    && !!(entry.name || '').trim()
  ).length;
  return oncologyStructured < 2 || oncologyNames < 2;
}

function getHospitalistEntries(schedKey, now) {
  const dept = ROTAS.hospitalist;
  if (!dept) return [];
  const entries = (dept.schedule[schedKey] || []).map(entry => ({ ...entry }));
  if (!entries.length) return [];
  const oncologyOnly = entries.filter(entry => (entry.section || '') === 'Oncology ER');
  const source = oncologyOnly.length ? oncologyOnly : entries;
  const mins = now.getHours() * 60 + now.getMinutes();
  const active = source.filter(entry => {
    const start = parseTimeMinutes(entry.startTime || '');
    const end = parseTimeMinutes(entry.endTime || '');
    if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
    if (end > start) return mins >= start && mins < end;
    return mins >= start || mins < end;
  });
  return active;
}

function parseTimeMinutes(value='') {
  const match = String(value || '').match(/(\d{1,2}):(\d{2})/);
  if (!match) return NaN;
  return parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
}

function cloneEntry(entry) {
  return { ...entry };
}

function splitMultiDoctorEntries(entries=[], deptKey='') {
  return entries.flatMap(entry => {
    const parts = splitPossibleNames(entry.name || '');
    if (parts.length <= 1) return [entry];
    return parts.map(name => ({
      ...entry,
      name,
      phone: entry.sharedPhone ? entry.phone : '',
      phoneUncertain: entry.sharedPhone ? true : entry.phoneUncertain,
      splitFrom: entry.name,
      nameUncertain: false,
    }));
  });
}

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

function isPublishableUploadRecord(record) {
  return !!(record
    && record.isActive !== false
    && record.parsedActive
    && hasUsableUploadEntries(record)
    && !(record.review && (record.review.parsing || record.review.auditRejected || record.review.pendingUploadReview))
    && !hasHardAuditErrors(record)
    && (record.audit ? record.audit.publishable !== false : true));
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
  uploadedPdfRecords.delete(normalized.deptKey);
  if (normalized.originalDeptKey) uploadedPdfRecords.delete(normalized.originalDeptKey);
}

function resolveImagingActiveRecordSync(deptKey) {
  const record = uploadedPdfRecords.get(deptKey) || null;
  if (isValidImagingUploadRecord(record)) return record;
  return null;
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

function resolveDisplayEntriesFromNormalizedPayload(deptKey, normalizedPayload, schedKey, now, qLow='') {
  const allEntries = normalizedRolesToEntries(normalizedPayload).filter(entry =>
    !entry.specialty
    || entry.specialty === deptKey
    || PDF_FALLBACKS[deptKey] === normalizedPayload?.specialty
  );
  const dated = allEntries.filter(entry => !entry.date || entry.date === schedKey || entry.date === 'dynamic-weekday');
  const base = dated.length ? dated : allEntries.filter(entry => !entry.date);
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
  if (deptKey === 'neurology') return splitMultiDoctorEntries(getNeurologyEntriesFromRows(base), deptKey);
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
  return splitMultiDoctorEntries(filterActiveEntries(base.map(cloneEntry), now), deptKey);
}

function uploadedEntriesForDept(deptKey, schedKey, now, qLow='') {
  const record = refreshUploadedRecordIfNeeded(uploadedRecordForDept(deptKey));
  if (!record || !record.parsedActive || !Array.isArray(record.entries)) return null;
  if (deptKey === 'medicine_on_call' && isLegacyMedicineOnCallRecord(record)) return null;
  if (deptKey === 'hospitalist' && isLegacyHospitalistRecord(record)) return null;
  if (deptKey === 'picu' && isLegacyPicuRecord(record)) return null;
  if (deptKey === 'radiology_duty') {
    const deptEntries = (record.entries || []).filter(entry =>
      !entry.specialty || entry.specialty === deptKey || record.deptKey === deptKey || PDF_FALLBACKS[deptKey] === record.deptKey
    );
    const dated = deptEntries.filter(entry => !entry.date || entry.date === schedKey || entry.date === 'dynamic-weekday');
    const base = dated.length ? dated : deptEntries.filter(entry => !entry.date);
    if (!base.length) return [];
    if (base.some(isNoCoverageEntry)) return base.filter(isNoCoverageEntry);
    const intent = radiologyQueryIntent(qLow);
    const filtered = filterRadiologyDutyByIntent(base.map(cloneEntry), intent);
    return dedupeRadiologyDutyDisplayEntries(filtered);
  }
  if (record.normalized?.roles?.length) {
    return resolveDisplayEntriesFromNormalizedPayload(deptKey, record.normalized, schedKey, now, qLow);
  }
  const baseEntries = normalizedUploadedBaseEntries(record, deptKey);
  if (!baseEntries.length) return [];
  const deptEntries = baseEntries.filter(entry => !entry.specialty || entry.specialty === deptKey || record.deptKey === deptKey || PDF_FALLBACKS[deptKey] === record.deptKey);
  const dated = deptEntries.filter(entry => !entry.date || entry.date === schedKey || entry.date === 'dynamic-weekday');
  const base = dated.length ? dated : deptEntries.filter(entry => !entry.date);
  if (!base.length) return [];
  if (base.some(isNoCoverageEntry)) return base.filter(isNoCoverageEntry);
  if (record.review && record.review.parsing) return splitMultiDoctorEntries(base.map(cloneEntry), deptKey);
  if (deptKey === 'radiology_oncall') return base;
  if (deptKey === 'neurology') return splitMultiDoctorEntries(getNeurologyEntriesFromRows(base), deptKey);
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
  return splitMultiDoctorEntries(filterActiveEntries(base.map(cloneEntry), now), deptKey);
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
  { key:'pediatric_heme_onc', icon:'🩸', label:'Pediatric Heme-Onc & SCT / دم وأورام الأطفال', terms:['pediatric hematology','pediaric hematology','ped heme','ped oncology','pediatric oncology','sct pediatric','pediatric hematology oncology'] },
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
  'medicine',
  'neurology',
  'neurosurgery',
  'adult_cardiology',
  'gynecology',
  'picu',
  'anesthesia',
  'psychiatry',
  'pediatric_neurology',
  'pediatric_cardiology',
  'pediatric_heme_onc',
  'neuro_ir',
  'urology',
  'ophthalmology',
  'hematology',
  'radonc',
  'nephrology',
  'kptx',
  'liver',
  'spine',
  'palliative',
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
  if (interpreted) return { deptKey: interpreted.key, source: detectionSource, uncertain: detectionSource !== 'filename', score: interpreted.score || 100 };
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
  return { deptKey: best.key, source: detectionSource, uncertain: detectionSource !== 'filename', score: best.score };
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
let currentPdfTextIndex = [];
let currentPdfSearchResults = [];

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
        let line = '';
        for (let j = 0; j < currentLineItems.length; j++) {
          const it = currentLineItems[j];
          if (j === 0) {
            line += it.str;
          } else {
            const prev = currentLineItems[j - 1];
            const prevEnd = prev.x + (prev.width || prev.str.length * avgCharW);
            const gap = it.x - prevEnd;
            // Large gap → column separator (double space); normal gap → single space
            line += (gap > avgCharW * 1.8 ? '  ' : ' ') + it.str;
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

function normalizeUploadedRole(role='') {
  return role
    .replace(/\bTAAM\b/gi, '')
    .replace(/\bTAA?M\b/gi, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+[-–]\s*$/g, '')
    .trim();
}

function normalizeUploadedSpecialtyLabel(label='') {
  return label
    .replace(/\bTAAM\b/gi, '')
    .replace(/\b(on[\s-]?call|duty|rota|schedule|department)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function homepageLabel(label='') {
  return (label || '').split(' / ')[0].split('/')[0].trim();
}

function escapeHtml(s='') {
  return String(s).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}

function formatUploadIssueList(issues=[]) {
  if (!issues || !issues.length) return '';
  return issues.map(issue => {
    const type = issue.issueType ? `${issue.issueType}: ` : '';
    return `${type}${issue.explanation || ''}`.trim();
  }).filter(Boolean).join(' | ');
}

const HARD_REVIEW_ISSUE_TYPES = new Set([
  'empty-pdf',
  'no-rows',
  'zero-usable-rows',
  'obvious-names-missed',
  'row-mapping',
  'template-sections-missing',
  'radiology-no-sections',
  'radiology-no-doctors',
  'radiology-empty-section',
  'uncertain-specialty',
]);

function hasHardReviewIssue(issues=[]) {
  return (issues || []).some(issue => HARD_REVIEW_ISSUE_TYPES.has(issue.issueType || ''));
}

function getCriticalUploadRiskTypes() {
  return new Set([
    ...HARD_REVIEW_ISSUE_TYPES,
    'data-loss',
    'missing-consultant',
  ]);
}

function getElevatedUploadRiskTypes() {
  return new Set([
    ...getCriticalUploadRiskTypes(),
    'low-confidence-rows',
    'merged-names',
    'duplicates',
    'consultant-gap',
    'missing-tiers',
  ]);
}

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

function parsePhoneFromLine(line='') {
  // Match: +966-5x, 05x (10 digits), 5x (9 digits — missing leading 0, common in some PDFs)
  const candidates = line.match(/(?:\+?966[\s-]*)?0?5[\d\s-]{7,16}/g) || [];
  for (const candidate of candidates) {
    let digits = candidate.replace(/[^\d]/g, '');
    if (digits.startsWith('966')) digits = `0${digits.slice(3)}`;
    if (/^5\d{8}$/.test(digits)) digits = `0${digits}`;  // 9-digit: prepend 0
    const phone = digits.match(/^05\d{8}/);
    if (phone) return phone[0];
  }
  return '';
}

function parseDateKeyFromLine(line='') {
  const numeric = line.match(/\b([0-3]?\d)[\/.-]([01]?\d)\b/);
  if (numeric) return `${numeric[1].padStart(2,'0')}/${numeric[2].padStart(2,'0')}`;
  return '';
}

function parseTimeRangeFromLine(line='') {
  const range = line.match(/\b(\d{1,2})(?::(\d{2}))?\s*(?:-|–|to)\s*(\d{1,2})(?::(\d{2}))?\b/i);
  if (!range) return { startTime:'', endTime:'', shiftType:'' };
  const startTime = `${range[1].padStart(2,'0')}:${range[2] || '00'}`;
  const endTime = `${range[3].padStart(2,'0')}:${range[4] || '00'}`;
  const startHour = Number(range[1]);
  const shiftType = startHour >= 7 && startHour < 16 ? 'on-duty' : 'on-call';
  return { startTime, endTime, shiftType };
}

function roleFromLine(line='', fallback='On-Call') {
  const l = line.toLowerCase();
  if (/(1st|first)/.test(l)) return /resident/.test(l) ? '1st On-Call Resident' : '1st On-Call';
  if (/(2nd|second)/.test(l)) return /resident/.test(l) ? '2nd On-Call Resident' : '2nd On-Call';
  if (/(3rd|third)/.test(l)) return /consultant/.test(l) ? '3rd On-Call Consultant' : '3rd On-Call';
  if (/resident/.test(l)) return 'Resident';
  if (/fellow/.test(l)) return 'Fellow';
  if (/consultant/.test(l)) return 'Consultant On-Call';
  return normalizeUploadedRole(fallback);
}

function extractNameNearPhone(line='') {
  const phone = parsePhoneFromLine(line);
  let cleaned = line.replace(phone, ' ')
    .replace(/\b(?:[0-3]?\d[\/.-][01]?\d|sun|mon|tue|wed|thu|fri|sat|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/ig, ' ')
    .replace(/\b(?:1st|2nd|3rd|first|second|third|on|call|resident|fellow|consultant|day|night|after|coverage|duty|rota|taam)\b/ig, ' ')
    .replace(/[^A-Za-z\u0600-\u06FF.' -]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const drIndex = cleaned.search(/\bDr\.?\b/i);
  if (drIndex >= 0) cleaned = cleaned.slice(drIndex).trim();
  return cleaned.split(/\s{2,}/)[0].trim();
}

function compactPdfTextForParsing(text='') {
  return text
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/(\d{2}\/\d{2})(?=\D)/g, '\n$1 ')
    .replace(/(05\d{8})/g, ' $1 ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseEntriesAroundPhones(text='', deptKey='') {
  const compact = compactPdfTextForParsing(text);
  const phoneRe = /(?:\+?966[\s-]*)?0?5[\d\s-]{7,16}/g;
  const entries = [];
  let match;
  while ((match = phoneRe.exec(compact))) {
    const phone = parsePhoneFromLine(match[0]);
    if (!phone) continue;
    const start = Math.max(0, match.index - 160);
    const end = Math.min(compact.length, match.index + match[0].length + 90);
    const context = compact.slice(start, end);
    const date = parseDateKeyFromLine(context);
    const time = parseTimeRangeFromLine(context);
    const name = extractNameNearPhone(context);
    if (!name || name.length < 2 || /\b(on|call|resident|fellow|consultant|date|phone)\b/i.test(name)) continue;
    entries.push({
      specialty: deptKey,
      date,
      role: roleFromLine(context),
      name,
      phone,
      ...time,
      section: normalizeUploadedSpecialtyLabel(ROTAS[deptKey]?.label || specialtyLabelForKey(deptKey)),
      parsedFromPdf: true,
    });
  }
  return dedupeParsedEntries(entries);
}

function dedupeParsedEntries(entries=[]) {
  const seen = new Set();
  return entries.filter(entry => {
    const key = [entry.specialty, entry.date, canonicalName(entry.name), entry.phone, entry.role].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Build a name→phone contact map from any "Name ... Phone" table found in the PDF text.
// Many PDFs (ENT, Medicine, Neurology, etc.) have a staff contact list with names + mobiles.
// We parse this first, then use it to fill phone gaps in the schedule entries.
function buildContactMapFromText(text='') {
  // Returns { canonicalName → phone, lastName → phone, ... }
  // Handles all formats found in KFSH-D PDFs:
  //   • "Dr. Firstname Lastname  phone"          (Orthopedics, Nephrology)
  //   • "Firstname Lastname  role  ext  phone"   (ENT, PICU, Urology)
  //   • "Firstname  Lastname  id  phone  Firstname  Lastname  id  phone"  (Urology multi-column)
  const map = {};           // canonical → phone
  const altMap = {};        // for fuzzy lookup: normalized → phone

  const PHONE_RE = /(?:\+?966[\s-]*)?0?5[\d\s-]{7,16}/g;
  const STOP_WORDS = new Set([
    'consultant','associate','assistant','head','section','chair','director','program',
    'fellow','resident','physician','senior','junior','specialist','coordinator',
    'manager','department','of','the','and','in','head','neck','surgery','rhinology',
    'skull','base','audiology','otology','neurotology','pediatric','otolaryngology',
    'airway','inpatient','outpatient','oncall','on','call','duty','rota','clinical',
    'transplant','nephrology','kidney','liver','cardiology','unit','md','mbbs',
  ]);

  // ── Utility: clean a raw name token ───────────────────────────
  function cleanNameToken(s) {
    // Collapse PDF.js-fractured words: "Al  h azmi" → "Al hazmi"
    // but preserve legitimate double-spaces between separate names
    return s.replace(/\b([A-Z][a-z]*)\s{1,2}([a-z]{1,3})\b/g, '$1$2') // "Al  h azmi" → "Alhazmi"? No – keep readable
             .replace(/\s+/g,' ').trim();
  }

  // ── Normalize name for lookup key ─────────────────────────────
  function normKey(name) {
    return name.toLowerCase()
      .replace(/^dr\.?\s*/,'')
      .replace(/[\s-]+al[\s-]+/g,' al ')     // normalize "Al-" / "Al " prefixes
      .replace(/\bal\b/g,'al')
      .replace(/[^a-z ]/g,' ')
      .replace(/\s+/g,' ')
      .trim();
  }

  // ── Add an entry with all its lookup variants ──────────────────
  function addEntry(rawName, phone) {
    if (!rawName || !phone || rawName.length < 3) return;
    // Collapse obvious PDF spacing artifacts: "Al  k hat  ee  b" → "Alkhateeeb"? 
    // Better: collapse intra-word gaps of 1-2 chars surrounded by alphas
    let name = rawName
      .replace(/([A-Za-z])\s{1,2}([a-z]{1,4})(?=\s|$)/g, '$1$2') // "Al  h azmi" → "Alhazmi"
      .replace(/\s+/g,' ').trim();
    
    // Skip entries that are purely role labels
    const lower = name.toLowerCase().replace(/^dr\.?\s*/,'');
    if (lower.split(' ').every(w => STOP_WORDS.has(w))) return;
    // Must have at least one word that's a real name (≥3 chars, not a stop word)
    const nameParts = lower.split(' ').filter(w => w.length >= 3 && !STOP_WORDS.has(w));
    if (!nameParts.length) return;

    const nk = normKey(name);
    if (!altMap[nk]) altMap[nk] = phone;

    // Store full name
    if (!map[name]) map[name] = phone;

    // Store without Dr. prefix
    const bare = name.replace(/^Dr\.?\s*/i, '').trim();
    if (bare !== name && !map[bare]) map[bare] = phone;

    // Store last name alone (only if ≥5 chars to avoid false matches)
    const parts = bare.split(' ').filter(Boolean);
    if (parts.length >= 2) {
      const last = parts[parts.length - 1];
      if (last.length >= 5 && !map[last]) map[last] = phone;
      // Store "Al-X" last name variants
      if (parts.length >= 3 && parts[parts.length - 2].toLowerCase() === 'al') {
        const alLast = parts.slice(-2).join(' ');
        if (!map[alLast]) map[alLast] = phone;
      }
    }
  }

  // ── Process each line ─────────────────────────────────────────
  const lines = text.split(/\n/).map(l => l.trim()).filter(Boolean);

  for (const line of lines) {
    // Find all phones in the line
    const allPhones = [...line.matchAll(new RegExp(PHONE_RE.source, 'g'))].map(m => {
      let raw = m[0].replace(/[\s-]/g,'');
      if (raw.startsWith('966')) raw = '0' + raw.slice(3);
      if (/^5\d{8}$/.test(raw)) raw = '0' + raw;
      // Use search (not match) so "50506853000" → "0506853000" when a stray digit precedes
      const found = raw.match(/05\d{8}/);
      return found ? found[0] : null;
    }).filter(Boolean);

    if (!allPhones.length) continue;

    if (allPhones.length === 1) {
      // Single phone: extract name from the line
      const phone = allPhones[0];
      let cleaned = line
        .replace(new RegExp(PHONE_RE.source, 'g'), ' ')
        .replace(/\b\d{4,}\b/g, ' ')       // strip IDs/extensions
        .replace(/\b\d{1,3}\b/g, ' ')       // strip short numbers
        .replace(/\bDr\.?\s*/ig, 'Dr. ')    // normalize Dr prefix
        .replace(/[^A-Za-z\u0600-\u06FF .\'-]+/g, ' ')
        .replace(/\s+/g, ' ').trim();

      // Remove stop words but keep the name structure
      const tokens = cleaned.split(' ');
      const nameTokens = [];
      let hitDr = false;
      for (const tok of tokens) {
        const tl = tok.toLowerCase().replace(/^dr\.?$/, 'dr');
        if (tl === 'dr') { hitDr = true; nameTokens.push(tok); continue; }
        if (STOP_WORDS.has(tl) && !hitDr) continue;
        if (tok.length >= 2) nameTokens.push(tok);
        // Stop at first stop word AFTER we have a name (avoids pulling in job title)
        if (STOP_WORDS.has(tl) && nameTokens.length >= 2) break;
      }

      if (nameTokens.length >= 2) {
        addEntry(nameTokens.join(' '), phone);
      } else if (nameTokens.length === 1) {
        const solo = nameTokens[0].trim();
        if (solo.length >= 4 && !STOP_WORDS.has(solo.toLowerCase())) addEntry(solo, phone);
      }
    } else {
      // Multiple phones: Urology-style packed line — pair each name chunk with its phone
      // Strategy: split by phone positions, take text between consecutive phones as names
      let remaining = line;
      const segments = [];
      let lastIdx = 0;
      for (const match of line.matchAll(new RegExp(PHONE_RE.source, 'g'))) {
        segments.push({ text: line.slice(lastIdx, match.index), phone: allPhones[segments.length] });
        lastIdx = match.index + match[0].length;
      }
      // Last segment after final phone has no phone — skip

      for (const seg of segments) {
        const phone = seg.phone;
        if (!phone) continue;
        let chunk = seg.text
          .replace(/\b\d{4,}\b/g, ' ')
          .replace(/\b\d{1,3}\b/g, ' ')
          .replace(/[^A-Za-z\u0600-\u06FF .\'-]+/g, ' ')
          .replace(/\s+/g, ' ').trim();

        // Take the LAST 2-3 words of chunk as the name (they appear right before the phone)
        const words = chunk.split(' ').filter(Boolean);
        // Skip stop words from end
        while (words.length && STOP_WORDS.has(words[words.length - 1].toLowerCase())) words.pop();
        // Take up to 3 words as the name
        const nameWords = words.slice(-3);
        if (nameWords.length >= 1 && nameWords.join('').length >= 3) {
          addEntry(nameWords.join(' '), phone);
        }
      }
    }
  }

  return { map, altMap };
}

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

function resolvePhoneFromContactMap(name='', contactResult) {
  // contactResult is now { map, altMap } from buildContactMapFromText
  // Backwards compatible: also accept plain object (old format)
  const map    = (contactResult && contactResult.map)    || contactResult || {};
  const altMap = (contactResult && contactResult.altMap) || {};
  if (!name || !Object.keys(map).length) return null;

  // Normalize: strip Dr. prefix (with or without trailing space), collapse whitespace
  function normKey(n) {
    return n.toLowerCase()
      .replace(/^dr\.?\s*/,'')       // "Dr. " or "Dr." (no space, e.g. "Dr.Bikheet")
      .replace(/\./g,' ')            // "Dr.Bikheet" → "bikheet" after above; also "Al.Absi" → "al absi"
      .replace(/[\s-]+al[\s-]+/g,' al ')
      .replace(/\bal\b/g,'al')
      .replace(/[^a-z ]/g,' ')
      .replace(/\s+/g,' ')
      .trim();
  }

  // 1. Exact match
  if (map[name]) return { phone: map[name], uncertain: false };

  // 2. Normalized key match (handles "Dr." prefix differences, spacing)
  const nk = normKey(name);
  if (altMap[nk]) return { phone: altMap[nk], uncertain: false };

  // 3. Fuzzy match — score-based, with strict rules to avoid wrong assignments
  const nameParts = nk.split(' ').filter(p => p.length >= 4);

  // SAFETY: slash-compound names ("Reem S/Alsuwaiket", "Lujain/Faisal") are schedule
  // abbreviations for multiple doctors — never fuzzy-match them to a single contact.
  if (name.includes('/')) return null;

  // Block fuzzy for bare first-name queries ("Fatimah", "Faisal", "Qamar").
  // Expand dots, strip leading "Dr", count remaining words:
  //   "Fatimah"     → 1 word, 7 chars, no Al prefix → block
  //   "Dr Al Absi"  → strip Dr → "Al Absi" → 2 words → allow
  //   "Alhasawi"    → 1 word, starts with Al → allow (family name)
  //   "Dr.Bikheet"  → expand → "Dr Bikheet" → strip Dr → "Bikheet" → 1 word, 7 chars → block
  {
    const drStripped = name.replace(/\./g, ' ').trim().replace(/^Dr\s*/i, '').trim();
    const rw = drStripped.split(/\s+/).filter(w => w.length >= 2);
    if (rw.length === 0) return null;
    if (rw.length === 1) {
      const w = rw[0].toLowerCase();
      if (!w.startsWith('al') && w.length < 8) return null;
    }
  }

  let bestScore = 0;
  let bestPhone = null;
  let bestUncertain = true;

  for (const [key, phone] of Object.entries(map)) {
    const keyNorm = normKey(key);
    const keyParts = keyNorm.split(' ').filter(p => p.length >= 4);
    if (!keyParts.length) continue;

    let score = 0;

    for (const np of nameParts) {
      for (const kp of keyParts) {
        if (np === kp) score += 3;
        else if (kp.startsWith(np) || np.startsWith(kp)) score += 2;
        else if (kp.includes(np) || np.includes(kp)) score += 1;
      }
    }

    // Bonus: multi-part match
    if (nameParts.length >= 2 && keyParts.length >= 2 && score >= 4) score += 1;

    // Penalty: key has unmatched parts (wrong person)
    const unmatchedKey = keyParts.filter(kp => !nameParts.some(np => kp.startsWith(np) || np.startsWith(kp))).length;
    if (unmatchedKey >= 2) score -= 2;

    if (score > bestScore) {
      bestScore = score;
      bestPhone = phone;
      bestUncertain = !(score >= 5 || (nameParts.length >= 2 && score >= 4));
    }
  }

  // Minimum threshold: at least 2 points (one meaningful part matched)
  if (bestScore < 2) return null;

  return { phone: bestPhone, uncertain: bestUncertain };
}
// Format: "ABBREV(ID) Dr. Fullname Phone"
function buildAbbrLegend(text='') {
  const legend = {};
  const legendRe = /\b([A-Z]{2,6})\s*\([\w]+\)\s*(Dr\.?\s+[\w\u00C0-\u024F\xa0 .'-]+?)\s+(\d{9,10})\b/g;
  let m;
  while ((m = legendRe.exec(text)) !== null) {
    const abbr = m[1].trim();
    const name = m[2].replace(/\xa0/g, ' ').replace(/\s+/g, ' ').trim();
    const phone = m[3].startsWith('5') ? '0' + m[3] : m[3];
    if (abbr && name && phone) legend[abbr] = { name, phone };
  }
  return legend;
}

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
function parseDateTableEntries(text='', deptKey='') {
  const rawLines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const entries = [];
  const dayRe = /^(?:mon|tue|wed|thu|fri|sat|sun)/i;
  // Flexible date regex: handles "08/04/2026", "08 /04/ 2026", "08/0 4" (spaced digit), "1-Apr-26"
  const dateRe = /(\d{1,2})\s*[\/\-]\s*(\d\s*\d|\d{1,2}|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)(?:\s*[\/\-\s]\s*(\d{2,4}))?/i;
  const monthMap = { jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12' };

  const _parseDate = (dm) => {
    const day = dm[1].padStart(2,'0');
    const monRaw = dm[2].replace(/\s/g,''); // collapse "0 4" → "04"
    const mon = monthMap[monRaw.toLowerCase()] || monRaw.padStart(2,'0');
    return `${day}/${mon}`;
  };

  // Detect column roles from PDF header rows
  // Strategy: scan first 15 lines for column role labels; merge fragmented header lines.
  // PDFs often split headers across 2–4 lines due to column layout.
  const HEADER_WINDOW = rawLines.slice(0, Math.min(20, rawLines.length));
  const headerCandidate = HEADER_WINDOW
    .filter(l => /(1st|2nd|3rd|on.?call|on.?duty|resident|consultant|associate|fellow|assistant)/i.test(l)
                 && !dayRe.test(l) && !dateRe.test(l))
    .join(' ');  // merge fragmented header lines

  const roleLabels = [];
  if (headerCandidate) {
    // Orthopedics header: "RESIDENT ON CALL  2ND ON CALL  Pediatric Associate  Consultant"
    // ENT header: "1 ON CALL Resident  2 ON CALL  3rd ON CALL  ENT Consultant"
    // Map in column order left→right
    const h = headerCandidate.toLowerCase();
    // Detect each role tier in order it appears
    const tiers = [
      { re: /1st|first|\b1\s*on.?call|\b1st\s*on/,  label: '1st On-Call' },
      { re: /resident on.?call|resident/,             label: 'Resident On-Call' },
      { re: /2nd|second|\b2\s*on.?call/,             label: '2nd On-Call' },
      { re: /3rd|third|\b3\s*on.?call/,              label: '3rd On-Call' },
      { re: /associate|assistant\s*consultant/,        label: 'Associate Consultant On-Call' },
      { re: /fellow/,                                  label: 'Fellow On-Call' },
      { re: /consultant/,                              label: 'Consultant On-Call' },
    ];

    // Find positions of each tier in the header string and sort by position
    const found = [];
    for (const tier of tiers) {
      const m = tier.re.exec(h);
      if (m) found.push({ pos: m.index, label: tier.label });
    }
    found.sort((a,b) => a.pos - b.pos);
    found.forEach(f => { if (!roleLabels.includes(f.label)) roleLabels.push(f.label); });
  }

  // Specialty-specific overrides for well-known column layouts
  // These are applied when the PDF header is ambiguous or absent.
  const SPECIALTY_ROLE_LAYOUTS = {
    orthopedics:  ['Resident On-Call', '2nd On-Call', 'Associate/Pediatric Consultant', 'Consultant On-Call'],
    ent:          ['1st On-Call', '2nd On-Call', '3rd On-Call', 'Consultant On-Call'],
    urology:      ['Resident On-Call', '2nd On-Call', 'Consultant On-Call', 'Consultant On-Call'],
    hematology:   ['Resident/Fellow On-Call', 'Fellow 2nd On-Call', 'Consultant On-Call', 'Consultant Inpatient'],
    nephrology:   ['1st On-Call', '2nd On-Call', 'Consultant On-Call'],
    surgery:      ['Resident On-Duty (ER)', '2nd On-Duty', 'Consultant On-Duty'],
    neurosurgery: ['Resident On-Duty', '2nd On-Duty', 'Consultant On-Call'],
    neurology:    ['Resident On-Call', 'Consultant On-Call'],
    psychiatry:   ['Resident On-Call', 'Consultant On-Call'],
    dental:       ['1st On-Call', 'Consultant On-Call'],
    spine:        ['Resident On-Call', '2nd On-Call', 'Consultant On-Call'],
    gynecology:   ['Fellow/Resident', 'Resident On-Call', 'Consultant On-Call'],
  };

  // Specialties with fragmented or column-label-only headers where position-based detection
  // produces wrong role order. For these, always use SPECIALTY_ROLE_LAYOUTS.
  const FORCE_SPECIALTY_LAYOUT = new Set([
    'nephrology', 'urology', 'surgery', 'neurosurgery', 'neurology', 'gynecology',
  ]);

  // Use header-detected roles if we got ≥2 AND this specialty doesn't force the layout
  const useHeaderRoles = roleLabels.length >= 2 && !FORCE_SPECIALTY_LAYOUT.has(deptKey);
  const effectiveRoleLabels = useHeaderRoles ? roleLabels
    : (SPECIALTY_ROLE_LAYOUTS[deptKey] || ['1st On-Call', '2nd On-Call', 'Consultant On-Call', 'Consultant On-Call']);

  const defaultRoles = effectiveRoleLabels;

  function extractNamesFromText(src, dateKey) {
    // CRITICAL: strip noise BEFORE splitting, but do NOT collapse whitespace yet.
    // The double-spaces between columns are the only column separator signal.
    // Collapsing them first (via \s+→' ') destroys column boundaries.
    let stripped = src
      .replace(/^(?:mon|tue|wed|thu|fri|sat|sun)\w*\s*/i, '')
      .replace(dateRe, '')
      .replace(/\b\d{4}\b/g, '')
      .replace(/(?:\+?966[\s-]*)?0?5[\d\s-]{7,16}/g, '  ')  // replace phone with double-space to preserve boundary
      .replace(/\([^)]{1,6}\)/g, ' ')
      .replace(/\xa0/g, ' ');
    if (!stripped || stripped.trim().length < 2) return;

    // Split on 2+ spaces (column separator), tabs, or at "Dr " boundaries — BEFORE collapsing
    let parts = stripped.split(/\s{2,}|\t|(?=\bDr\.?\s+[A-Z])/);

    // Now normalize each part individually
    parts = parts.map(s => s.replace(/\s+/g, ' ').trim()).filter(s => {
      if (!s || s.length < 2) return false;
      if (/^\d+$/.test(s)) return false;
      if (/^(on|call|duty|resident|fellow|consultant|rota|role|date|day|name|april|march|may|june|jul|aug)$/i.test(s)) return false;
      // Skip header noise: "1st", "2nd", "(24-HOURS)", "Senior Resident"
      if (/^(?:\d+st|\d+nd|\d+rd|\d+th|\(24.hours?\))$/i.test(s)) return false;
      return true;
    });

    // Merge consecutive single-word parts that form a full name: ['Malak','Alamoudi'] → ['Malak Alamoudi']
    // BUT: do NOT merge if right side starts with "Dr." (it's a separate person)
    // AND: do NOT merge if it would create a Urology-style "Name Dr.X" collision
    const merged = [];
    let mi = 0;
    while (mi < parts.length) {
      const p = parts[mi];
      const next = mi + 1 < parts.length ? parts[mi + 1] : null;
      // Merge only if: both are single words AND neither looks like a Dr. prefix
      if (
        p.split(' ').length === 1 &&
        next !== null &&
        next.split(' ').length === 1 &&
        !/^Dr\.?/i.test(next) &&
        !/^Dr\.?/i.test(p)
      ) {
        merged.push(p + ' ' + next);
        mi += 2;
      } else {
        merged.push(p); mi++;
      }
    }

    merged.forEach((name, idx) => {
      const role = effectiveRoleLabels[idx] || (idx === 0 ? '1st On-Call' : 'On-Call');
      entries.push({ specialty: deptKey, date: dateKey, role, name, phone: '', section: normalizeUploadedSpecialtyLabel(ROTAS[deptKey]?.label || deptKey), parsedFromPdf: true });
    });
  }

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];           // ← BUG WAS HERE: was using undefined `line`
    // Accept lines starting with day name OR starting directly with a date (e.g. "08 /04/ 2026 Name")
    const startsWithDay  = dayRe.test(line);
    const startsWithDate = !startsWithDay && /^\d{1,2}\s*[\/\-]/.test(line.trimStart());
    if (!startsWithDay && !startsWithDate) continue;
    const dm = line.match(dateRe);
    if (!dm) continue;
    const dateKey = _parseDate(dm);

    // Layout A: names on same line as date
    const restOnSameLine = line
      .replace(/^(?:mon|tue|wed|thu|fri|sat|sun)\w*\s*/i, '')
      .replace(dateRe, '').trim();
    const hasNamesOnSameLine = restOnSameLine.length > 3 && /[A-Za-z]{3,}/.test(restOnSameLine);

    if (hasNamesOnSameLine) {
      extractNamesFromText(line, dateKey);
    }

    // Layout B: names on adjacent line (prev or next)
    // Only check adjacent if there are no names on the same line (ENT layout)
    if (!hasNamesOnSameLine) {
      if (i > 0) {
        const prevLine = rawLines[i - 1];
        if (!dayRe.test(prevLine) && !/^\d{1,2}\s*[\/\-]/.test(prevLine) && /[A-Za-z]{3,}/.test(prevLine)) {
          extractNamesFromText(prevLine, dateKey);
        }
      }
      if (i < rawLines.length - 1) {
        const nextLine = rawLines[i + 1];
        if (!dayRe.test(nextLine) && !/^\d{1,2}\s*[\/\-]/.test(nextLine) && /[A-Za-z]{3,}/.test(nextLine)) {
          extractNamesFromText(nextLine, dateKey);
        }
      }
    }
  }
  return dedupeParsedEntries(entries);
}

// ── INLINE DATE-SPLIT PARSER ──────────────────────────────────
// For PDFs that pack the month into a single long line with date separators.
// Handles two formats:
//   Nephrology: "01/04/2026  Name  Consultant  02/04/2026  ..."
//   Neurosurgery: "1-Apr-26  Name  Dr X  2-Apr-26  ..."
function parseSingleLineDateSplit(text='', deptKey='') {
  const entries = [];
  const fullDateRe  = /(\d{2}\/\d{2}\/\d{4})/g;
  const shortDateRe = /(\d{1,2})-Apr-26/g;

  function parseSegments(line, splitRe, toKey) {
    if ([...line.matchAll(splitRe)].length < 2) return;
    const segs = line.split(splitRe);
    for (let i = 1; i < segs.length - 1; i += 2) {
      const dateKey = toKey(segs[i]);
      const data    = (segs[i + 1] || '').trim();
      if (!data) continue;

      // Rejoin bare "Dr." fragments: "Dr.  Mazen Al Otaibi" → "Dr. Mazen Al Otaibi"
      const rawParts = data.split(/\s{2,}/);
      const parts = [];
      for (let j = 0; j < rawParts.length; j++) {
        const p = rawParts[j].trim();
        if (!p) continue;
        if (/^Dr\.\s*$/.test(p) && j + 1 < rawParts.length) {
          parts.push('Dr. ' + rawParts[++j].trim()); // consume next token
        } else {
          parts.push(p);
        }
      }

      parts.forEach(p => {
        if (/^\d+$/.test(p)) return;
        if (/^(MROD|Tx On Call|On Call|On-Call|mrod|Assistant consultants|Neurovascular|Neurosurgery|Residents|Department|Dammam)$/i.test(p)) return;
        if (/^[\w.]+@[\w.]+$/.test(p)) return;
        if (p.length < 2) return;
        if (/^Dr\.?\s*\w/.test(p) || /^[A-Z][a-z]/.test(p) || /\//.test(p) || /^[A-Z]\.\w/.test(p)) {
          const isConsultant = /^Dr\.?/i.test(p);
          entries.push({ specialty: deptKey, date: dateKey, role: isConsultant ? 'Consultant On-Call' : '1st On-Call', name: p, phone: '', parsedFromPdf: true });
        }
      });
    }
  }

  for (const line of text.split('\n')) {
    // dd/mm/yyyy (Nephrology)
    if ([...line.matchAll(fullDateRe)].length >= 2)
      parseSegments(line, fullDateRe, s => s.slice(0, 5));
    // d/m/yyyy or d/mm/yyyy (Liver Transplant) — use flexible regex
    const flexDateRe = /(\d{1,2}\/\d{1,2}\/\d{4})/g;
    if ([...line.matchAll(flexDateRe)].length >= 2)
      parseSegments(line, flexDateRe, s => {
        const [d, m] = s.split('/');
        return `${d.padStart(2,'0')}/${m.padStart(2,'0')}`;
      });
    // N-Apr-26 (Neurosurgery)
    if ([...line.matchAll(shortDateRe)].length >= 2)
      parseSegments(line, shortDateRe, s => s.split('-')[0].padStart(2,'0') + '/04');
  }
  return dedupeParsedEntries(entries);
}

// ── GYNECOLOGY 24H-BLOCK PARSER ───────────────────────────────
// Gynecology packs all 30 days into one line separated by "24 H" markers.
// Block index maps directly to calendar day (block 0 = Apr 1, block 7 = Apr 8).
function parseGynecologyPdfEntries(text='', deptKey='gynecology') {
  const entries = [];
  const contactResult = buildContactMapFromText(text);
  const roles = ['Fellow / Resident', 'Resident', 'Consultant On-Call'];

  // Find the packed line with "24 H" blocks
  for (const line of text.split('\n')) {
    if (!line.includes('24 H')) continue;
    const blocks = line.split(/\s*24\s*H\s*/);
    // blocks[0] = header, blocks[1] = Apr 1, blocks[2] = Apr 2 ...
    for (let b = 1; b < blocks.length; b++) {
      const day = b; // block 1 = Apr 1
      if (day < 1 || day > 30) continue;
      const dateKey = `${String(day).padStart(2,'0')}/04`;
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
  const source = String(body || '').replace(/\b\d{3,}.*$/, '').trim();
  const tokens = [];
  let i = 0;
  while (i < source.length) {
    if (/\s/.test(source[i])) {
      i += 1;
      continue;
    }
    if (/^Dr\.?\s*/i.test(source.slice(i))) {
      const rest = source.slice(i).replace(/^Dr\.?\s*/i, '');
      const words = rest.split(/\s+/);
      const take = [];
      for (const word of words) {
        if (!word) continue;
        if (/^\d/.test(word)) break;
        if (/^(Wednesday|Thursday|Friday|Saturday|Sunday|Monday|Tuesday)$/i.test(word)) break;
        take.push(word);
        if (take.length >= 2) break;
      }
      if (take.length) {
        tokens.push(normalizeNeurosurgeryName(`Dr. ${take.join(' ')}`));
        i += (`Dr. ${take.join(' ')}`).length;
        continue;
      }
    }
    const nextSpace = source.indexOf(' ', i);
    const token = source.slice(i, nextSpace === -1 ? source.length : nextSpace).trim();
    if (token) tokens.push(token);
    i = nextSpace === -1 ? source.length : nextSpace + 1;
  }
  return tokens.filter(Boolean);
}

function parseNeurosurgeryPdfEntries(text='', deptKey='neurosurgery') {
  const entries = [];
  const rowRe = /^(Wednesday|Thursday|Friday|Saturday|Sunday|Monday|Tuesday)\s+(\d{1,2})-Apr-26\s+(.+)$/i;
  const lines = String(text || '').split(/\n/).map(line => line.trim()).filter(Boolean);
  lines.forEach(line => {
    const match = line.match(rowRe);
    if (!match) return;
    const dateKey = `${String(parseInt(match[2], 10)).padStart(2, '0')}/04`;
    const body = match[3].replace(/\b\d{3,}.*$/, '').trim();
    const tokens = tokenizeNeurosurgeryRow(body);
    if (tokens.length < 4) return;
    const dayResident = tokens[0] || '';
    const nightResident = tokens[1] || '';
    const secondOnCall = tokens[2] || '';
    const consultant = tokens[3] || '';
    const associate = tokens[4] || '';
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
    add('Resident On-Duty (Day)', dayResident, '07:30', '17:00', 'day');
    add('Resident On-Duty (Night)', nightResident, '17:00', '07:30', 'night');
    add('Associate Consultant — Second On-Call', secondOnCall, '07:30', '07:30', '24h');
    add('Consultant On-Call 24h', consultant, '07:30', '07:30', '24h');
    add('Associate Consultant On-Call', associate, '07:30', '07:30', '24h');
  });
  const deduped = dedupeParsedEntries(entries);
  deduped._templateDetected = deduped.length >= 20;
  deduped._templateName = deduped._templateDetected ? 'neurosurgery-monthly-2026' : '';
  return deduped;
}

const KPTX_NAME_HINTS = {
  'dr abdulnaser al abadi':'Dr. Abdulnaser Al Abadi',
  'dr abdulnaser alabadi':'Dr. Abdulnaser Al Abadi',
  'dr khalid akkari':'Dr. Khalid B. Akkari',
  'dr khalid b akkari':'Dr. Khalid B. Akkari',
  'dr maher al demerdash':'Dr. Maher Aldemerdash',
  'dr maher aldemerdash':'Dr. Maher Aldemerdash',
  'dr najeeb al musaied':'Dr. Najeeb Al Musaied',
  'dr fahad al otaibi':'Dr. Fahad Al Otaibi',
  'judee selem':'Judee Selem',
  'amer ahmed':'Amer Ahmed',
  'eman el rashidy':'Eman El Rashidy',
  'eman rashidi':'Eman El Rashidy',
};

const KPTX_COORDINATOR_NAMES = ['Judee Selem', 'Amer Ahmed', 'Eman El Rashidy', 'Eman Rashidi'];

function normalizeKptxName(raw='') {
  const clean = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  const hinted = KPTX_NAME_HINTS[canonicalName(clean)] || clean;
  return hinted.replace(/\bDr\.\s*([A-Z])/g, 'Dr. $1').replace(/\s+/g, ' ').trim();
}

function parseKptxPdfEntries(text='', deptKey='kptx') {
  const entries = [];
  const rowRe = /^(Wednesday|Thursday|Friday|Saturday|Sunday|Monday|Tuesday)\s+(\d{2})\/04\/2026\s+(.+)$/i;
  const lines = String(text || '').split(/\n/).map(line => line.trim()).filter(Boolean);
  const dept = ROTAS[deptKey] || { contacts:{} };
  const contactResult = buildContactMapFromText(text);

  const add = (dateKey='', role='', name='', startTime='', endTime='', shiftType='') => {
    const normalizedName = normalizeKptxName(name);
    if (!normalizedName) return;
    const resolved = resolvePhoneFromContactMap(normalizedName, contactResult)
      || resolvePhone(dept, { name: normalizedName, phone:'' })
      || { phone:'', uncertain:true };
    entries.push({
      specialty: deptKey,
      date: dateKey,
      role,
      name: normalizedName,
      phone: resolved.phone || '',
      phoneUncertain: !resolved.phone || !!resolved.uncertain,
      startTime,
      endTime,
      shiftType,
      parsedFromPdf: true,
    });
  };

  lines.forEach(line => {
    const match = line.match(rowRe);
    if (!match) return;
    const dateKey = `${match[2]}/04`;
    const body = match[3].trim();
    const coordinator = KPTX_COORDINATOR_NAMES
      .map(name => normalizeKptxName(name))
      .find(name => new RegExp(`${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i').test(body)) || '';
    const withoutCoordinator = coordinator
      ? body.slice(0, Math.max(0, body.toLowerCase().lastIndexOf(coordinator.toLowerCase()))).trim()
      : body;
    const consultantMatch = withoutCoordinator.match(/(Dr\.?\s+[A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,5})$/i);
    const consultant = consultantMatch ? normalizeKptxName(consultantMatch[1]) : '';
    const prefix = consultantMatch
      ? withoutCoordinator.slice(0, consultantMatch.index).trim()
      : withoutCoordinator;
    const fields = prefix.split(/\s{2,}/).map(part => part.trim()).filter(Boolean);
    if (!consultant || !fields.length) return;

    const dayRole = /Friday|Saturday/i.test(match[1]) ? 'Weekend Coverage' : 'Day Coverage';
    if (fields.length >= 3) {
      add(dateKey, dayRole, fields[0], '07:30', '16:30', 'day');
      add(dateKey, 'After-Hours On-Call', fields[1], '16:30', '07:30', 'night');
      add(dateKey, '2nd On-Call After-Hours', fields[2], '16:30', '07:30', 'night');
    } else {
      add(dateKey, dayRole, fields[0], '07:30', '16:30', 'day');
      add(dateKey, 'After-Hours On-Call', fields[1] || '', '16:30', '07:30', 'night');
    }
    add(dateKey, 'Consultant On-Call 24h', consultant, '07:30', '07:30', '24h');
    add(dateKey, 'Clinical Coordinator On-Call', coordinator, '07:30', '07:30', '24h');
  });
  const deduped = dedupeParsedEntries(entries);
  deduped._templateDetected = deduped.length >= 20;
  deduped._templateName = deduped._templateDetected ? 'kptx-monthly-2026' : '';
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
  const dateRe = /^(Wednesday|Thursday|Friday|Saturday|Sunday|Monday|Tuesday)\s+(\d{1,2})\/(\d{1,2})\/2026(?:\s+(.*))?$/i;
  const stopRe = /^(Outpatient Service|Day|Date|\(G\)|Inpatient Service|4\.2026|Liver Transplant Call Schedule|KFSHD ID\/|Adult Liver Transplant Team Contact Details|Clinical|Coordinator Adult Liver Tx|Name$)/i;
  const lines = String(text || '').split(/\n/).map(line => line.trimEnd()).filter(Boolean);
  const blocks = [];
  let current = null;

  lines.forEach(line => {
    const trimmed = line.trim();
    const match = trimmed.match(dateRe);
    if (match) {
      if (current) blocks.push(current);
      current = {
        dateKey: `${String(parseInt(match[2], 10)).padStart(2, '0')}/${String(parseInt(match[3], 10)).padStart(2, '0')}`,
        chunks: [match[4] || ''],
      };
      return;
    }
    if (!current) return;
    if (stopRe.test(trimmed)) {
      blocks.push(current);
      current = null;
      return;
    }
    current.chunks.push(trimmed);
  });
  if (current) blocks.push(current);

  const add = (dateKey='', role='', rawName='', startTime='', endTime='', shiftType='') => {
    const names = splitLiverCoverageNames(rawName);
    if (!names.length && !/^SMRO/i.test(rawName || '')) return;
    if (/^SMRO/i.test(rawName || '')) {
      entries.push({
        specialty: deptKey,
        date: dateKey,
        role,
        name: 'SMRO',
        phone: '',
        phoneUncertain: true,
        startTime,
        endTime,
        shiftType,
        parsedFromPdf: true,
      });
      return;
    }
    names.forEach(name => {
      const resolved = resolvePhoneFromContactMap(name, contactResult)
        || resolvePhone(dept, { name, phone:'' })
        || { phone:'', uncertain:true };
      entries.push({
        specialty: deptKey,
        date: dateKey,
        role,
        name,
        phone: resolved.phone || '',
        phoneUncertain: !resolved.phone || !!resolved.uncertain,
        startTime,
        endTime,
        shiftType,
        parsedFromPdf: true,
      });
    });
  };

  blocks.forEach(block => {
    const fields = block.chunks.join('   ').split(/\s{2,}/).map(part => part.trim()).filter(Boolean);
    if (!fields.length) return;
    add(block.dateKey, 'Assistant Consultant 1st On-Call (07:30–16:30)', fields[0], '07:30', '16:30', 'day');

    if (/^SMRO/i.test(fields[1] || '')) {
      add(block.dateKey, 'Night On-Call (9PM–9AM)', fields[1], '21:00', '07:30', 'night');
      add(block.dateKey, '2nd On-Call', fields[2] || '', '16:30', '07:30', 'night');
      add(block.dateKey, '3rd On-Call', fields[3] || '', '21:00', '07:30', 'night');
      add(block.dateKey, 'Clinical Coordinator 24h', fields[4] || '', '07:30', '07:30', '24h');
      return;
    }

    add(block.dateKey, 'After-Hours On-Call', fields[1] || '', '16:30', '07:30', 'night');
    add(block.dateKey, '2nd On-Call', fields[2] || '', '16:30', '07:30', 'night');
    add(block.dateKey, '3rd On-Call', fields[3] || '', '21:00', '07:30', 'night');
    if (fields[4] && !/IM\.?\s*Res|resident/i.test(fields[4])) {
      add(block.dateKey, 'Clinical Coordinator 24h', fields[4], '07:30', '07:30', '24h');
    }
  });

  const deduped = dedupeParsedEntries(entries);
  deduped._templateDetected = /Liver Transplant Call Schedule/i.test(text) && deduped.length >= 20;
  deduped._templateName = deduped._templateDetected ? 'liver-monthly-2026' : '';
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
};

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
  if (resolved) {
    const knownName = resolved.name || hint;
    return { name: knownName, phone: resolved.phone || '', phoneUncertain: !!resolved.uncertain };
  }
  return { name: hint, phone:'', phoneUncertain:true };
}

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
  const dayRowRe = /^(SUN|MON|TUE|WED|THU|FRI|SAT)\s+(\d{1,2})\s+April\s+2026\s+(.+)$/i;
  const mainRows = [];

  lines.forEach(line => {
    const match = line.match(dayRowRe);
    if (!match) return;
    const day = String(parseInt(match[2], 10)).padStart(2, '0');
    const tokens = match[3].split(/\s+/).filter(Boolean);
    if (tokens.length < 2) return;
    mainRows.push({
      date: `${day}/04`,
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
  deduped._templateName = deduped._templateDetected ? 'surgery-monthly-2026' : '';
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
  'Dr. Bader':'Dr. Bader Alenzi',
  'Dr. Roaa':'Dr. Roaa Khallaf',
  'Dr. Khaled':'Dr. Khalid Al Rasheed',
  'Dr Rakan Al Shammari':'Dr. Rakan Al Shammari',
  'Rakan':'Dr. Rakan Al Shammari',
  'Mohammed AW':'Dr. Mohammed Alawazem',
  'Ghady':'Dr. Ghady AlFuridy',
  'Hawra':'Dr. Hawra Alshakhori',
};

function buildNeurologyUploadContactMap(text='') {
  const map = { ...(ROTAS.neurology?.contacts || {}) };
  const lines = text.split(/\n/).map(line => line.trim()).filter(Boolean);
  const addPhone = (rawName='', rawPhone='') => {
    const cleanedName = rawName.replace(/\s+/g, ' ').replace(/^Dr\.?\s*/i, 'Dr. ').trim();
    let phone = String(rawPhone || '').replace(/[^\d]/g, '');
    if (/^5\d{8}$/.test(phone)) phone = `0${phone}`;
    if (!/^05\d{8}$/.test(phone) || !cleanedName) return;
    map[cleanedName] = phone;
  };

  lines.forEach(line => {
    const directMatch = line.match(/(Dr\.?\s*[A-Za-z][A-Za-z.'-]*(?:\s+[A-Za-z][A-Za-z.'-]*){0,4}).*?\b(05\d{8}|5\d{8})\b/);
    if (directMatch) {
      addPhone(directMatch[1], directMatch[2]);
      return;
    }
    const residentMatch = line.match(/^(?:Dr\.?\s*)?([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,3})\s+(05\d{8}|5\d{8})\b/);
    if (residentMatch) addPhone(residentMatch[1], residentMatch[2]);
  });

  const firstNameMatches = new Map();
  Object.entries(map).forEach(([name, phone]) => {
    const bare = name.replace(/^Dr\.?\s*/i, '').trim();
    const first = bare.split(/\s+/)[0];
    if (!first) return;
    if (!firstNameMatches.has(first)) firstNameMatches.set(first, []);
    firstNameMatches.get(first).push({ name, phone });
  });
  firstNameMatches.forEach((matches, first) => {
    if (matches.length === 1) map[first] = matches[0].phone;
  });
  return map;
}

function resolveNeurologyTemplatePerson(alias='', contactMap={}) {
  const trimmed = alias.replace(/\s+/g, ' ').trim();
  if (!trimmed) return { name:'', phone:'' };
  const hinted = NEUROLOGY_ALIAS_HINTS[trimmed] || trimmed;
  const normalizedHint = hinted.replace(/^Dr\.?\s*/i, '').toLowerCase();
  const exactKey = Object.keys(contactMap).find(key => key.replace(/^Dr\.?\s*/i, '').toLowerCase() === normalizedHint);
  const firstToken = normalizedHint.split(/\s+/)[0];
  const firstTokenKey = !exactKey
    ? Object.keys(contactMap).find(key => key.replace(/^Dr\.?\s*/i, '').toLowerCase().startsWith(`${firstToken} `))
    : '';
  const name = exactKey || firstTokenKey || hinted;
  return {
    name,
    phone: contactMap[name] || contactMap[trimmed] || '',
  };
}

function parseNeurologyResidentAliases(prefix='') {
  const tokens = prefix.split(/\s+/).filter(Boolean);
  if (!tokens.length) return { junior:'', senior:'' };
  if (tokens.length === 1) return { junior:tokens[0], senior:'' };
  return {
    junior: tokens.slice(0, -1).join(' '),
    senior: tokens.slice(-1).join(' '),
  };
}

function parseNeurologyPdfEntries(text='', deptKey='neurology') {
  const entries = [];
  const templateDetected = isNeurologyDutyTemplate(text);
  const contactMap = buildNeurologyUploadContactMap(text);
  const lines = text.split(/\n/).map(line => line.trim()).filter(Boolean);
  const rowRe = /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat)\s+(\d{1,2})-Apr-26\s+(.+)$/i;
  let inOnCallTable = false;

  lines.forEach(line => {
    if (/Junior Resident\s+Senior Resident/i.test(line)) {
      inOnCallTable = true;
      return;
    }
    if (/Approved by:|Neurology OPD schedule|Stroke pager/i.test(line)) {
      inOnCallTable = false;
    }
    if (!inOnCallTable) return;
    const match = line.match(rowRe);
    if (!match) return;
    let tail = (match[3] || '').replace(/\s+\d{6,}(?:\s+\d{6,})*$/, '').trim();
    if (!tail) return;
    const firstDrIndex = tail.search(/Dr\.?\s*/i);
    if (firstDrIndex <= 0) return;
    const prefix = tail.slice(0, firstDrIndex).trim();
    if (!prefix || prefix.split(/\s+/).length > 3) return;
    const doctorSegments = tail.slice(firstDrIndex)
      .split(/(?=Dr\.?\s*)/i)
      .map(item => item.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    if (doctorSegments.length < 2) return;

    const { junior, senior } = parseNeurologyResidentAliases(prefix);
    const dateKey = `${String(parseInt(match[2], 10)).padStart(2, '0')}/04`;

    const pushEntry = (nameAlias, role) => {
      if (!nameAlias || /associate consultants|residents/i.test(nameAlias)) return;
      const resolved = resolveNeurologyTemplatePerson(nameAlias, contactMap);
      if (!resolved.name) return;
      entries.push({
        specialty: deptKey,
        date: dateKey,
        role,
        name: resolved.name,
        phone: resolved.phone || '',
        shiftType: 'on-call',
        startTime: '16:30',
        endTime: '07:30',
        section: normalizeUploadedSpecialtyLabel(ROTAS[deptKey]?.label || deptKey),
        parsedFromPdf: true,
      });
    };

    pushEntry(junior, '1st On-Call Resident');
    pushEntry(senior, '2nd On-Call Senior Resident');
    pushEntry(doctorSegments[0] || '', 'Associate Consultant On-Call');
    pushEntry(doctorSegments[1] || doctorSegments[0] || '', 'Consultant On-Call');
    pushEntry(doctorSegments[2] || '', 'Stroke On-Call Consultant');
  });

  const deduped = dedupeParsedEntries(entries);
  deduped._templateDetected = templateDetected;
  deduped._templateName = templateDetected ? 'neurology-monthly-2026' : '';
  return deduped;
}

const RADIOLOGY_DUTY_NAME_EXPANSIONS = {
  'a mohammed':'Dr. Adel Mohammed',
  'a. mohammed':'Dr. Adel Mohammed',
  's mahmoud':'Dr. Safaa Mahmoud',
  's.mahmoud':'Dr. Safaa Mahmoud',
  'k balawi':'Dr. Khalid Balawi',
  'k.balawi':'Dr. Khalid Balawi',
  'h aboras':'Dr. Hana Aboras',
  'h.aboras':'Dr. Hana Aboras',
  'e momen':'Dr. Eman Al Momen',
  'e.momen':'Dr. Eman Al Momen',
  'f bosaid':'Dr. Fajer Bosaid',
  'f.bosaid':'Dr. Fajer Bosaid',
  'a abdulqader':'Dr. Abdulrahman AlAbdulgader',
  'a.abdulqader':'Dr. Abdulrahman AlAbdulgader',
  'a abdulgader':'Dr. Abdulrahman AlAbdulgader',
  'h muhaish':'Dr. Husam Al Muhaish',
  'h. muhaish':'Dr. Husam Al Muhaish',
  'h arfaj':'Dr. Husain Al Arfaj',
  'h. arfaj':'Dr. Husain Al Arfaj',
  'f molani':'Dr. Fadhel AlMolani',
  'f. molani':'Dr. Fadhel AlMolani',
  'a suwailem':'Dr. Abdullah Al Suwailem',
  'a. suwailem':'Dr. Abdullah Al Suwailem',
  'r hazmi':'Dr. Rami Hazmi',
  'r. hazmi':'Dr. Rami Hazmi',
  'a dhafiri':'Dr. Ahmed Al Dhafiri',
  'a. dhafiri':'Dr. Ahmed Al Dhafiri',
  'h ismail':'Dr. Huda Ismail',
  'h. ismail':'Dr. Huda Ismail',
  'a buali':'Dr. Ahmed Al Buali',
  'a. buali':'Dr. Ahmed Al Buali',
  'a naim':'Dr. Abdulrahman Naim',
  'a. naim':'Dr. Abdulrahman Naim',
  'mohammed al ibrahim':'Mohammed Al Ibrahim',
  'fatimah albahhar':'Fatimah Albahhar',
  'sokaina al khuder':'Sokaina Al Khuder',
  'mohammed al anaki':'Mohammed Al Anaki',
  'bayan al kaby':'Bayan Al Kaby',
  'abdullah al mujaljal':'Abdullah Al Mujaljal',
  'rawan alanezi':'Rawan Alanezi',
  'm al saffar':'Mohammed Al Saffar',
  'm. al saffar':'Mohammed Al Saffar',
  'mohammed al saffar':'Mohammed Al Saffar',
  'a alshammari':'Abdulrahman Alshammari',
  'a. alshammari':'Abdulrahman Alshammari',
  'm mawahib khalalah':'Dr. Mawaheb Kalalah',
  'mawahib khalalah':'Dr. Mawaheb Kalalah',
  'reda alwosaibi':'Reda AlWosaibi',
  'wafa h':'Wafa H.',
  'm faifi':'M. Faifi',
  'n alkhatib':'N. Alkhatib',
  'n makhaita':'N. Makhaita',
};

const RADIOLOGY_DUTY_TEMPLATE_ROLE_HINTS = {
  'CT Neuro (ER)': {
    resident: ['Rawan Alanezi', 'Mohammed Al Saffar', 'Abdulrahman Alshammari'],
    consultant: ['Dr. Rami Hazmi'],
  },
  'CT - Neuro': {
    consultant: ['Dr. Husam Al Muhaish', 'Dr. Husain Al Arfaj', 'Dr. Fadhel AlMolani', 'Dr. Abdullah Al Suwailem'],
  },
  'CT - General': {
    consultant: ['Dr. Khalid Balawi', 'Dr. Safaa Mahmoud', 'Dr. Hana Aboras', 'Dr. Eman Al Momen', 'Dr. Fajer Bosaid', 'Dr. Abdulrahman AlAbdulgader'],
  },
  'Ultrasound - Abdomen': {
    consultant: ['Dr. Tarek Saied', 'Dr. Adel Mohammed', 'Dr. Safaa Mahmoud'],
    fellow: ['Ibtihal S'],
  },
  'Ultrasound - MSK': {
    consultant: ['Dr. Ahmed Al Dhafiri'],
    fellow: ['Fatimah Albahhar', 'Mohammed Al Ibrahim', 'Fatimah Buqais'],
  },
  'X-Ray / General': {
    consultant: ['Dr. Huda Ismail'],
    fellow: ['Mohammed Al Ibrahim', 'Fatimah Buqais'],
  },
  'Nuclear / PET': {
    consultant: ['Dr. Ahmed Al Buali', 'Dr. Abdulrahman Naim'],
    fellow: ['Abdullah Al Umair'],
  },
};

function inferRadiologyDutyRole(section='', name='', fallbackRole='') {
  const hints = RADIOLOGY_DUTY_TEMPLATE_ROLE_HINTS[section] || {};
  const canon = canonicalName(name || '');
  const inList = list => Array.isArray(list) && list.some(item => canonicalName(item) === canon);
  const fallbackLow = (fallbackRole || '').toLowerCase();

  if (inList(hints.consultant)) return 'Consultant';
  if (inList(hints.fellow)) return 'Fellow / Assistant';
  if (inList(hints.resident)) return 'Resident';

  if (/fellow|assistant/.test(fallbackLow)) return 'Fellow / Assistant';
  if (/resident/.test(fallbackLow)) return 'Resident';
  if (/consultant/.test(fallbackLow)) {
    if (!/^dr\.?/i.test(name || '') && hints.resident && hints.resident.length) return 'Resident';
    return 'Consultant';
  }
  if (/^dr\.?/i.test(name || '')) return 'Consultant';
  if (section === 'CT Neuro (ER)') return 'Resident';
  return fallbackRole || 'Resident';
}

function getRadiologyDutyResolvedName(name='') {
  if (!name) return '';
  return RADIOLOGY_DUTY_NAME_EXPANSIONS[canonicalName(name)] || name;
}

function getRadiologyDutyNameTokens(name='') {
  return canonicalName(getRadiologyDutyResolvedName(name)).split(' ').filter(Boolean);
}

function hasRadiologyDutySharedLastToken(a='', b='') {
  const aTokens = getRadiologyDutyNameTokens(a);
  const bTokens = getRadiologyDutyNameTokens(b);
  if (!aTokens.length || !bTokens.length) return false;
  return aTokens[aTokens.length - 1] === bTokens[bTokens.length - 1];
}

function hasRadiologyDutyCompatibleInitial(rawName='', candidateName='') {
  const rawTokens = canonicalName(rawName).split(' ').filter(Boolean);
  const candidateTokens = getRadiologyDutyNameTokens(candidateName);
  if (!rawTokens.length || !candidateTokens.length) return true;
  const rawFirst = rawTokens[0] || '';
  if (rawFirst.length !== 1) return true;
  return candidateTokens[0] && candidateTokens[0].startsWith(rawFirst);
}

function scoreRadiologyDutyDisplayEntry(entry={}) {
  const confidenceScore = entry._confidence === 'high' ? 20 : entry._confidence === 'medium' ? 10 : 0;
  const name = String(entry.name || '').trim();
  const resolvedName = getRadiologyDutyResolvedName(name);
  const hasPhone = entry.phone ? 10 : 0;
  const certainPhone = entry.phone && !entry.phoneUncertain ? 6 : 0;
  const exactResolvedName = canonicalName(name) === canonicalName(resolvedName) ? 0 : 3;
  const fullNameBonus = getRadiologyDutyNameTokens(name).length >= 2 && !/^[A-Z]\./.test(name) ? 4 : 0;
  const doctorPrefixBonus = /^Dr\.?\s/i.test(name) ? 1 : 0;
  return confidenceScore + hasPhone + certainPhone + exactResolvedName + fullNameBonus + doctorPrefixBonus;
}

function pickBetterRadiologyDutyEntry(current, candidate) {
  if (!current) return candidate;
  const currentScore = scoreRadiologyDutyDisplayEntry(current);
  const candidateScore = scoreRadiologyDutyDisplayEntry(candidate);
  if (candidateScore !== currentScore) return candidateScore > currentScore ? candidate : current;
  const currentName = String(current.name || '');
  const candidateName = String(candidate.name || '');
  if (candidateName.length !== currentName.length) return candidateName.length > currentName.length ? candidate : current;
  return candidate;
}

function dedupeRadiologyDutyDisplayEntries(entries=[]) {
  const byIdentity = new Map();
  entries.forEach(entry => {
    const sectionKey = normalizeText(entry.section || '');
    const roleKey = normalizeText(entry.role || '');
    const shiftKey = [entry.date || '', entry.startTime || '', entry.endTime || '', entry.shiftLabel || ''].join('|');
    const phoneKey = cleanPhone(entry.phone || '');
    const nameKey = canonicalName(getRadiologyDutyResolvedName(entry.name || ''));
    const identityKey = [
      sectionKey,
      roleKey,
      shiftKey,
      phoneKey || nameKey,
    ].join('|');
    const existing = byIdentity.get(identityKey);
    byIdentity.set(identityKey, pickBetterRadiologyDutyEntry(existing, entry));
  });
  return [...byIdentity.values()];
}

function normalizeRadiologyDutyName(raw='', rawText='') {
  const pretty = raw
    .replace(/([A-Z])\.([A-Za-z])/g, '$1. $2')
    .replace(/\s+/g, ' ')
    .replace(/\s+\|\s+/g, ' | ')
    .trim();
  const key = canonicalName(pretty);
  const expanded = RADIOLOGY_DUTY_NAME_EXPANSIONS[key] || pretty;
  if (!expanded) return pretty;
  const hinted = Object.values(RADIOLOGY_DUTY_TEMPLATE_ROLE_HINTS)
    .flatMap(group => [...(group.consultant || []), ...(group.fellow || []), ...(group.resident || [])]);
  if (hinted.some(name => canonicalName(name) === canonicalName(expanded))) {
    return expanded;
  }
  const sourceCanon = canonicalName(rawText || '');
  const expandedTokens = canonicalName(expanded).split(' ').filter(token => token.length >= 3);
  const sourceHasExpanded = sourceCanon.includes(canonicalName(expanded))
    || (expandedTokens.length >= 2 && expandedTokens.every(token => sourceCanon.includes(token)));
  return sourceHasExpanded ? expanded : pretty;
}

function parseRadiologyDutyNameList(fragment='', rawText='') {
  const cleaned = fragment
    .replace(/\([^)]*\)/g, ' ')
    .replace(/([A-Za-z])\/(?=[A-Za-z])/g, '$1 | ')
    .replace(/\s+\|\s+/g, '|')
    .replace(/\s{2,}/g, ' ')
    .trim();
  const matches = cleaned.match(/(?:Dr\.?\s*)?[A-Z][A-Za-z'-]+(?:\s+(?:Al|al|[A-Z][A-Za-z'-]+)){1,4}(?:\s*\|\s*(?:Dr\.?\s*)?[A-Z][A-Za-z'-]+(?:\s+(?:Al|al|[A-Z][A-Za-z'-]+)){1,4})*|(?:Dr\.?\s*)?[A-Z]\.\s*[A-Za-z][A-Za-z'-]+(?:\s*\|\s*(?:Dr\.?\s*)?[A-Z]\.\s*[A-Za-z][A-Za-z'-]+)*/g) || [];
  const names = [];
  matches.forEach(match => {
    match.split('|').map(part => part.trim()).filter(Boolean).forEach(part => {
      if (/^(consultant|residents?|fellow|assistant|associate|outside|admin|section|specialty|weekly|rota|day|am|pm)$/i.test(part)) return;
      const normalized = normalizeRadiologyDutyName(part, rawText);
      if (normalized && !names.includes(normalized)) names.push(normalized);
    });
  });
  return names;
}

function resolveRadiologyDutyPhone(name='', dept) {
  if (!name || !dept) return { phone:'', uncertain:true };
  const direct = resolvePhone(dept, { name, phone:'' });
  if (direct) return direct;
  const expanded = RADIOLOGY_DUTY_NAME_EXPANSIONS[canonicalName(name)];
  if (expanded) {
    const retry = resolvePhone(dept, { name: expanded, phone:'' });
    if (retry) return retry;
  }
  return { phone:'', uncertain:true };
}

function extractRadiologyDutyWindow(text='', startPattern, endPatterns=[]) {
  if (!text || !startPattern) return '';
  const startMatch = text.match(startPattern);
  if (!startMatch || typeof startMatch.index !== 'number') return '';
  const start = startMatch.index;
  const tail = text.slice(start);
  let end = tail.length;
  endPatterns.forEach(pattern => {
    const match = tail.slice(1).match(pattern);
    if (match && typeof match.index === 'number') {
      end = Math.min(end, match.index + 1);
    }
  });
  return tail.slice(0, end);
}

function isRadiologyDutyTemplateText(text='') {
  const markers = [
    /NEURO REFERRAL/i,
    /BODY REFERRAL/i,
    /SECTION SPECIALTY/i,
    /WEEKLY DUTY ROTA/i,
    /Ultrasound \(Consultant\)/i,
    /CT \(In-Patient & ER\) \(Consultant\)|CT \(In-Paitent & ER\)/i,
  ];
  return markers.filter(re => re.test(text || '')).length >= 4;
}

function getRadiologyDutyContactNames(contactResult) {
  const map = (contactResult && contactResult.map) || contactResult || {};
  const preferred = new Map();
  Object.keys(map).forEach(name => {
    const cleaned = (name || '').trim();
    if (!cleaned) return;
    const bare = cleaned.replace(/^Dr\.?\s*/i, '').trim();
    const parts = bare.split(/\s+/).filter(Boolean);
    if (parts.length < 2) return;
    const key = canonicalName(bare);
    if (!key) return;
    const current = preferred.get(key);
    if (!current || cleaned.length > current.length || /^Dr\./i.test(cleaned)) preferred.set(key, cleaned);
  });
  return [...preferred.values()];
}

function resolveRadiologyDutyCandidateName(rawName='', contactResult=null, rawText='') {
  const pretty = normalizeRadiologyDutyName(rawName, rawText);
  if (!pretty) return { name:'', confidence:'low', matched:false };
  const expanded = RADIOLOGY_DUTY_NAME_EXPANSIONS[canonicalName(pretty)] || pretty;
  const contacts = getRadiologyDutyContactNames(contactResult);
  if (!contacts.length) return { name:'', confidence:'low', matched:false };

  const exactExpanded = contacts.find(contact => canonicalName(contact) === canonicalName(expanded));
  if (exactExpanded) return { name: exactExpanded, confidence:'high', matched:true };

  const strictCandidates = contacts.filter(contact =>
    hasRadiologyDutySharedLastToken(expanded, contact)
    && hasRadiologyDutyCompatibleInitial(pretty, contact)
  );
  const candidatePool = strictCandidates.length ? strictCandidates : contacts.filter(contact =>
    hasRadiologyDutySharedLastToken(pretty, contact)
    && hasRadiologyDutyCompatibleInitial(pretty, contact)
  );
  if (!candidatePool.length) return { name:'', confidence:'low', matched:false };

  let best = null;
  candidatePool.forEach(contactName => {
    const match = scoreNameMatch(expanded, contactName) || scoreNameMatch(pretty, contactName);
    if (!match) return;
    if (!best || match.score > best.score) best = { ...match, name: contactName };
  });

  if (best && best.score >= 12 && hasRadiologyDutySharedLastToken(expanded, best.name)) {
    return { name: best.name, confidence: best.uncertain ? 'medium' : 'high', matched:true };
  }
  return { name:'', confidence:'low', matched:false };
}

function findRadiologyDutyTemplateNames(windowText='', contactResult=null, rawText='') {
  if (!windowText) return [];
  const candidateText = windowText
    .replace(/([A-Za-z])\/(?=[A-Za-z])/g, '$1 | ')
    .replace(/([A-Za-z])\|(?=[A-Za-z])/g, '$1 | ')
    .replace(/\b(?:Residents?|Fellow|Assistant\/Associate Consultant|Fellow \/ Assistant Consultant|Consultant|Outside CDs|Outside CD Triage|Admin \/ Academic & Teaching \/ External CD Duty|SECTION SPECIALTY|WEEKLY DUTY ROTA)\b/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  const rawNames = parseRadiologyDutyNameList(candidateText, rawText);
  const resolved = [];
  rawNames.forEach(raw => {
    const match = resolveRadiologyDutyCandidateName(raw, contactResult, rawText);
    if (!match.name || !match.matched) return;
    if (!resolved.some(item => canonicalName(item.name) === canonicalName(match.name))) {
      resolved.push(match);
    }
  });
  return resolved;
}

function findRadiologyDutyAliasesInWindow(windowText='', aliases=[], rawText='') {
  if (!windowText) return [];
  const normalizedWindow = canonicalName(windowText);
  const names = [];
  aliases.forEach(alias => {
    const aliasNorm = canonicalName(alias);
    if (!aliasNorm) return;
    if (!normalizedWindow.includes(aliasNorm)) return;
    const normalized = normalizeRadiologyDutyName(alias, rawText);
    if (normalized && !names.includes(normalized)) names.push(normalized);
  });
  return names;
}

function parseRadiologyDutyPdfEntries(text='', deptKey='radiology_duty') {
  const dept = ROTAS[deptKey];
  if (!dept || !text) return [];
  const entries = [];
  const contactMap = buildContactMapFromText(text);
  const templateDetected = isRadiologyDutyTemplateText(text);
  const essentialSections = new Set(['CT - Neuro', 'CT - General', 'Ultrasound - Abdomen', 'Ultrasound - MSK', 'X-Ray / General']);
  const foundSections = new Set();

  const sectionSpecs = [
    {
      section: 'CT Neuro (ER)',
      role: 'Resident',
      start: /NEURO REFERRAL/i,
      end: [/BODY REFERRAL/i, /THORACIC REFERRAL/i],
      aliases: ['Rawan Alanezi', 'Mohammed Al Saffar', 'M. Al Saffar', 'M Al Saffar', 'A. Alshammari', 'Abdulrahman Alshammari'],
      fallbackToWholeText: true,
    },
    {
      section: 'CT Neuro (ER)',
      role: 'Consultant',
      start: /NEURO REFERRAL/i,
      end: [/BODY REFERRAL/i, /THORACIC REFERRAL/i],
      aliases: ['R. Hazmi'],
      fallbackToWholeText: true,
    },
    {
      section: 'CT - Neuro',
      role: 'Consultant',
      start: /NEURO REFERRAL/i,
      end: [/BODY REFERRAL/i, /THORACIC REFERRAL/i],
      aliases: ['H. Muhaish', 'H. Arfaj', 'F. Molani', 'A. Suwailem'],
      fallbackToWholeText: true,
    },
    {
      section: 'CT - General',
      role: 'Consultant',
      start: /BODY REFERRAL/i,
      end: [/THORACIC REFERRAL/i, /MSK REFERRAL/i],
      aliases: ['K.balawi', 'S.mahmoud', 'H.Aboras', 'E.momen', 'F.Bosaid', 'A.abdulqader'],
    },
    {
      section: 'Ultrasound - Abdomen',
      role: 'Consultant',
      start: /Ultrasound \(Consultant\)/i,
      end: [/BODY REFERRAL/i, /THORACIC REFERRAL/i],
      aliases: ['T. Saied', 'A. Mohammed', 'S.mahmoud'],
      fallbackToWholeText: true,
    },
    {
      section: 'Ultrasound - MSK',
      role: 'Consultant',
      start: /MSK REFERRAL/i,
      end: [/NUCLEAR/i, /PET-CT/i, /MOLECULAR IMAGING/i],
      aliases: ['A. Dhafiri'],
      fallbackToWholeText: true,
    },
    {
      section: 'Ultrasound - MSK',
      role: 'Fellow / Assistant',
      start: /MSK REFERRAL/i,
      end: [/NUCLEAR/i, /PET-CT/i, /MOLECULAR IMAGING/i],
      aliases: ['Fatimah Albahhar', 'Mohammed Al Ibrahim', 'Fatimah Buqais'],
      fallbackToWholeText: true,
    },
    {
      section: 'X-Ray / General',
      role: 'Consultant',
      start: /THORACIC REFERRAL/i,
      end: [/MSK REFERRAL/i, /NUCLEAR/i, /PET-CT/i],
      aliases: ['H. Ismail'],
      fallbackToWholeText: true,
    },
    {
      section: 'X-Ray / General',
      role: 'Fellow / Assistant',
      start: /THORACIC REFERRAL/i,
      end: [/MSK REFERRAL/i, /NUCLEAR/i, /PET-CT/i],
      aliases: ['Mohammed Al Ibrahim', 'Fatimah Buqais'],
      fallbackToWholeText: true,
    },
    {
      section: 'Nuclear / PET',
      role: 'Consultant',
      start: /NUCLEAR[\s\S]*?PET-CT|MOLECULAR IMAGING|see Molecular Imaging schedule/i,
      end: [],
      aliases: ['A. Buali', 'A. Naim', 'Abdullah Al Umair'],
      fallbackToWholeText: true,
    },
  ];

  sectionSpecs.forEach(spec => {
    const windowText = extractRadiologyDutyWindow(text, spec.start, spec.end);
    let names = findRadiologyDutyAliasesInWindow(windowText, spec.aliases, text);
    if (!names.length && spec.fallbackToWholeText) {
      names = findRadiologyDutyAliasesInWindow(text, spec.aliases, text);
    }
    let matches = names.map(name => ({ name, confidence:'medium' }));
    if (!matches.length && templateDetected) {
      matches = findRadiologyDutyTemplateNames(windowText, contactMap, text);
    }
    matches.forEach(match => {
      const name = match.name;
      const phoneMeta = resolvePhoneFromContactMap(name, contactMap) || resolveRadiologyDutyPhone(name, dept);
      const role = inferRadiologyDutyRole(spec.section, name, spec.role);
      entries.push({
        specialty: deptKey,
        date: 'dynamic-weekday',
        role,
        name,
        phone: phoneMeta.phone || '',
        phoneUncertain: !phoneMeta.phone || phoneMeta.uncertain,
        section: spec.section,
        shiftType: 'on-duty',
        startTime: '07:30',
        endTime: '16:30',
        parsedFromPdf: true,
        parseConfidence: match.confidence || 'high',
        templateDetected,
      });
      if (essentialSections.has(spec.section)) foundSections.add(spec.section);
    });
  });

  const deduped = dedupeParsedEntries(entries);
  deduped._templateDetected = templateDetected;
  deduped._coreSectionsFound = [...foundSections];
  return deduped;
}

function hasLegacyRadiologyDutyEntries(entries=[]) {
  return Array.isArray(entries) && entries.some(entry => {
    const role = (entry.role || '').toLowerCase();
    const section = entry.section || '';
    return role === 'on-duty radiologist' || /—/.test(section);
  });
}

function hasLegacyNeurologyUploadEntries(entries=[]) {
  if (!Array.isArray(entries) || !entries.length) return false;
  const roles = entries.map(entry => (entry.role || '').toLowerCase());
  const names = entries.map(entry => normalizeText(entry.name || ''));
  const hasStructuredRoles = roles.some(role => role.includes('1st on-call resident'))
    && roles.some(role => role.includes('2nd on-call senior resident'))
    && roles.some(role => role.includes('associate consultant on-call'));
  const hasNoisyNames = names.some(name => /approved by|resident on-call|consultant on-call|\d{1,2}-apr-26/.test(name));
  return !hasStructuredRoles || hasNoisyNames;
}

function refreshUploadedRecordIfNeeded(record) {
  if (!record || !record.deptKey) return record;
  if (!record.rawText) return record;
  if (record.deptKey === 'radiology_duty') {
    if (!hasLegacyRadiologyDutyEntries(record.entries || [])) return record;
    const reparsed = normalizeParsedEntries(
      splitMultiDoctorEntries(parseRadiologyDutyPdfEntries(record.rawText, 'radiology_duty'), 'radiology_duty')
    );
    if (!reparsed.length) return record;
    return {
      ...record,
      entries: reparsed,
      parsedActive: true,
      review: {
        ...(record.review || {}),
        parsing: false,
        auditRejected: false,
      },
    };
  }
  if (record.deptKey === 'neurology' && isNeurologyDutyTemplate(record.rawText)) {
    if (!hasLegacyNeurologyUploadEntries(record.entries || [])) return record;
    const reparsed = normalizeParsedEntries(
      splitMultiDoctorEntries(parseNeurologyPdfEntries(record.rawText, 'neurology'), 'neurology')
    );
    if (!reparsed.length) return record;
    return {
      ...record,
      entries: reparsed,
      parsedActive: true,
      audit: {
        ...(record.audit || {}),
        publishable: true,
        approved: true,
        issues: [],
        overallConfidence: 'high',
      },
      review: {
        ...(record.review || {}),
        parsing: false,
        auditRejected: false,
        pendingUploadReview: false,
        auditErrors: [],
        auditWarnings: [],
      },
    };
  }
  return record;
}

function buildScheduleMapFromEntries(entries=[]) {
  return entries.reduce((acc, entry) => {
    const dateKey = entry.date || '';
    if (!dateKey) return acc;
    if (!acc[dateKey]) acc[dateKey] = [];
    acc[dateKey].push({ ...entry });
    return acc;
  }, {});
}

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
// For PDFs that list abbreviated day names (WED, THU…) without full dates.
// Infers date by counting occurrences of each day name through the month.
// Surgery uses this: "WED\n A.AlTala  Mahdi\nTHU\n Ahmad  Rawan..."
function parseDaySequence(text='', deptKey='', monthYear='04/2026') {
  const entries = [];
  const [monthStr, yearStr] = monthYear.split('/');
  const month = parseInt(monthStr, 10) - 1; // 0-indexed for Date()
  const year  = parseInt(yearStr, 10);
  const dayNames = ['sun','mon','tue','wed','thu','fri','sat'];

  // Build date calendar: dayName → [dd/mm, dd/mm, ...]
  const dayOccurrences = {};
  for (let d = 1; d <= 31; d++) {
    const dt = new Date(year, month, d);
    if (dt.getMonth() !== month) break;
    const key = dayNames[dt.getDay()];
    if (!dayOccurrences[key]) dayOccurrences[key] = [];
    dayOccurrences[key].push(String(d).padStart(2,'0') + '/' + monthStr);
  }

  const dayIdx = {};
  dayNames.forEach(d => dayIdx[d] = 0);

  const rawLines = text.split('\n').map(l => l.trim()).filter(Boolean);
  // Match both abbreviated (wed) and full day names (wednesday) — covers ENT, Surgery, Ophthalmology
  const dayRe     = /^(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun)\b/i;
  const fullToAbbr = {
    monday:'mon', tuesday:'tue', wednesday:'wed', thursday:'thu',
    friday:'fri', saturday:'sat', sunday:'sun',
    mon:'mon', tue:'tue', wed:'wed', thu:'thu', fri:'fri', sat:'sat', sun:'sun',
  };

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    const dm   = line.match(dayRe);
    if (!dm) continue;

    const dayKey = fullToAbbr[dm[1].toLowerCase()] || dm[1].toLowerCase().slice(0, 3);
    if (!dayOccurrences[dayKey]) continue;
    if (dayIdx[dayKey] >= dayOccurrences[dayKey].length) continue;
    const dateKey = dayOccurrences[dayKey][dayIdx[dayKey]++];

    // Names can be on the same line (after day name), the PREVIOUS line, or the NEXT line
    const rawSameLine = line.replace(dayRe, '').trim();
    // If the same line content is only a date or number after removing the day name, treat as empty
    const sameLineIsDateOnly = /^\d{1,2}[\/\-]\d{1,2}([\/\-]\d{2,4})?(\s*$|\s+\d{4}$)/.test(rawSameLine) || /^\d+$/.test(rawSameLine);
    const sameLine = sameLineIsDateOnly ? '' : rawSameLine;
    const prevLine = i > 0 ? (rawLines[i - 1] || '') : '';
    const nextLine = (rawLines[i + 1] || '');
    const nextIsDay = dayRe.test(nextLine);
    const prevIsDay = dayRe.test(prevLine);

    // Priority: same line → prev line (RadOnc layout: names before date) → next line
    const target = sameLine
      || (!prevIsDay && prevLine ? prevLine : '')
      || (!nextIsDay ? nextLine : '');
    if (!target) continue;

    // Split on 2+ spaces — these are already column-separated people; do NOT merge them
    const parts = target.split(/\s{2,}|\t|(?=\bDr\.\s+[A-Z])/).map(s => s.trim()).filter(s =>
      s && s.length >= 2 &&
      !/^\d+$/.test(s) &&
      !/^\d{1,2}[\/\-]\d{1,2}([\/\-]\d{2,4})?$/.test(s) &&   // filter date strings
      !/^(on|call|duty|rota|am|pm|\d+:\d+|Tamadher)$/i.test(s)
    );

    // Each part after the split is a SEPARATE person — no merging of single words
    parts.forEach((name, idx) => {
      const isConsultant = /^Dr\.?\s/i.test(name);
      const role = isConsultant ? 'Consultant On-Call'
                 : (idx === 0 ? '1st On-Call' : '2nd On-Call');
      entries.push({ specialty: deptKey, date: dateKey, role, name, phone: '', parsedFromPdf: true });
    });
  }
  return dedupeParsedEntries(entries);
}


function parseGenericPdfEntries(text='', deptKey='') {
  // Step 1: build contact map from the full text (name→phone from staff list)
  const contactMap = buildContactMapFromText(text);

  // Step 2: parse date-table rows (schedule grid)
  const tableEntries = parseDateTableEntries(text, deptKey);

  // Step 3: parse line-by-line for phone-anchored entries
  // NOTE: preserve original line spacing — do NOT collapse \s+ globally here
  // because double-spaces are column separators in table PDFs
  const lines = text.split(/\n/).map(line => line.trimEnd()).filter(Boolean);
  const phoneEntries = [];
  let currentDate = '';
  lines.forEach(line => {
    const date = parseDateKeyFromLine(line);
    if (date) currentDate = date;
    const phone = parsePhoneFromLine(line);
    const hasRole = /(1st|2nd|3rd|first|second|third|resident|fellow|consultant|on[\s-]?call)/i.test(line);
    if (!phone && !hasRole) return;
    const name = extractNameNearPhone(line);
    if (!name || name.length < 2) return;
    phoneEntries.push({
      specialty: deptKey,
      date: date || currentDate,
      role: roleFromLine(line),
      name,
      phone,
      ...parseTimeRangeFromLine(line),
      section: normalizeUploadedSpecialtyLabel(ROTAS[deptKey]?.label || deptKey),
      parsedFromPdf: true,
    });
  });

  // Step 4: also run the around-phones window approach
  const knownPhoneDates = new Set(phoneEntries.map(entry => `${entry.phone}|${entry.date || ''}`));
  const phoneWindowEntries = parseEntriesAroundPhones(text, deptKey)
    .filter(entry => !knownPhoneDates.has(`${entry.phone}|${entry.date || ''}`));

  // Step 5: merge all entries, preferring phone-bearing ones
  const all = dedupeParsedEntries([...phoneEntries, ...phoneWindowEntries, ...tableEntries]);

  // Step 6: fill in phones from contact map for entries that have names but no phone
  return all.map(entry => {
    if (entry.phone) return entry;
    // Try to find phone from contact map by name match
    const resolved = resolvePhoneFromContactMap(entry.name, contactMap);
    if (resolved) return { ...entry, phone: resolved.phone, phoneUncertain: resolved.uncertain };
    return entry;
  });
}


function parseMedicinePdfEntries(text='', targetDeptKey='medicine') {
  const specialtyMap = [
    ['endocrinology', /endocrinology|endocrine|diabetes/i],
    ['dermatology', /dermatology|derma\b|skin\b/i],
    ['rheumatology', /rheumatology|rheuma/i],
    ['gastroenterology', /gastroenterology|\bgi\b|ercp/i],
    ['pulmonary', /pulmonary|pulmonology|respiratory|chest/i],
    ['infectious', /infectious|infection|\bid\b/i],
  ];

  // Build contact map from full text (staff table with names + mobiles)
  const contactMap = buildContactMapFromText(text);

  const lines = text.split(/\n/).map(line => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const entries = [];
  let currentSpecialty = null;
  let currentDate = '';

  // Pre-scan: detect specialty section headers
  // Medicine PDFs often list specialty in contact table: "Dr. X Consultant – Dermatology ... phone"
  const contactEntries = [];
  for (const line of lines) {
    const phone = parsePhoneFromLine(line);
    if (!phone) continue;
    const spec = specialtyMap.find(([, re]) => re.test(line));
    if (!spec) continue;
    const deptKey = spec[0];
    // Extract name from line
    const namePart = line.replace(/(?:\+?966[\s-]*)?0?5[\d\s-]{7,16}/g, ' ')
      .replace(/\b\d{3,}\b/g, ' ')
      .replace(/consultant|fellow|resident|associate|section|head|chair|director|program/gi, ' ')
      .replace(/[^A-Za-z\u0600-\u06FF .'-]+/g, ' ')
      .replace(/\s+/g, ' ').trim();
    const drMatch = namePart.match(/(?:Dr\.?\s+)?([A-Z][a-z]+(?: [A-Z][a-z'-]+){1,3})/);
    const name = drMatch ? drMatch[0].replace(/\s+/, ' ').trim() : '';
    if (!name || name.length < 4) continue;
    // Determine role from line
    const roleLow = line.toLowerCase();
    let role = 'Consultant On-Call';
    if (/fellow/i.test(roleLow)) role = 'Fellow';
    else if (/resident/i.test(roleLow)) role = '1st On-Call Resident';
    else if (/associate/i.test(roleLow)) role = 'Consultant On-Call';
    contactEntries.push({ specialty: deptKey, date: '', role, name, phone, section: ROTAS[deptKey]?.label || deptKey, parsedFromPdf: true, coverageType: 'on-call' });
  }

  // Parse schedule rows line by line
  lines.forEach(line => {
    const spec = specialtyMap.find(([, re]) => re.test(line));
    if (spec) currentSpecialty = spec[0];
    const date = parseDateKeyFromLine(line);
    if (date) currentDate = date;
    const phone = parsePhoneFromLine(line);
    const hasRole = /(1st|2nd|3rd|first|second|third|resident|fellow|consultant|on[\s-]?call|after\s+\d)/i.test(line);
    if (!phone && !hasRole) return;
    if (!currentSpecialty) {
      // Try to detect specialty from the line itself even without a header
      const inlineSpec = specialtyMap.find(([, re]) => re.test(line));
      if (inlineSpec) currentSpecialty = inlineSpec[0];
    }
    if (!currentSpecialty) return;
    const name = phone ? extractNameNearPhone(line) : '';
    if (phone && (!name || name.length < 2)) return;
    const entry = {
      specialty: currentSpecialty,
      date: date || currentDate,
      role: roleFromLine(line, 'On-Call'),
      name: name || '',
      phone: phone || '',
      ...parseTimeRangeFromLine(line),
      section: ROTAS[currentSpecialty]?.label || currentSpecialty,
      parsedFromPdf: true,
    };
    entry.coverageType = medicineCoverageType(entry);
    // Fill phone from contact map if missing
    if (!entry.phone && entry.name) {
      const resolved = resolvePhoneFromContactMap(entry.name, contactMap);
      if (resolved) { entry.phone = resolved.phone; entry.phoneUncertain = resolved.uncertain; }
    }
    entries.push(entry);
  });

  // Merge contact entries and schedule entries; prefer schedule entries with dates
  const all = dedupeParsedEntries([...entries, ...contactEntries]);
  if (targetDeptKey !== 'medicine') return all.filter(entry => entry.specialty === targetDeptKey);
  return all;
}

function normalizeParsedEntries(entries=[]) {
  // Pre-pass 1: split entries where name contains multiple Dr.X patterns (PICU abbreviation style)
  // e.g. "Dr.Abbas Dr.Ayman" → two separate entries
  const expanded1 = [];
  for (const entry of entries) {
    const name = (entry.name || '').trim();
    const drParts = name.split(/(?=\bDr\.\w)/g).map(s => s.trim()).filter(Boolean);
    if (drParts.length > 1) {
      drParts.forEach(part => expanded1.push({ ...entry, name: part }));
    } else {
      expanded1.push(entry);
    }
  }

  // Pre-pass 2: split comma-separated names (Neurology: "Batool, Ghady" → "Batool" + "Ghady")
  const expanded2 = [];
  for (const entry of expanded1) {
    const name = (entry.name || '').trim();
    if (name.includes(',')) {
      const parts = name.split(',').map(s => s.trim()).filter(s => s.length >= 2);
      if (parts.length > 1) {
        parts.forEach(part => expanded2.push({ ...entry, name: part }));
        continue;
      }
    }
    expanded2.push(entry);
  }

  return dedupeParsedEntries(expanded2
    .map(entry => {
      const meta = parseRoleMeta(entry.role || '');
      let name = (entry.name || '').replace(/\bTAAM\b/gi, '').replace(/\s+/g, ' ').trim();
      // Normalize "Dr.Name" → "Dr. Name"
      name = name.replace(/^Dr\.([A-Z])/i, 'Dr. $1');
      // Strip embedded day names left from Urology-style lines (e.g. "Wed Faisal" → "Faisal")
      name = name.replace(/^\s*(mon|tue|wed|thu|fri|sat|sun)\w*\s+/i, '').trim();
      return {
        ...entry,
        role: normalizeUploadedRole(entry.role || ''),
        name,
        shiftType: entry.shiftType || meta.shiftType || '',
        startTime: entry.startTime || meta.startTime || '',
        endTime: entry.endTime || meta.endTime || '',
        section: normalizeUploadedSpecialtyLabel(entry.section || ROTAS[entry.specialty]?.label || entry.specialty || ''),
      };
    })
    .filter(entry => entry.name && entry.name.length >= 2)
    .filter(entry => !/^taam$/i.test(entry.name))
    .filter(entry => !/\b(?:pdf|obj|endobj|stream|endstream|length|xref|trailer|startxref| t[fdj]|bt|et|eof)\b/i.test(entry.name))
    .filter(entry => (entry.name.match(/\bDr\.?\b/gi) || []).length <= 1)
    // Drop pure initials/abbreviations: "AW", "SAH YSF"
    .filter(entry => {
      const words = entry.name.split(' ').filter(Boolean);
      const allShortCaps = words.every(w => w === w.toUpperCase() && w.length <= 3);
      return !(words.length >= 1 && allShortCaps && entry.name.length <= 4);
    })
    // Accept if: has phone, has lowercase letters, OR all-caps name with each word ≥4 chars (proper names like "SARA OWIDAH")
    .filter(entry => {
      if (entry.phone) return true;
      if (/[a-z]/.test(entry.name)) return true;
      const words = entry.name.split(' ').filter(Boolean);
      return words.length >= 1 && words.every(w => w.length >= 4) && words.some(w => w.length >= 5);
    })
  );
}

async function parseUploadedPdf(file, deptKey) {
  const text = await extractPdfText(file);
  let parsed;
  let parserMode = 'generic';

  if (deptKey === 'anesthesia' || isAnesthesiaLike(file.name)) {
    parsed = parseAnesthesiaPdfEntries(text, deptKey);
    parserMode = 'specialized';

  } else if (deptKey === 'radiology_duty') {
    parsed = parseRadiologyDutyPdfEntries(text, deptKey);
    parserMode = 'specialized';

  } else if (deptKey === 'medicine_on_call') {
    parsed = parseMedicineOnCallPdfEntries(text, deptKey);
    parserMode = 'specialized';

  } else if (deptKey === 'medicine' || isMedicineSubspecialty(deptKey)) {
    parsed = parseMedicinePdfEntries(text, deptKey);
    parserMode = 'specialized';

  } else if (deptKey === 'ophthalmology') {
    // Uses full day names (Wednesday, Thursday…) with name on same line
    const seqParsed    = parseDaySequence(text, deptKey, '04/2026');
    const genericParsed = parseGenericPdfEntries(text, deptKey);
    parsed = dedupeParsedEntries([...seqParsed, ...genericParsed]);

  } else if (deptKey === 'liver') {
    const liverParsed = parseLiverPdfEntries(text, deptKey);
    if (liverParsed._templateDetected && liverParsed.length) {
      parsed = dedupeParsedEntries([...liverParsed]);
      parsed._templateDetected = true;
      parsed._templateName = liverParsed._templateName || 'liver-monthly-2026';
      parserMode = 'specialized';
    } else {
      const inlineParsed  = parseSingleLineDateSplit(text, deptKey);
      const genericParsed = parseGenericPdfEntries(text, deptKey);
      parsed = dedupeParsedEntries([...liverParsed, ...inlineParsed, ...genericParsed]);
      parserMode = 'generic-fallback';
    }

  } else if (deptKey === 'kptx') {
    const kptxParsed = parseKptxPdfEntries(text, deptKey);
    if (kptxParsed._templateDetected && kptxParsed.length) {
      parsed = dedupeParsedEntries([...kptxParsed]);
      parsed._templateDetected = true;
      parsed._templateName = kptxParsed._templateName || 'kptx-monthly-2026';
      parserMode = 'specialized';
    } else {
      const inlineParsed  = parseSingleLineDateSplit(text, deptKey);
      const genericParsed = parseGenericPdfEntries(text, deptKey);
      parsed = dedupeParsedEntries([...kptxParsed, ...inlineParsed, ...genericParsed]);
      parserMode = 'generic-fallback';
    }

  } else if (deptKey === 'nephrology') {
    // Entire schedule packed into one long line with full dd/mm/yyyy dates
    const inlineParsed = parseSingleLineDateSplit(text, deptKey);
    const genericParsed = parseGenericPdfEntries(text, deptKey);
    parsed = dedupeParsedEntries([...inlineParsed, ...genericParsed]);

  } else if (deptKey === 'neurosurgery') {
    const nsParsed = parseNeurosurgeryPdfEntries(text, deptKey);
    if (nsParsed._templateDetected && nsParsed.length) {
      parsed = dedupeParsedEntries([...nsParsed]);
      parsed._templateDetected = true;
      parsed._templateName = nsParsed._templateName || 'neurosurgery-monthly-2026';
      parserMode = 'specialized';
    } else {
      const inlineParsed = parseSingleLineDateSplit(text, deptKey);
      const seqParsed    = parseDaySequence(text, deptKey, '04/2026');
      const genericParsed = parseGenericPdfEntries(text, deptKey);
      parsed = dedupeParsedEntries([...nsParsed, ...inlineParsed, ...seqParsed, ...genericParsed]);
      parserMode = 'generic-fallback';
    }

  } else if (deptKey === 'surgery') {
    const surgeryParsed = parseSurgeryPdfEntries(text, deptKey);
    if (surgeryParsed._templateDetected && surgeryParsed.length) {
      parsed = dedupeParsedEntries([...surgeryParsed]);
      parsed._templateDetected = true;
      parsed._templateName = surgeryParsed._templateName || 'surgery-monthly-2026';
      parserMode = 'specialized';
    } else {
      const seqParsed    = parseDaySequence(text, deptKey, '04/2026');
      const genericParsed = parseGenericPdfEntries(text, deptKey);
      parsed = dedupeParsedEntries([...surgeryParsed, ...seqParsed, ...genericParsed]);
      parserMode = 'generic-fallback';
    }

  } else if (deptKey === 'hospitalist') {
    const hospitalistParsed = parseHospitalistPdfEntries(text, deptKey);
    if (hospitalistParsed._templateDetected && hospitalistParsed.length) {
      parsed = dedupeParsedEntries([...hospitalistParsed]);
      parsed._templateDetected = true;
      parsed._templateName = hospitalistParsed._templateName || 'hospitalist-monthly-2026';
      parserMode = 'specialized';
    } else {
      const genericParsed = parseGenericPdfEntries(text, deptKey);
      parsed = dedupeParsedEntries([...hospitalistParsed, ...genericParsed]);
      parserMode = 'generic-fallback';
    }

  } else if (deptKey === 'neurology') {
    const neurologyParsed = parseNeurologyPdfEntries(text, deptKey);
    if (neurologyParsed._templateDetected) {
      parsed = dedupeParsedEntries([...neurologyParsed]);
      parsed._templateDetected = true;
      parsed._templateName = neurologyParsed._templateName || 'neurology-monthly-2026';
      parserMode = 'specialized';
    } else {
      const seqParsed    = parseDaySequence(text, deptKey, '04/2026');
      const genericParsed = parseGenericPdfEntries(text, deptKey);
      parsed = dedupeParsedEntries([...seqParsed, ...genericParsed]);
      parserMode = 'generic-fallback';
    }

  } else if (deptKey === 'picu') {
    const picuParsed = parsePicuPdfEntries(text, deptKey);
    if (picuParsed._templateDetected) {
      parsed = dedupeParsedEntries([...picuParsed]);
      parsed._templateDetected = true;
      parsed._templateName = picuParsed._templateName || 'picu-monthly-2026';
      parsed._coreSectionsFound = picuParsed._coreSectionsFound || [];
      parserMode = 'specialized';
    } else {
      const genericParsed = parseGenericPdfEntries(text, deptKey);
      parsed = dedupeParsedEntries([...picuParsed, ...genericParsed]);
      parserMode = 'generic-fallback';
    }

  } else if (deptKey === 'gynecology') {
    // Names packed in a single line per day via "24 H" separators
    const gynParsed    = parseGynecologyPdfEntries(text, deptKey);
    const genericParsed = parseGenericPdfEntries(text, deptKey);
    parsed = dedupeParsedEntries([...gynParsed, ...genericParsed]);

  } else {
    parsed = parseGenericPdfEntries(text, deptKey);
  }

  const parseDebug = {
    templateDetected: !!(parsed && parsed._templateDetected),
    coreSectionsFound: (parsed && parsed._coreSectionsFound) || [],
    templateName: (parsed && parsed._templateName) || '',
    parserMode,
  };

  return {
    rawText: text,
    textSample: text.slice(0, 4000),
    debug: parseDebug,
    entries: normalizeParsedEntries(splitMultiDoctorEntries(
      Array.isArray(parsed) ? parsed : (parsed || []),
      deptKey
    )),
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
  const hasSection = (entry, words) => words.some(word => roleText(entry).includes(word.toLowerCase()));
  if (intent === 'nuclear') return entries.filter(entry => hasSection(entry, ['nuclear','pet']));
  if (intent === 'us_msk') return entries.filter(entry => hasSection(entry, ['ultrasound']) && hasSection(entry, ['msk']));
  if (intent === 'us_abdomen') return entries.filter(entry => hasSection(entry, ['ultrasound']) && hasSection(entry, ['abdomen']));
  if (intent === 'us') return entries.filter(entry => hasSection(entry, ['ultrasound']));
  if (intent === 'ct_neuro_er') return entries.filter(entry => hasSection(entry, ['ct neuro (er)','neuro on-call','ct neuro']) || (hasSection(entry, ['neuro']) && hasSection(entry, ['er'])));
  if (intent === 'ct_neuro') return entries.filter(entry => hasSection(entry, ['neuro']) && hasSection(entry, ['ct']));
  if (intent === 'ct_abdomen') return entries.filter(entry => hasSection(entry, ['abdomen','body']) && hasSection(entry, ['ct']));
  if (intent === 'ct') return entries.filter(entry => hasSection(entry, ['ct']));
  return entries;
}

function getRadiologyDutyEntriesForIntent(now, schedKey, qLow='') {
  const intent = radiologyQueryIntent(qLow);
  if (intent === 'ct_neuro_er') {
    const override = getRadiologyDutyNeuroErEntries(schedKey);
    if (override.length) return override;
  }
  if (intent === 'us' || intent === 'us_msk' || intent === 'us_abdomen') return getRadiologyUltrasoundEntries(now, intent);
  return filterRadiologyDutyByIntent(getDutyRadiologyEntries(now), intent);
}

function getRadiologyOnCallEntriesForDate(schedKey) {
  const raw = ROTAS.radiology_oncall.schedule[schedKey] || [];
  const dept = ROTAS.radiology_oncall;
  return raw.flatMap(entry => {
    const r = (entry.role || '').toLowerCase();
    let role = '';
    if (r.includes('1st on-call')) role = '1st On-Call';
    else if (r.includes('2nd on-call')) role = '2nd On-Call';
    else if (r.includes('3rd on-call') || r.includes('general on-call consultant')) role = '3rd On-Call Consultant';
    else return [];

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
    return withRadiologyShiftMeta(getRadiologyOnCallEntriesForDate(schedKey), shift);
  });
}

// Radiology uses explicit duty/on-call rules; other specialties use active role filters.
function getEntries(deptKey, dept, schedKey, now, qLow='') {
  const uploadedEntries = uploadedEntriesForDept(deptKey, schedKey, now, qLow);
  if (uploadedEntries) return uploadedEntries;
  if (deptKey === 'medicine_on_call') return splitMultiDoctorEntries(getMedicineOnCallEntries(schedKey, now, qLow), deptKey);
  if (deptKey === 'medicine') {
    return splitMultiDoctorEntries(MEDICINE_SUBSPECIALTY_KEYS.flatMap(key => {
      const subDept = ROTAS[key];
      return subDept ? getMedicineEntries(key, schedKey, now).map(entry => ({ ...entry, specialty: key, section: subDept.label })) : [];
    }), deptKey);
  }
  if (deptKey === 'radiology_duty' || deptKey === 'radiology_oncall') {
    return getRadiologyEntries(schedKey, now, qLow);
  }
  if (deptKey === 'hospitalist') return splitMultiDoctorEntries(getHospitalistEntries(schedKey, now), deptKey);
  if (deptKey === 'pediatrics') return splitMultiDoctorEntries(getPediatricsEntries(schedKey, now), deptKey);
  if (deptKey === 'picu') return splitMultiDoctorEntries(getPicuEntries(schedKey, now), deptKey);
  if (deptKey === 'orthopedics') return splitMultiDoctorEntries(getOrthopedicsEntries(schedKey, now), deptKey);
  if (deptKey === 'kptx') return splitMultiDoctorEntries(getKptxEntries(schedKey, now), deptKey);
  if (deptKey === 'liver') return splitMultiDoctorEntries(getLiverEntries(schedKey, now), deptKey);
  if (deptKey === 'hematology') return splitMultiDoctorEntries(getHematologyEntries(schedKey, now), deptKey);
  if (deptKey === 'surgery') return splitMultiDoctorEntries(getSurgeryEntries(schedKey, now), deptKey);
  if (deptKey === 'neurosurgery') return splitMultiDoctorEntries(getNeurosurgeryEntries(schedKey, now), deptKey);
  if (deptKey === 'neurology') return splitMultiDoctorEntries(getNeurologyEntriesFromRows(dept.schedule[schedKey] || []), deptKey);
  if (isMedicineSubspecialty(deptKey)) return splitMultiDoctorEntries(getMedicineEntries(deptKey, schedKey, now), deptKey);
  if (deptKey === 'gynecology') return splitMultiDoctorEntries(dept.schedule[schedKey] || [], deptKey);
  return splitMultiDoctorEntries(filterActiveEntries(dept.schedule[schedKey] || [], now), deptKey);
}

// ═══════════════════════════════════════════════════════════════
// RENDER
// ═══════════════════════════════════════════════════════════════


const DB_NAME = 'oncallLookupDB';
const DB_STORE = 'pdfs';
let pdfDbPromise = null;
let runtimePdfUrls = {};
let currentPdfPreviewKey = null;
let currentPdfPreviewContext = null;
const lastPreviewContextByDept = new Map();
let currentPdfRenderTask = 0;

function openPdfDb() {
  if (pdfDbPromise) return pdfDbPromise;
  pdfDbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE, { keyPath: 'deptKey' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return pdfDbPromise;
}

async function savePdfRecord(record) {
  const db = await openPdfDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

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
    publishable: true,
    livePublished: true,
  };
  await savePdfRecord({
    ...record,
    review: normalizedReview,
    audit: normalizedAudit,
    isActive: true,
    pendingReviewUpload: null,
    archivedVersions,
  });
  cacheUploadedRecord({
    ...record,
    review: normalizedReview,
    audit: normalizedAudit,
    isActive: true,
    pendingReviewUpload: null,
    archivedVersions,
  });
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

async function getAllPdfRecords() {
  const db = await openPdfDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readonly');
    const req = tx.objectStore(DB_STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function getPdfRecord(deptKey) {
  const db = await openPdfDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readonly');
    const req = tx.objectStore(DB_STORE).get(deptKey);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function getLatestActivePdfRecord(deptKey) {
  if (isImagingDeptKey(deptKey)) {
    const mapRecord = resolveImagingActiveRecordSync(deptKey);
    if (mapRecord) return mapRecord;
    const dbRecord = await getPdfRecord(deptKey);
    if (!isValidImagingUploadRecord(dbRecord)) return null;
    const normalized = canonicalizeUploadedRecord(dbRecord);
    uploadedPdfRecords.set(normalized.deptKey, normalized);
    if (normalized.originalDeptKey) uploadedPdfRecords.set(normalized.originalDeptKey, normalized);
    return normalized;
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
  const normalized = canonicalizeUploadedRecord(latest);
  uploadedPdfRecords.set(normalized.deptKey, normalized);
  if (normalized.originalDeptKey) uploadedPdfRecords.set(normalized.originalDeptKey, normalized);
  return normalized;
}

async function getPdfHref(deptKey) {
  const fallbackKey = PDF_FALLBACKS[deptKey];
  let uploaded = await getLatestActivePdfRecord(deptKey);
  if (!uploaded && fallbackKey) uploaded = await getLatestActivePdfRecord(fallbackKey);
  const renderKey = uploaded ? (uploaded.deptKey || deptKey) : (DEFAULT_PDF_MAP[deptKey] ? deptKey : fallbackKey);
  if (uploaded && uploaded.blob) {
    if (runtimePdfUrls[renderKey]) URL.revokeObjectURL(runtimePdfUrls[renderKey]);
    runtimePdfUrls[renderKey] = URL.createObjectURL(uploaded.blob);
    return { href: runtimePdfUrls[renderKey], name: uploaded.name || 'rota.pdf', uploadedAt: uploaded.uploadedAt || 0 };
  }
  return DEFAULT_PDF_MAP[deptKey] || DEFAULT_PDF_MAP[fallbackKey] || null;
}

function closePdfPreview() {
  const wrap = document.getElementById('pdfPreviewWrap');
  const frame = document.getElementById('pdfFrame');
  const hint = document.getElementById('pdfSourceHint');
  const render = document.getElementById('pdfRender');
  const status = document.getElementById('pdfRenderStatus');
  currentPdfRenderTask += 1;
  currentPdfTextIndex = [];
  currentPdfSearchResults = [];
  frame.src = 'about:blank';
  if (render) render.innerHTML = '';
  if (status) {
    status.hidden = true;
    status.textContent = '';
  }
  if (hint) {
    hint.hidden = true;
    hint.innerHTML = '';
  }
  wrap.style.display = 'none';
  currentPdfPreviewKey = null;
  currentPdfPreviewContext = null;
}

function renderPdfSourceHint(context=null) {
  const hint = document.getElementById('pdfSourceHint');
  if (!hint) return;
  if (!context || (!context.section && !context.highlightTerms?.length)) {
    hint.hidden = true;
    hint.innerHTML = '';
    return;
  }
  const chips = (context.highlightTerms || []).filter(Boolean)
    .map(term => `<span class="pdf-source-chip">${escapeHtml(term)}</span>`)
    .join('');
  const pageText = context.page ? `Page ${context.page}` : 'Matched section';
  const sectionText = context.section ? ` · ${escapeHtml(context.section)}` : '';
  hint.innerHTML = `<span class="pdf-source-label">Source Match</span><span class="pdf-source-text">${escapeHtml(pageText)}${sectionText}</span>${chips}`;
  hint.hidden = false;
}

async function renderPdfPreviewPages(meta, context=null) {
  const render = document.getElementById('pdfRender');
  const frame = document.getElementById('pdfFrame');
  const status = document.getElementById('pdfRenderStatus');
  if (!render || !status || !frame) return;
  const taskId = ++currentPdfRenderTask;
  currentPdfTextIndex = [];
  currentPdfSearchResults = [];
  render.innerHTML = '';
  status.hidden = false;
  status.textContent = 'Loading PDF pages...';
  frame.style.display = 'none';
  try {
    const pdfjs = await loadPdfJs();
    const loadingTask = pdfjs.getDocument(meta.href);
    const pdf = await loadingTask.promise;
    if (taskId !== currentPdfRenderTask) return;
    const containerWidth = Math.max(320, render.clientWidth - 4);
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      if (taskId !== currentPdfRenderTask) return;
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map(item => item.str || '').join(' ').replace(/\s+/g, ' ').trim();
      currentPdfTextIndex.push({ page: pageNumber, text: pageText });
      const baseViewport = page.getViewport({ scale: 1 });
      const scale = Math.min(2, containerWidth / baseViewport.width);
      const viewport = page.getViewport({ scale });
      const wrapper = document.createElement('div');
      wrapper.className = 'pdf-page';
      wrapper.dataset.page = String(pageNumber);
      const label = document.createElement('div');
      label.className = 'pdf-page-label';
      label.textContent = `Page ${pageNumber}`;
      if (context && context.page === pageNumber) label.classList.add('is-target');
      const stage = document.createElement('div');
      stage.className = 'pdf-page-stage';
      stage.style.width = `${Math.floor(viewport.width)}px`;
      stage.style.height = `${Math.floor(viewport.height)}px`;
      const canvas = document.createElement('canvas');
      canvas.className = 'pdf-canvas';
      const outputScale = window.devicePixelRatio || 1;
      canvas.width = Math.floor(viewport.width * outputScale);
      canvas.height = Math.floor(viewport.height * outputScale);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;
      const ctx = canvas.getContext('2d');
      ctx.setTransform(outputScale, 0, 0, outputScale, 0, 0);
      await page.render({ canvasContext: ctx, viewport }).promise;
      const textLayer = document.createElement('div');
      textLayer.className = 'pdf-text-layer';
      textLayer.style.width = `${Math.floor(viewport.width)}px`;
      textLayer.style.height = `${Math.floor(viewport.height)}px`;
      textLayer.style.setProperty('--scale-factor', viewport.scale);
      const textTask = pdfjs.renderTextLayer({
        textContentSource: textContent,
        container: textLayer,
        viewport,
        textDivs: [],
      });
      if (textTask?.promise) {
        await textTask.promise;
      } else if (textTask && typeof textTask.then === 'function') {
        await textTask;
      }
      wrapper.appendChild(label);
      stage.appendChild(canvas);
      stage.appendChild(textLayer);
      wrapper.appendChild(stage);
      render.appendChild(wrapper);
    }
    if (taskId !== currentPdfRenderTask) return;
    status.textContent = `${pdf.numPages} page(s) loaded`;
    const targetPage = context && context.page ? render.querySelector(`.pdf-page[data-page="${context.page}"]`) : null;
    if (targetPage) {
      setTimeout(() => targetPage.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    }
  } catch (err) {
    console.warn('PDF preview render failed, falling back to iframe:', err);
    if (taskId !== currentPdfRenderTask) return;
    render.innerHTML = '';
    status.textContent = 'Inline renderer unavailable. Falling back to browser PDF preview.';
    frame.style.display = 'block';
    const pageSuffix = context && context.page ? `#page=${context.page}` : '';
    frame.src = `${meta.href}${pageSuffix}`;
  }
}

async function showPdfPreview(deptKey, context=null) {
  const meta = await getPdfHref(deptKey);
  if (!meta) return;
  closePdfPreview();
  currentPdfPreviewKey = deptKey;
  currentPdfPreviewContext = context || lastPreviewContextByDept.get(deptKey) || null;
  document.getElementById('pdfPreviewWrap').style.display = 'block';
  document.getElementById('pdfPreviewName').textContent = meta.name || '';
  const pageSuffix = currentPdfPreviewContext && currentPdfPreviewContext.page ? `#page=${currentPdfPreviewContext.page}` : '';
  document.getElementById('openPdfBtn').href = `${meta.href}${pageSuffix}`;
  document.getElementById('downloadPdfBtn').href = meta.href;
  document.getElementById('downloadPdfBtn').setAttribute('download', meta.name || 'rota.pdf');
  renderPdfSourceHint(currentPdfPreviewContext);
  await renderPdfPreviewPages(meta, currentPdfPreviewContext);
  document.getElementById('pdfPreviewWrap').scrollIntoView({behavior:'smooth', block:'start'});
}

function rolePriority(role='') {
  const r = role.toLowerCase();
  if (r.includes('smrod')) return -3;
  if (r.includes('junior er')) return -2;
  if (r.includes('senior er')) return -1;
  if (r.includes('hospitalist er')) return 0;
  if (r.includes('er') && r.includes('day')) return 1;
  if (r.includes('er') && r.includes('night')) return 2;
  if (/\b(1st|first)\b/.test(r)) return 0;
  if (/\b(2nd|second)\b/.test(r)) return 1;
  if (/\b(3rd|third)\b/.test(r)) return 2;
  if (r.includes('resident')) return 0;
  if (r.includes('fellow') && r.includes('on-call')) return 3;
  if (r.includes('fellow') && r.includes('day')) return 3;
  if (r.includes('fellow')) return 3;
  if (r.includes('associate')) return 4;
  if (r.includes('consultant')) return 9;
  if (r.includes('day coverage') || r.includes('er/consult') || r.includes('inpatient/consult') || r.includes('consult')) return 5;
  return 5;
}

function sortEntries(entries=[]) {
  return [...entries].sort((a,b) => {
    const shiftOrder = label => label === 'Current Shift' ? 0 : label === 'Upcoming Shift' ? 1 : 0;
    const sa = shiftOrder(a.shiftLabel); const sb = shiftOrder(b.shiftLabel);
    if (sa !== sb) return sa - sb;
    const pa = rolePriority(a.role); const pb = rolePriority(b.role);
    if (pa !== pb) return pa - pb;
    return (a.role||'').localeCompare(b.role||'');
  });
}

function cleanPhone(phone='') {
  return phone.replace(/[^\d+]/g, '');
}

function getShiftTime(entry={}, now=new Date()) {
  if (entry.shiftTime) return entry.shiftLabel ? `${entry.shiftLabel} · ${entry.shiftTime}` : entry.shiftTime;
  if (entry.hours) return entry.hours;
  if (entry.startTime && entry.endTime) return `${entry.startTime}-${entry.endTime}`;
  const after = (entry.role || '').match(/after\s+(\d{1,2})(?::(\d{2}))?/i);
  if (after) return `after ${after[1].padStart(2,'0')}:${after[2] || '00'}`;
  if (entry.coverageType === 'on-duty' || entry.coverageType === 'consult coverage' || entry.coverageType === 'inpatient coverage') return '07:30-16:30';
  if (entry.coverageType === 'on-call') return '16:30-07:30';
  const meta = parseRoleMeta(entry.role || '');
  if (meta.startTime && meta.endTime) return `${meta.startTime}-${meta.endTime}`;
  if (roleText(entry).includes('24h')) return '24h';
  return isWorkHours(now) ? '07:30-16:30' : '16:30-07:30';
}

function getEntrySection(entry={}, dept) {
  return entry.section || entry.coverage || dept.label || '';
}

function getPdfPreviewContext(deptKey, entries=[], qLow='') {
  if (deptKey !== 'radiology_duty' && deptKey !== 'radiology_oncall') return null;
  const intent = radiologyQueryIntent(qLow || '');
  const names = entries.map(entry => entry.name).filter(Boolean);
  if (intent === 'ct_neuro_er') {
    return {
      page: 1,
      section: 'CT Neuro (ER)',
      highlightTerms: ['CT Neuro (ER)', ...names],
    };
  }
  const firstSection = entries.find(entry => entry.section)?.section || '';
  const pageMap = {
    'CT - Neuro': 1,
    'CT - General': 1,
    'Ultrasound - Abdomen': 1,
    'Ultrasound - MSK': 2,
    'X-Ray / General': 2,
    'Nuclear / PET': 3,
    'CT Neuro (ER)': 1,
  };
  if (!firstSection) return null;
  return {
    page: pageMap[firstSection] || 1,
    section: firstSection,
    highlightTerms: [firstSection, ...names],
  };
}

function normalizeText(s='') {
  return s.toLowerCase().replace(/[^a-z0-9؀-ۿ]+/g,' ').replace(/\s+/g,' ').trim();
}

function hasAnyToken(q, words=[]) {
  const tokens = q.split(' ').filter(Boolean);
  return words.some(word => tokens.includes(word));
}

function hasAnyPhrase(q, phrases=[]) {
  return phrases.some(phrase => q.includes(normalizeText(phrase)));
}

const SMART_SEARCH = [
  { test:q => hasAnyToken(q, ['critical']) || hasAnyPhrase(q, ['critical care','intensive care']), deptKeys:['picu','medicine_on_call'], roleIncludes:['ER','On-Call','Responder'] },
  { test:q => hasAnyToken(q, ['abdominal']) || hasAnyPhrase(q, ['abdominal pain','abd pain']), deptKeys:['gastroenterology','surgery','medicine_on_call'], roleIncludes:['ER','Abdomen','GI','Surgery'] },
  { test:q => hasAnyToken(q, ['eye']) || hasAnyPhrase(q, ['eye pain','eye','vision','ophthalmology','ophthal','عين','عيون']), deptKeys:['ophthalmology'], roleIncludes:[] },
  { test:q => hasAnyToken(q, ['neuro']) || hasAnyPhrase(q, ['neurologic','neurological']), deptKeys:['neurology','neurosurgery'], roleIncludes:[] },
  { test:q => hasAnyPhrase(q, ['anesthesia','anaesthesia','anesthesiology','taam','تخدير']), deptKeys:['anesthesia'], roleIncludes:[] },
  { test:q => hasAnyPhrase(q, ['medicine on call','internal medicine on call','in house on call rota','باطنية مناوبة']) || (hasAnyToken(q, ['medicine']) && !hasAnyToken(q, ['endo','derm','rheum','gastro','gi','pulmon','infectious'])), deptKeys:['medicine_on_call'], roleIncludes:[] },
  { test:q => hasAnyPhrase(q, ['physical medicine','rehabilitation','rehabilitaion','pmr','pm r','تأهيل']), deptKeys:['physical_medicine_rehabilitation'], roleIncludes:[] },
  { test:q => hasAnyPhrase(q, ['pediatric neurology','paediatric neurology','ped neuro','ped neurology','أعصاب الأطفال']) && !hasAnyToken(q,['cardio','cardiac','heme','onco']), deptKeys:['pediatric_neurology'], roleIncludes:[] },
  { test:q => hasAnyPhrase(q, ['pediatric cardiology','ped cardiology','ped card','قلب أطفال']), deptKeys:['pediatric_cardiology'], roleIncludes:[] },
  { test:q => hasAnyPhrase(q, ['pediatric hematology','ped heme','ped oncology','pediatric heme','ped heme onc','أورام دم أطفال']), deptKeys:['pediatric_heme_onc'], roleIncludes:[] },
  { test:q => hasAnyToken(q, ['picu']) || hasAnyPhrase(q, ['pediatric icu','pediatric intensive']), deptKeys:['picu'], roleIncludes:[] },
  { test:q => (hasAnyToken(q,['pediatrics','pediatric','peds','paediatric']) && !hasAnyToken(q,['neuro','cardio','heme','icu','nephro','nephrology'])) || hasAnyPhrase(q,['طب أطفال','أطفال']), deptKeys:['pediatrics'], roleIncludes:[] },
  { test:q => hasAnyPhrase(q, ['adult cardiology','adult cardiac','cardiology']) || (hasAnyToken(q, ['cardiology','cardiac','cardiologist']) && !hasAnyToken(q, ['pediatric','ped'])), deptKeys:['adult_cardiology'], roleIncludes:[] },
  { test:q => hasAnyPhrase(q, ['neuro ir','neuro interventional','interventional radiology']) || (hasAnyToken(q, ['ir']) && hasAnyToken(q, ['neuro'])), deptKeys:['neuro_ir'], roleIncludes:[] },
  { test:q => hasAnyPhrase(q, ['clinical lab','clinical laboratory','lab pathology','blood bank','مختبر']), deptKeys:['clinical_lab'], roleIncludes:[] },
  { test:q => hasAnyPhrase(q, ['hospitalist','hospital medicine']), deptKeys:['hospitalist'], roleIncludes:[] },
  { test:q => hasAnyPhrase(q, ['orthopedics','orthopedic','orthopaedic','bone surgery']) || hasAnyToken(q, ['ortho','عظام']), deptKeys:['orthopedics'], roleIncludes:[] },
  { test:q => (hasAnyToken(q,['surgery','surgical','جراحة']) && !hasAnyToken(q,['neurosurg','neuro-surg','spine','cardiac','oral','plastic','vascular','thoracic','ped'])) || hasAnyPhrase(q,['general surgery']), deptKeys:['surgery'], roleIncludes:[] },
  { test:q => hasAnyToken(q,['neurology','stroke','epilepsy']) || (hasAnyToken(q,['neuro']) && !hasAnyToken(q,['neuro-surg','neurosurg','spine','ir','ped'])), deptKeys:['neurology'], roleIncludes:[] },
  { test:q => hasAnyPhrase(q, ['endocrinology','endocrine']) || hasAnyToken(q, ['endo','thyroid','diabetes']), deptKeys:['endocrinology'], roleIncludes:[] },
  { test:q => hasAnyPhrase(q, ['dermatology']) || hasAnyToken(q, ['derm','skin']), deptKeys:['dermatology'], roleIncludes:[] },
  { test:q => hasAnyPhrase(q, ['rheumatology']) || hasAnyToken(q, ['rheum']), deptKeys:['rheumatology'], roleIncludes:[] },
  { test:q => hasAnyPhrase(q, ['gastroenterology','جهاز هضمي']) || hasAnyToken(q, ['gastro','gi','ercp']), deptKeys:['gastroenterology'], roleIncludes:[] },
  { test:q => hasAnyPhrase(q, ['pulmonary','pulmonology','respiratory']) || hasAnyToken(q, ['pulmon','chest','lung']), deptKeys:['pulmonary'], roleIncludes:[] },
  { test:q => hasAnyPhrase(q, ['infectious disease','id consult','أمراض معدية']) || hasAnyToken(q, ['infectious','infection']), deptKeys:['infectious'], roleIncludes:[] },
  { test:q => hasAnyToken(q, ['ent']) || hasAnyPhrase(q, ['ear nose throat','اذن','أذن','انف','أنف','حنجرة']), deptKeys:['ent'], roleIncludes:[] },
  { test:q => hasAnyPhrase(q, ['dental','dentist','tooth','teeth','oral','oral surgery','maxillofacial','oral maxillofacial','oromaxillofacial','maxi','maxill','اسنان','أسنان']), deptKeys:['dental'], roleIncludes:[] },
  { test:q => hasAnyToken(q, ['ct','mri']) && hasAnyToken(q, ['brain','head','neuro','stroke']), deptKeys:['radiology_duty','radiology_oncall'], roleIncludes:['NEURO','Neuro'] },
  { test:q => hasAnyToken(q, ['us','ultrasound','sono','sonar']) && hasAnyToken(q, ['msk','musculoskeletal']), deptKeys:['radiology_duty'], roleIncludes:['MSK'] },
  { test:q => hasAnyToken(q, ['us','ultrasound','sono','sonar']) && hasAnyToken(q, ['abd','abdomen','abdominal']), deptKeys:['radiology_duty'], roleIncludes:['Abdomen','Ultrasound'] },
  { test:q => hasAnyToken(q, ['us','ultrasound','sono','sonar']) || hasAnyPhrase(q, ['سونار','التراساوند','ألتراساوند']), deptKeys:['radiology_duty'], roleIncludes:['Ultrasound','MSK','Abdomen'] },
  { test:q => hasAnyToken(q, ['ct','mri']) && hasAnyToken(q, ['abd','abdomen','abdominal']), deptKeys:['radiology_duty','radiology_oncall'], roleIncludes:['ABDOMEN','Abdomen','BODY'] },
  { test:q => hasAnyPhrase(q, ['pet','pet ct','pet-ct','nuclear','nuc med','نووي']), deptKeys:['radiology_duty','radiology_oncall'], roleIncludes:['NUCLEAR','Nuclear'] },
  { test:q => hasAnyToken(q, ['ct','mri','radiology','imaging','scan','xray','misc']) || hasAnyPhrase(q, ['x-ray','اشعة','أشعة']), deptKeys:['radiology_duty','radiology_oncall'], roleIncludes:['CT','MRI','X-Ray','Neuro','BODY','THORACIC','MSK','PEDIATRIC','BREAST','Abdomen','Ultrasound','On-Call'] },
];

function findSmartIntent(qLow) {
  const q = normalizeText(qLow);
  return SMART_SEARCH.find(rule => rule.test(q)) || null;
}

function filterEntriesByIntent(entries, intent) {
  if (!intent || !intent.roleIncludes || !intent.roleIncludes.length) return entries;
  const wanted = intent.roleIncludes.map(x => x.toLowerCase());
  const filtered = entries.filter(e => wanted.some(w => (e.role || '').toLowerCase().includes(w)));
  return filtered.length ? filtered : entries;
}

function isStrictExactDeptQuery(q, dept) {
  const nq = normalizeText(q);
  if (!nq) return false;
  if (normalizeText(dept.label) === nq) return true;
  return dept.keywords.some(kw => normalizeText(kw) === nq);
}

function matchesDeptLoose(q, deptKey, dept) {
  const nq = normalizeText(q);
  const tokens = nq.split(' ').filter(Boolean);
  const pool = [deptKey, dept.label, ...(dept.keywords || [])].map(normalizeText);
  if (isStrictExactDeptQuery(q, dept)) return true;
  if (tokens.length === 1 && tokens[0].length <= 3) {
    return pool.some(p => p.split(' ').includes(tokens[0]));
  }
  return pool.some(p => p.includes(nq)) || tokens.every(tok => pool.some(p => p.includes(tok)));
}

function getDeptDisplayPriority(deptKey, qLow) {
  const q = normalizeText(qLow);
  const dept = ROTAS[deptKey];
  const label = normalizeText(dept.label);
  if (q === 'medicine' && deptKey === 'medicine_on_call') return 0;
  if (q === 'medicine' && deptKey === 'medicine') return 2;
  if (q === deptKey || label === q) return 0;
  if (dept.keywords.some(kw => normalizeText(kw) === q)) return 1;
  if (dept.keywords.some(kw => normalizeText(kw).startsWith(q + ' ') || normalizeText(kw).endsWith(' ' + q))) return 2;
  if (label.includes(q)) return 3;
  return 5;
}

async function refreshPdfListAsync() {
  const box = document.getElementById('pdfList');
  if (!box) return;
  const uploaded = await getAllPdfRecords();
  const map = Object.fromEntries(uploaded.map(x => [x.deptKey, x]));
  const rows = Object.entries({...DEFAULT_PDF_MAP, ...map}).sort((a,b)=>a[0].localeCompare(b[0]));
  box.innerHTML = rows.map(([k,v]) => `<div class="mini-item"><strong>${k}</strong><span>${v.name || ''}</span></div>`).join('') || '<div class="mini-item"><span>No PDFs</span></div>';
}

function getActiveDeptKey(deptKey, now=new Date()) {
  if (deptKey === 'radiology_duty' || deptKey === 'radiology_oncall') {
    if (isSpecialtyActiveNow('radiology_oncall', now)) return 'radiology_oncall';
    if (isSpecialtyActiveNow('radiology_duty', now)) return 'radiology_duty';
    return 'radiology_oncall';
  }
  return deptKey;
}

function explicitImagingModeFromQuery(qLow='') {
  const q = normalizeText(qLow || '');
  if (!q) return '';
  if (
    q.includes('radiology duty') ||
    q.includes('imaging duty') ||
    q.includes('radiology on duty') ||
    q.includes('on duty radiology') ||
    q.includes('medical imaging duty')
  ) return 'radiology_duty';
  if (
    q.includes('radiology oncall') ||
    q.includes('radiology on call') ||
    q.includes('imaging oncall') ||
    q.includes('imaging on call') ||
    q.includes('medical imaging oncall') ||
    q.includes('medical imaging on call')
  ) return 'radiology_oncall';
  return '';
}

function normalizeMatchedForActiveShift(matched=[], now=new Date(), qLow='', exactMode=false) {
  const explicitImaging = explicitImagingModeFromQuery(qLow);
  const seen = new Set();
  return matched.reduce((list, [deptKey]) => {
    if ((exactMode || explicitImaging) && isImagingDeptKey(deptKey)) {
      const forcedKey = explicitImaging || deptKey;
      if (!ROTAS[forcedKey] || seen.has(forcedKey)) return list;
      seen.add(forcedKey);
      list.push([forcedKey, ROTAS[forcedKey]]);
      return list;
    }
    const activeKey = getActiveDeptKey(deptKey, now);
    if (!ROTAS[activeKey] || seen.has(activeKey)) return list;
    seen.add(activeKey);
    list.push([activeKey, ROTAS[activeKey]]);
    return list;
  }, []);
}


async function renderDeptList(matched, qLow, exactMode=false) {
  const now = new Date();
  const isImagingIconMode = imagingIconForced === 'radiology_duty' || imagingIconForced === 'radiology_oncall';
  if (!isImagingIconMode) {
    matched = normalizeMatchedForActiveShift(matched, now, qLow, exactMode);
  }
  const { date: schedDate, isOvernight } = getScheduleDate(now);
  const schedKey = fmtKey(schedDate);
  const displayKey = fmtKey(now);
  const results = document.getElementById('results');
  const cards = document.getElementById('cards');
  const rcount = document.getElementById('rcount');
  cards.innerHTML = '';

  if (isImagingIconMode) {
    matched = [[imagingIconForced, ROTAS[imagingIconForced]]];
  }

  if (!matched.length) {
    cards.innerHTML = '<div class="noq"><div class="em">🔍</div><p>No specialty found. Try: ENT, Oncology, Dental, CT brain, Ultrasound, PET-CT...</p></div>';
    rcount.textContent = '';
    results.classList.add('show');
    return;
  }
  const dateLabel = isOvernight
    ? `schedule of <strong>${schedKey}</strong> <span class="warn-inline">(night carry-over — current time is before 07:30)</span>`
    : `schedule of <strong>${displayKey}</strong>`;
  rcount.innerHTML = `${exactMode ? 'Showing 1 result' : (matched.length === 1 ? 'Showing 1 result' : `Showing <strong>${matched.length}</strong> results`)} · ${dateLabel}`;

  // Imaging icon-forced: show shift warning banner before cards
  if (isImagingIconMode) {
    const warn = document.createElement('div');
    warn.className = 'upload-debug';
    warn.style.cssText = 'background:rgba(255,200,0,0.13);border:1px solid rgba(255,200,0,0.4);color:#ffe066;border-radius:8px;padding:10px 14px;margin-bottom:12px;font-size:13px;';
    warn.innerHTML = getRadiologyForcedBannerHtml(imagingIconForced, now);
    cards.appendChild(warn);
  }

  const smart = exactMode ? null : findSmartIntent(qLow);
  for (const [k, d] of matched) {
    await ensureDeptSupportReady(k);
    let entries;
    if (isImagingIconMode) {
      if (imagingIconForced === 'radiology_oncall') {
        const shift = getSpecialtyCurrentShiftMeta('radiology_oncall', now);
        entries = isSpecialtyActiveNow('radiology_oncall', now) ? getEntries('radiology_oncall', ROTAS.radiology_oncall, schedKey, now, '') : [];
        entries = entries.map(e => ({ ...e, shiftLabel: `On-Call (${shift.time})`, shiftTime: shift.time }));
      } else {
        const shift = getSpecialtyCurrentShiftMeta('radiology_duty', now);
        entries = isSpecialtyActiveNow('radiology_duty', now) ? getEntries('radiology_duty', ROTAS.radiology_duty, schedKey, now, '') : [];
        entries = entries.map(e => ({ ...e, shiftLabel: `On-Duty (${shift.time})`, shiftTime: shift.time }));
      }
    } else {
      entries = getEntries(k, d, schedKey, now, qLow);
      if (k !== 'radiology_duty' && k !== 'radiology_oncall') entries = filterEntriesByIntent(entries, smart);
    }
    entries = sortEntries(entries);
    lastPreviewContextByDept.set(k, getPdfPreviewContext(k, entries, qLow));
    cards.appendChild(await buildCard(k, d, entries));
  }
  cards.querySelectorAll('[data-preview]').forEach(btn => btn.addEventListener('click', () => showPdfPreview(btn.dataset.preview, lastPreviewContextByDept.get(btn.dataset.preview) || null)));
  cards.querySelectorAll('[data-exact-specialty]').forEach(btn => btn.addEventListener('click', () => {
    showExactDept(btn.dataset.exactSpecialty);
  }));
  cards.querySelectorAll('[data-copy-phone]').forEach(btn => btn.addEventListener('click', () => copyPhoneNumber(btn.dataset.copyPhone, btn)));
  results.classList.add('show');
}

// When set, a radiology icon/card click should show that clicked mode only.
let imagingIconForced = '';

async function showExactDept(deptKey) {
  closePdfPreview();
  const welcome = document.getElementById('welcome');
  welcome.style.display = 'none';
  const dept = ROTAS[deptKey];
  if (!dept) return;
  // For radiology keys from icon click: force the clicked mode only.
  if (deptKey === 'radiology_duty' || deptKey === 'radiology_oncall') {
    imagingIconForced = deptKey;
  } else {
    imagingIconForced = '';
  }
  document.getElementById('search').value = deptKey;
  return renderDeptList([[deptKey, dept]], deptKey, true);
}

async function copyPhoneNumber(phone, button) {
  if (!phone) return;
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(phone);
    } else {
      const tmp = document.createElement('textarea');
      tmp.value = phone;
      tmp.style.position = 'fixed';
      tmp.style.opacity = '0';
      document.body.appendChild(tmp);
      tmp.select();
      document.execCommand('copy');
      tmp.remove();
    }
    const oldText = button.textContent;
    button.textContent = 'Copied';
    setTimeout(() => { button.textContent = oldText; }, 1200);
  } catch (err) {
    console.warn('Copy failed', err);
  }
}

function isDeptHardBlocked(deptKey) {
  const dept = ROTAS[deptKey];
  if (isImagingDeptKey(deptKey)) {
    return !!(dept && dept.auditBlocked);
  }
  const uploaded = uploadedRecordForDept(deptKey);
  const hasBuiltInSchedule = !!(dept && dept.schedule && Object.keys(dept.schedule).length);
  if (uploaded && uploaded.review && (uploaded.review.parsing || uploaded.review.auditRejected)) {
    // Do not let a failed/stale upload hide a stable built-in specialty.
    // The rejected upload should remain in review, but the live card should still use the
    // built-in source of truth when one exists.
    if (!hasBuiltInSchedule || dept?.uploadedOnly) return true;
  }
  return !!(dept && dept.auditBlocked);
}

function uploadBlockReasonSummary(record=null) {
  const codes = record?.diagnostics?.activation?.reasonCodes || [];
  if (!codes.length) return '';
  return codes.map(reasonCodeExplanation).join(' · ');
}

async function buildCard(deptKey, dept, entries) {
  const card = document.createElement('div');
  card.className = 'dcard';
  const pdf = await getPdfHref(deptKey);
  const now = new Date();
  if (deptKey === 'radiology_duty' && Array.isArray(entries)) {
    entries = dedupeRadiologyDutyDisplayEntries(entries);
  }
  let rowsHtml = '';
  if (isDeptHardBlocked(deptKey)) {
    const uploaded = uploadedRecordForDept(deptKey);
    const reasonText = uploadBlockReasonSummary(uploaded);
    rowsHtml = `<div class="empty">Needs review${reasonText ? ` · ${escapeHtml(reasonText)}` : ''}</div>`;
  } else if (!entries || entries.length === 0) {
    const uploaded = uploadedRecordForDept(deptKey);
    if (uploaded && uploaded.review && (uploaded.review.parsing || uploaded.review.auditRejected)) {
      const reasonText = uploadBlockReasonSummary(uploaded);
      rowsHtml = `<div class="empty">Parsing failed - review needed${reasonText ? ` · ${escapeHtml(reasonText)}` : ''}</div>`;
    } else if ((deptKey === 'radiology_duty' || deptKey === 'radiology_oncall') && imagingIconForced === deptKey) {
      rowsHtml = '<div class="empty">No active coverage</div>';
    } else {
      rowsHtml = '<div class="empty">No active on-call found</div>';
    }
  } else if (entries.every(isNoCoverageEntry)) {
    rowsHtml = '<div class="empty">No coverage</div>';
  } else {
    // Group radiology entries by shiftLabel for transition-window de-emphasis
    const isRadiology = deptKey === 'radiology_duty' || deptKey === 'radiology_oncall';
    const hasUpcoming = isRadiology && entries.some(e => e.shiftLabel === 'Upcoming Shift');
    let currentSectionLabel = null;

    entries.forEach(e => {
      const ph = resolvePhone(dept, e);
      const explicitNameReview = typeof e.doctorNameUncertain === 'boolean' ? e.doctorNameUncertain : isNameUncertain(e.name);
      const nameReview = explicitNameReview && !(deptKey === 'radiology_duty' && e.parsedFromPdf);
      const phone = ph ? cleanPhone(ph.phone) : '';
      const phoneText = ph ? `${ph.phone}${ph.uncertain ? ' ?' : ''}` : '';
      const shiftTime = getShiftTime(e, now);
      const section = getEntrySection(e, dept);

      // Confidence marker from Auditor
      const conf = e._confidence || 'high';
      const confMark = conf === 'low'    ? ' <span title="Low confidence — review recommended" style="color:var(--red,#ff5252);font-size:10px;">⚠️</span>'
                     : conf === 'medium' ? ' <span title="Medium confidence" style="color:var(--amber,#ffab40);font-size:10px;">?</span>'
                     : '';

      // For radiology in transition window: insert section header and dim upcoming rows
      const isUpcomingEntry = isRadiology && e.shiftLabel === 'Upcoming Shift';
      const rowStyle = isUpcomingEntry
        ? 'opacity:0.45;filter:grayscale(0.6);border-left:3px solid rgba(120,120,120,0.3);'
        : '';
      const rowClass = isUpcomingEntry ? 'drow drow-upcoming' : 'drow';

      // Insert section divider for shift transitions
      if (isRadiology && e.shiftLabel && e.shiftLabel !== currentSectionLabel) {
        currentSectionLabel = e.shiftLabel;
        const isUpcomingSection = e.shiftLabel === 'Upcoming Shift';
        rowsHtml += `<div class="drow-section-header" style="${isUpcomingSection ? 'opacity:0.55;color:var(--text-3,#888);font-size:11px;' : 'font-size:11px;color:var(--accent,#7ee8fa);'}">
          ${isUpcomingSection ? '🕐 Upcoming: ' : '✅ Current: '}${e.shiftLabel} · ${e.shiftTime || ''}
        </div>`;
      }

      rowsHtml += `
        <div class="${rowClass}" style="${rowStyle}">
          <div class="dinfo">
            <div class="ddrname">${e.name}${nameReview ? ' ?' : ''}${confMark}</div>
            <div class="drrole">${e.role}</div>
            <div class="dsection">${section}</div>
            <div class="dshift">${shiftTime}</div>
          </div>
          <div class="dmeta">
            ${ph ? `<div class="ph">${phoneText}</div>` : '<span class="noph">No number</span>'}
            ${ph ? `<div class="row-actions">
              ${ph.uncertain ? '<span class="callbtn disabled">Call</span>' : `<a class="callbtn" href="tel:${phone}">Call</a>`}
              <button class="callbtn copy" type="button" data-copy-phone="${phone}">Copy Number</button>
            </div>` : ''}
          </div>
        </div>`;
    });
  }
  const pdfBtns = pdf ? `
    <button class="ghostbtn" type="button" data-preview="${deptKey}">عرض داخل الصفحة</button>
    <a class="ghostbtn" href="${pdf.href}" target="_blank" rel="noopener">فتح PDF</a>
    <a class="ghostbtn" href="${pdf.href}" download="${pdf.name || 'rota.pdf'}">تحميل</a>` : '';
  card.innerHTML = `
    <div class="dhead">
      <div class="dname"><div class="dicon" data-exact-specialty="${deptKey}" title="Show only this specialty">${dept.icon}</div>${dept.label}</div>
      <div class="hactions">
        <span class="dbadge">On-Call Now</span>${pdfBtns}
      </div>
    </div>
    <div class="dgrid">${rowsHtml}</div>`;
  return card;
}

async function search(q) {
  ensureCoreAggregateSpecialties();
  imagingIconForced = ''; // typing = time-based logic always
  const qLow = q.trim().toLowerCase();
  if (currentPdfPreviewKey) closePdfPreview();
  const welcome = document.getElementById('welcome');
  if (!qLow) {
    welcome.style.display = 'block'; document.getElementById('results').classList.remove('show'); closePdfPreview(); return;
  }
  welcome.style.display = 'none';

  const smart = findSmartIntent(qLow);
  let matched = [];

  if (smart) {
    matched = smart.deptKeys.filter(k => ROTAS[k]).map(k => [k, ROTAS[k]]);
  } else {
    matched = Object.entries(ROTAS).filter(([k, d]) => matchesDeptLoose(qLow, k, d));
  }

  matched = matched.sort((a,b) => getDeptDisplayPriority(a[0], qLow) - getDeptDisplayPriority(b[0], qLow));
  return renderDeptList(matched, qLow, false);
}


// ═══════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════
const TAG_LIST = [
  ['medicine_on_call','Medicine On-Call'],
  ['hospitalist','Hospitalist'],
  ['surgery','Surgery'],
  ['pediatrics','Pediatrics'],
  ['ent','ENT'],
  ['orthopedics','Orthopedics'],
  ['radiology_oncall','Imaging On-Call'],
  ['radiology_duty','Imaging On-Duty'],
  ['medicine','Medicine'],
  ['neurology','Neurology'],
  ['neurosurgery','Neuro-Surg'],
  ['adult_cardiology','Cardiology'],
  ['gynecology','Gynecology'],
  ['picu','PICU'],
  ['anesthesia','Anesthesia'],
  ['psychiatry','Psychiatry'],
  ['pediatric_neurology','Ped Neuro'],
  ['pediatric_cardiology','Ped Cardio'],
  ['pediatric_heme_onc','Ped Heme-Onc'],
  ['neuro_ir','Neuro IR'],
  ['urology','Urology'],
  ['ophthalmology','Eye'],
  ['hematology','Heme-Onco'],
  ['radonc','Rad-Onc'],
  ['nephrology','Nephrology'],
  ['kptx','K-Transplant'],
  ['liver','Liver-Tx'],
  ['spine','Spine'],
  ['palliative','Palliative'],
  ['dental','Dental'],
  ['clinical_lab','Clinical Lab'],
  ['physical_medicine_rehabilitation','PMR'],
  ['endocrinology','Endocrinology'],
  ['dermatology','Dermatology'],
  ['rheumatology','Rheumatology'],
  ['gastroenterology','GI'],
  ['pulmonary','Pulmonary'],
  ['infectious','Infectious Disease'],
];

function ensureCoreAggregateSpecialties() {
  if (!ROTAS.medicine) {
    ROTAS.medicine = {
      label:'Medicine / الباطنية',
      icon:'🩺',
      keywords:['medicine','internal medicine','باطنية','department of medicine', ...MEDICINE_SUBSPECIALTY_KEYS],
      contacts:{},
      schedule:{},
      aggregateOnly:true,
    };
  }
}

function activeDeptEntries() {
  ensureCoreAggregateSpecialties();
  return Object.entries(ROTAS).filter(([, dept]) => !dept.hidden);
}

function homepagePriorityOf(deptKey, dept) {
  const exact = HOMEPAGE_PRIORITY.indexOf(deptKey);
  if (exact >= 0) return exact;
  const label = normalizeText(dept.label || '');
  if (label.includes('transplant')) return HOMEPAGE_PRIORITY.indexOf('kptx');
  return 100;
}

function sortDeptEntriesForHome(entries=[]) {
  return [...entries].sort((a,b) => {
    const pa = homepagePriorityOf(a[0], a[1]);
    const pb = homepagePriorityOf(b[0], b[1]);
    if (pa !== pb) return pa - pb;
    return (a[1].label || '').localeCompare(b[1].label || '');
  });
}

function renderTags() {
  ensureCoreAggregateSpecialties();
  const tagsEl = document.getElementById('tags');
  tagsEl.innerHTML = '';
  TAG_LIST.filter(([k]) => ROTAS[k]).forEach(([k,lbl]) => {
    const t = document.createElement('span');
    t.className = 'tag'; t.textContent = lbl;
    t.onclick = () => {
      document.getElementById('search').value = k;
      document.querySelectorAll('.tag').forEach(x=>x.classList.remove('on'));
      t.classList.add('on');
      showExactDept(k);
    };
    tagsEl.appendChild(t);
  });
  activeDeptEntries()
    .filter(([k, dept]) => dept.uploadedOnly && !TAG_LIST.some(([tagKey]) => tagKey === k))
    .sort((a,b) => (a[1].label || '').localeCompare(b[1].label || ''))
    .forEach(([k,d]) => {
      const t = document.createElement('span');
      t.className = 'tag'; t.textContent = d.label;
      t.onclick = () => {
        document.getElementById('search').value = k;
        document.querySelectorAll('.tag').forEach(x=>x.classList.remove('on'));
        t.classList.add('on');
        showExactDept(k);
      };
      tagsEl.appendChild(t);
    });
}

function renderWelcomeGrid() {
  const wgrid = document.getElementById('wgrid');
  wgrid.innerHTML = '';
  sortDeptEntriesForHome(activeDeptEntries()).forEach(([k,d]) => {
    const p = document.createElement('div');
    p.className = 'dpill';
    const nm = homepageLabel(d.label);
    p.innerHTML = `<span>${d.icon}</span><span class="dpill-name">${nm}</span>`;
    p.onclick = () => { showExactDept(k); };
    wgrid.appendChild(p);
  });
}

async function loadUploadedSpecialties() {
  const uploaded = await getAllPdfRecords();
  uploadedPdfRecords = new Map();
  for (const record of uploaded) {
    const refreshed = refreshUploadedRecordIfNeeded(record);
    if (refreshed !== record) {
      await savePdfRecord(refreshed);
    }
    const normalized = canonicalizeUploadedRecord(refreshed);
    cacheUploadedRecord(normalized);
    if (shouldRegisterUploadedSpecialty(normalized)) registerUploadedSpecialty(normalized);
  }
  return uploaded;
}

document.addEventListener('DOMContentLoaded', () => {
  tick(); setInterval(tick,1000);

  loadUploadedSpecialties().then(() => Promise.all([
    hydrateBundledSurgerySchedule(),
    hydrateBundledHospitalistSchedule(),
    hydrateBundledPediatricsContacts(),
    hydrateBundledPicuSchedule(),
  ])).finally(() => {
    renderTags();
    renderWelcomeGrid();
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
      } else {
        await saveRejectedPdfRecord(uploadRecord);
      }

      debug.saved = true;
      debug.searchable = !!ROTAS[deptKey] && !!uploadedRecordForDept(deptKey) && uploadedRecordForDept(deptKey).parsedActive;
      debugLines.push(debug);
      accepted.push(`${file.name} → ${deptKey}${uncertain ? '?' : ''} (${source}; ${entries.length} doctor rows${review.parsing ? '; parsing failed' : publishToLive ? '; active' : '; review only'})`);
      if (needsReview || review.parsing) reviewNotes.push(`${deptKey}: ${review.parsing ? 'Parsing failed - review needed' : '? needs review'}`);
      if (publishToLive) latestDeptKey = deptKey;
    }
    await refreshPdfListAsync();
    renderTags();
    renderWelcomeGrid();
    await Auditor.runRegressionSuite();
    Auditor.renderReviewPanel();
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
          return `<div class="upload-debug ${okClass}">${escapeHtml(item.file)}: received=yes · text=${item.textChars?'yes':'no'} (${item.textChars}) · specialty=${escapeHtml(item.specialty)} · doctors=${item.rows}${conf}${trust} · saved=${item.saved?'yes':'no'} · searchable=${item.searchable?'yes':'no'} · ${escapeHtml(item.status)}</div>${templateInfo}${previewHtml}${riskHtml}${reasonCodeHtml}${issueHtml}${item.sectionDebug || ''}`;
        }).join('')
      : (accepted.length ? `Active PDFs updated: ${accepted.length}` : '');
    if (reviewNotes.length) status.innerHTML += `<div class="upload-debug fail">⚠️ Review: ${escapeHtml(reviewNotes.join(' · '))}</div>`;
    if (skipped.length) status.innerHTML += `<div class="upload-debug fail">Needs manual rename/detection: ${escapeHtml(skipped.join(' · '))}</div>`;
    if (!accepted.length && !skipped.length) status.textContent = 'No PDF selected.';
    const q = document.getElementById('search').value;
    if (q) await search(q);
    if (latestDeptKey) showPdfPreview(latestDeptKey);
  }

  document.getElementById('pdfUploadInline').addEventListener('change', async (e) => {
    await handlePdfUpload(e.target.files);
    e.target.value = '';
  });

  refreshPdfListAsync();

  // Search
  const si = document.getElementById('search');
  si.addEventListener('input', e => {
    imagingIconForced = false; // search always uses time-based logic
    document.querySelectorAll('.tag').forEach(x=>x.classList.remove('on'));
    search(e.target.value);
  });
  si.focus();
});
