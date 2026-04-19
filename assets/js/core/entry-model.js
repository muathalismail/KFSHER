// ═══════════════════════════════════════════════════════════════
// core/entry-model.js — Entry classification and active filtering
// ═══════════════════════════════════════════════════════════════
// Canonical entry classification functions.
// Depends on: core/time.js (isWorkHours, timeRangeActive)
// ═══════════════════════════════════════════════════════════════

const MEDICINE_SUBSPECIALTY_KEYS = [
  'endocrinology',
  'dermatology',
  'rheumatology',
  'gastroenterology',
  'pulmonary',
  'infectious',
];

function isMedicineSubspecialty(deptKey) {
  return MEDICINE_SUBSPECIALTY_KEYS.includes(deptKey);
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
