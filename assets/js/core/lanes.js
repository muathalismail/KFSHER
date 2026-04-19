// ═══════════════════════════════════════════════════════════════
// core/lanes.js — Lane definitions per specialty
// ═══════════════════════════════════════════════════════════════
// Each specialty defines ordered lanes (role slots) that determine
// display order and what roles to look for.
// Depends on: nothing (pure data)
// ═══════════════════════════════════════════════════════════════

/**
 * Lane definition:
 *   id:       Unique lane identifier
 *   label:    Human-readable label for the lane
 *   tier:     Numeric sort order (lower = higher priority)
 *   required: Whether this lane should show "Not assigned" if empty
 *   match:    RegExp or function(role) to match entries to this lane
 *   exclude:  Optional RegExp to reject false matches
 *   shift:    Optional default shift window { start, end, type }
 */

const SPECIALTY_LANES = {};

// ── Neurology ─────────────────────────────────────────────────
SPECIALTY_LANES.neurology = [
  {
    id: 'first_oncall',
    label: 'Junior Resident',
    tier: 0,
    required: true,
    match: /junior resident|1st on-call resident|^resident$|resident on-call/i,
  },
  {
    id: 'second_oncall',
    label: 'Senior Resident',
    tier: 1,
    required: true,
    match: /senior resident|2nd on-call senior resident|2nd on-call/i,
  },
  {
    id: 'associate',
    label: 'Associate Consultant On-Call',
    tier: 2,
    required: false,
    match: /associate consultant on-call/i,
  },
  {
    id: 'consultant',
    label: 'Consultant On-Call',
    tier: 3,
    required: true,
    match: /consultant on-call/i,
    exclude: /stroke|associate/i,
  },
];

// ── Surgery ───────────────────────────────────────────────────
SPECIALTY_LANES.surgery = [
  {
    id: 'junior_resident',
    label: 'Junior Resident',
    tier: 0,
    required: false,
    match: /junior resident/i,
  },
  {
    id: 'senior_resident',
    label: 'Senior Resident',
    tier: 1,
    required: false,
    match: /senior resident/i,
  },
  {
    id: 'associate',
    label: 'Associate On-Call',
    tier: 2,
    required: false,
    match: /associate on-call/i,
  },
  {
    id: 'consultant',
    label: 'Consultant On-Call',
    tier: 3,
    required: true,
    match: /consultant on-call/i,
  },
];

// ── Pediatrics ────────────────────────────────────────────────
SPECIALTY_LANES.pediatrics = [
  {
    id: 'first_oncall',
    label: '1st On-Call',
    tier: 0,
    required: true,
    match: /1st on-call|hospitalist er/i,
    shift: { start: '15:30', end: '07:30', type: 'on-call' },
  },
  {
    id: 'second_oncall',
    label: '2nd On-Call',
    tier: 1,
    required: true,
    match: /2nd on-call/i,
    shift: { start: '07:30', end: '07:30', type: '24h' },
  },
  {
    id: 'third_oncall',
    label: '3rd On-Call',
    tier: 2,
    required: false,
    match: /3rd on-call/i,
    shift: { start: '07:30', end: '07:30', type: '24h' },
  },
  {
    id: 'kfsh_er',
    label: 'KFSH ER Hospitalist',
    tier: 3,
    required: false,
    match: /kfsh er/i,
    shift: { start: '07:30', end: '16:30', type: 'day' },
  },
  {
    id: 'consultant',
    label: 'Consultant On-Call',
    tier: 4,
    required: false,
    match: /consultant on-call/i,
  },
];

// ── PICU ──────────────────────────────────────────────────────
SPECIALTY_LANES.picu = [
  {
    id: 'day_resident',
    label: 'Day Resident',
    tier: 0,
    required: false,
    match: entry => normalizeText(entry.picuField || '') === 'day_resident',
    shift: { start: '07:30', end: '15:30', type: 'day' },
  },
  {
    id: 'day_assistant_1',
    label: 'Day Assistant 1',
    tier: 1,
    required: false,
    match: entry => normalizeText(entry.picuField || '') === 'day_assistant_1',
    shift: { start: '07:30', end: '15:30', type: 'day' },
  },
  {
    id: 'day_assistant_2',
    label: 'Day Assistant 2',
    tier: 2,
    required: false,
    match: entry => normalizeText(entry.picuField || '') === 'day_assistant_2',
    shift: { start: '07:30', end: '15:30', type: 'day' },
  },
  {
    id: 'resident_24h',
    label: 'Resident 24H',
    tier: 3,
    required: true,
    match: entry => normalizeText(entry.picuField || '') === 'resident_24h',
    shift: { start: '07:30', end: '07:30', type: '24h' },
  },
  {
    id: 'after_hours',
    label: 'After Hours Doctor',
    tier: 4,
    required: false,
    match: entry => normalizeText(entry.picuField || '') === 'after_hours_doctor',
    shift: { start: '15:30', end: '07:30', type: 'night' },
  },
  {
    id: 'consultant_24h',
    label: 'Consultant 24H',
    tier: 5,
    required: true,
    match: entry => normalizeText(entry.picuField || '') === 'consultant_24h',
    shift: { start: '07:30', end: '07:30', type: '24h' },
  },
];

// ── Hematology ────────────────────────────────────────────────
SPECIALTY_LANES.hematology = [
  {
    id: 'first_oncall',
    label: '1st On-Call Resident',
    tier: 0,
    required: true,
    match: /1st on-call|er\/consult|2nd rounder/i,
  },
  {
    id: 'fellow',
    label: 'Fellow On-Call',
    tier: 1,
    required: false,
    match: /fellow on-call/i,
  },
  {
    id: 'consultant',
    label: 'Consultant On-Call',
    tier: 2,
    required: true,
    match: /consultant on-call|consultation coverage|consultant inpatient/i,
  },
];

// ── Neurosurgery ──────────────────────────────────────────────
SPECIALTY_LANES.neurosurgery = [
  {
    id: 'resident_day',
    label: 'Resident (Day)',
    tier: 0,
    required: false,
    match: /resident on-duty \(day\)|1st resident/i,
    shift: { start: '07:30', end: '17:00', type: 'day' },
  },
  {
    id: 'resident_night',
    label: 'Resident (Night)',
    tier: 0,
    required: false,
    match: /resident on-duty \(night\)|2nd resident/i,
    shift: { start: '17:00', end: '07:30', type: 'night' },
  },
  {
    id: 'second_onduty',
    label: '2nd On-Duty',
    tier: 1,
    required: false,
    match: /2nd on-duty|fellow|second on-call/i,
  },
  {
    id: 'associate',
    label: 'Associate Consultant',
    tier: 2,
    required: false,
    match: /associate consultant/i,
  },
  {
    id: 'consultant',
    label: 'Neurosurgeon Consultant',
    tier: 3,
    required: true,
    match: /neurosurgeon consultant|consultant on-call/i,
    exclude: /associate/i,
  },
];

// ── Spine Surgery ────────────────────────────────────────────
SPECIALTY_LANES.spine = [
  {
    id: 'resident_day',
    label: 'Resident (Day)',
    tier: 0,
    required: false,
    match: /resident on-duty \(day\)/i,
    shift: { start: '07:30', end: '17:00', type: 'day' },
  },
  {
    id: 'resident_night',
    label: 'Resident (Night)',
    tier: 0,
    required: false,
    match: /resident on-duty \(night\)/i,
    shift: { start: '17:00', end: '07:30', type: 'night' },
  },
  {
    id: 'second_onduty',
    label: '2nd On-Duty',
    tier: 1,
    required: false,
    match: /2nd on-duty|fellow/i,
  },
  {
    id: 'consultant',
    label: 'Spine Consultant',
    tier: 2,
    required: true,
    match: /spine consultant|consultant on-call/i,
  },
];

// ── KPTX (Kidney/Pancreas Transplant) ────────────────────────
// Three lanes only: 1st On-Call, 2nd On-Call, Consultant On-Call.
// Inpatient+Consultation, SCOT, and Coordinator are ignored by the parser.
SPECIALTY_LANES.kptx = [
  {
    id: '1st_oncall',
    label: '1st On-Call',
    tier: 0,
    required: true,
    match: /1st on-call/i,
    shift: { start: '16:30', end: '07:30', type: 'night' },
  },
  {
    id: '2nd_oncall',
    label: '2nd On-Call',
    tier: 1,
    required: false,
    match: /2nd on-call/i,
    shift: { start: '16:30', end: '07:30', type: 'night' },
  },
  {
    id: 'consultant',
    label: 'Consultant On-Call',
    tier: 2,
    required: true,
    match: /consultant on-call/i,
    shift: { start: '07:30', end: '07:30', type: '24h' },
  },
];

// ── Liver Transplant ──────────────────────────────────────────
SPECIALTY_LANES.liver = [
  {
    id: 'smrod',
    label: 'SMROD',
    tier: 0,
    required: false,
    match: /smrod/i,
  },
  {
    id: 'day_coverage',
    label: 'Day Coverage',
    tier: 1,
    required: false,
    match: /day coverage|assistant consultant 1st on call/i,
    shift: { start: '07:30', end: '16:30', type: 'day' },
  },
  {
    id: 'after_duty',
    label: '1st On-Call After Duty',
    tier: 2,
    required: false,
    match: /after duty|after.hours|night on call/i,
    shift: { start: '16:30', end: '07:30', type: 'night' },
  },
  {
    id: 'second_oncall',
    label: '2nd On-Call',
    tier: 3,
    required: false,
    match: /2nd on call/i,
  },
  {
    id: 'consultant_oncall',
    label: 'Consultant On-Call',
    tier: 4,
    required: false,
    match: /consultant on call|3rd on call/i,
  },
];

// ── Hospitalist ───────────────────────────────────────────────
SPECIALTY_LANES.hospitalist = [
  {
    id: 'er_doctor',
    label: 'ER Doctor',
    tier: 0,
    required: true,
    match: /er|emergency/i,
  },
  {
    id: 'oncology_er',
    label: 'Oncology ER',
    tier: 1,
    required: false,
    match: entry => (entry.section || '').toLowerCase().includes('oncology er'),
  },
];

// ── Orthopedics ───────────────────────────────────────────────
SPECIALTY_LANES.orthopedics = [
  {
    id: 'resident_oncall',
    label: 'Resident On-Call',
    tier: 0,
    required: true,
    match: /resident/i,
    shift: { start: '07:30', end: '07:30', type: '24h' },
  },
  {
    id: '2nd_oncall',
    label: '2nd On-Call',
    tier: 1,
    required: true,
    match: /2nd/i,
    shift: { start: '07:30', end: '07:30', type: '24h' },
  },
  {
    id: 'consultant_oncall',
    label: 'Consultant On-Call',
    tier: 2,
    required: true,
    match: /consultant/i,
    shift: { start: '07:30', end: '07:30', type: '24h' },
  },
];

// ── Medicine On-Call ──────────────────────────────────────────
SPECIALTY_LANES.medicine_on_call = [
  {
    id: 'junior_er',
    label: 'Junior ER',
    tier: 0,
    required: false,
    match: /junior er/i,
  },
  {
    id: 'senior_er',
    label: 'Senior ER',
    tier: 1,
    required: false,
    match: /senior er/i,
  },
  {
    id: 'hospitalist_er',
    label: 'Hospitalist ER',
    tier: 2,
    required: false,
    match: /hospitalist er/i,
  },
  {
    id: 'smrod',
    label: 'SMROD',
    tier: -1,
    required: false,
    match: /smrod/i,
  },
];

// ── Medicine subspecialties (shared lanes) ────────────────────
const MEDICINE_SUBSPECIALTY_LANES = [
  {
    id: 'on_duty',
    label: 'On-Duty',
    tier: 0,
    required: false,
    match: entry => entry.coverageType !== 'on-call',
    shift: { start: '07:30', end: '16:30', type: 'day' },
  },
  {
    id: 'on_call',
    label: 'On-Call',
    tier: 1,
    required: true,
    match: entry => entry.coverageType === 'on-call',
    shift: { start: '16:30', end: '07:30', type: 'night' },
  },
  {
    id: 'all_day',
    label: '24H Coverage',
    tier: 2,
    required: false,
    match: entry => roleText(entry).includes('24h'),
    shift: { start: '07:30', end: '07:30', type: '24h' },
  },
];

// Apply shared lanes to most medicine subspecialties
['endocrinology','rheumatology','gastroenterology','pulmonary'].forEach(key => {
  SPECIALTY_LANES[key] = MEDICINE_SUBSPECIALTY_LANES;
});

// ── Dermatology — On-Call before 2nd On-Call ─────────────────
SPECIALTY_LANES.dermatology = [
  {
    id: 'on_call',
    label: 'On-Call',
    tier: 0,
    required: false,
    match: /^on-call$/i,
  },
  {
    id: 'second_on_call',
    label: '2nd On-Call',
    tier: 1,
    required: false,
    match: /2nd on-call/i,
  },
];

// ── Infectious Disease — Fellow before Consultant ────────────
SPECIALTY_LANES.infectious = [
  {
    id: 'fellow',
    label: 'Fellow On-Call',
    tier: 0,
    required: false,
    match: /fellow/i,
  },
  {
    id: 'consultant',
    label: 'Consultant On-Call',
    tier: 1,
    required: false,
    match: /consultant/i,
  },
];

// ═══════════════════════════════════════════════════════════════
// Lane matching utilities
// ═══════════════════════════════════════════════════════════════

/**
 * Returns the lane definitions for a specialty, or null if none defined.
 */
function getLanesForDept(deptKey) {
  return SPECIALTY_LANES[deptKey] || null;
}

/**
 * Matches an entry to a lane definition.
 * Returns the lane id, or null if no match.
 */
function matchEntryToLane(entry, lanes) {
  if (!entry || !lanes) return null;
  const role = (entry.role || '').toLowerCase();
  for (const lane of lanes) {
    // Check exclusion first
    if (lane.exclude && lane.exclude.test(role)) continue;
    // Match
    if (typeof lane.match === 'function') {
      if (lane.match(entry)) return lane.id;
    } else if (lane.match instanceof RegExp) {
      if (lane.match.test(role)) return lane.id;
    }
  }
  return null;
}

/**
 * Returns the tier for a given lane id within a specialty's lane definitions.
 * Used for sorting entries in display order.
 * Falls back to 99 (bottom) if no lane match.
 */
function getLaneTier(deptKey, entry) {
  const lanes = SPECIALTY_LANES[deptKey];
  if (!lanes) return rolePriorityFallback(entry.role || '');
  const laneId = matchEntryToLane(entry, lanes);
  if (!laneId) return rolePriorityFallback(entry.role || '');
  const lane = lanes.find(l => l.id === laneId);
  return lane ? lane.tier : 99;
}

/**
 * Fallback role priority for specialties without lane definitions.
 * Same logic as the original rolePriority but used as fallback only.
 */
function rolePriorityFallback(role='') {
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
