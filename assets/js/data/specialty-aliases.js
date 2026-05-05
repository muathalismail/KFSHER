// ═══════════════════════════════════════════════════════════════
// data/specialty-aliases.js — Canonical alias map for smart matching
// Used by both client (modal) and server (monitoring.js)
// ═══════════════════════════════════════════════════════════════

const SPECIALTY_ALIASES = {
  medicine_on_call: ['medicine on call','medicine on-call','internal medicine on call','im on call','باطنية مناوبة'],
  hospitalist: ['hospitalist','hospitalists','hospital medicine'],
  surgery: ['surgery','general surgery','gen surg','جراحة'],
  pediatrics: ['pediatrics','peds','pediatric','general pediatrics','أطفال'],
  ent: ['ent','otolaryngology','otorhinolaryngology','ear nose throat','أنف وأذن'],
  orthopedics: ['orthopedics','orthopaedics','ortho','orthopedic surgery','عظام'],
  radiology_oncall: ['radiology on-call','radiology oncall','imaging on-call','imaging oncall'],
  radiology_duty: ['radiology duty','radiology on-duty','imaging on-duty','imaging duty'],
  palliative: ['palliative','palliative care','palliative medicine','رعاية تلطيفية'],
  neurology: ['neurology','neuro','adult neurology','أعصاب'],
  neurosurgery: ['neurosurgery','neuro surgery','neurosurgical','جراحة أعصاب'],
  spine: ['spine','spine surgery','spinal surgery','عمود فقري'],
  gynecology: ['gynecology','gyn','obgyn','ob-gyn','obstetrics gynecology','نسائية'],
  critical_care: ['icu','critical care','intensive care','ccu','عناية مركزة'],
  picu: ['picu','pediatric icu','pediatric intensive care','peds icu'],
  anesthesia: ['anesthesia','anaesthesia','anesthesiology','تخدير'],
  psychiatry: ['psychiatry','psych','mental health','نفسية'],
  pediatric_neurology: ['pediatric neurology','ped neuro','peds neuro','child neurology','pnd','أعصاب أطفال'],
  pediatric_cardiology: ['pediatric cardiology','ped cardio','peds cardio','child cardiology','قلب أطفال'],
  pediatric_heme_onc: ['pediatric heme-onc','ped heme onc','peds heme onc','pediatric hematology oncology'],
  neuro_ir: ['neuro ir','neurointerventional','neurointerventional radiology'],
  urology: ['urology','uro','مسالك'],
  ophthalmology: ['ophthalmology','eye','ophth','ophthalmic','عيون'],
  oncology: ['oncology','adult oncology','medical oncology','أورام'],
  hematology: ['hematology-oncology','heme-onco','heme onc','hematology oncology','adult hematology','دم'],
  radonc: ['rad-onc','radiation oncology','radonc','إشعاع'],
  nephrology: ['nephrology','nephro','kidney','كلى'],
  kptx: ['kidney transplant','kidney-tx','kptx','renal transplant','زراعة كلى'],
  liver: ['liver transplant','liver-tx','hepatology transplant','زراعة كبد'],
  adult_cardiology: ['cardiology','adult cardiology','cardio','قلب'],
  medicine: ['medicine','internal medicine','im','باطنية'],
  dental: ['dental','dentistry','oral surgery','أسنان'],
  clinical_lab: ['clinical lab','lab','pathology','clinical laboratory','مختبر'],
  physical_medicine_rehabilitation: ['pmr','physical medicine','rehabilitation','rehab','تأهيل'],
  endocrinology: ['endocrinology','endo','غدد'],
  dermatology: ['dermatology','derm','جلدية'],
  rheumatology: ['rheumatology','rheum','روماتيزم'],
  gastroenterology: ['gastroenterology','gi','gastro','هضمي'],
  pulmonary: ['pulmonary','pulmonology','chest','respiratory','صدرية'],
  infectious: ['infectious disease','id','infectious','infection','معدية'],
};

// Display names for all known specialties (used by matcher and modals)
const SPECIALTY_DISPLAY_NAMES = {
  medicine_on_call: 'Medicine On-Call',
  hospitalist: 'Hospitalist',
  surgery: 'Surgery',
  pediatrics: 'Pediatrics',
  ent: 'ENT',
  orthopedics: 'Orthopedics',
  radiology_oncall: 'Imaging On-Call',
  radiology_duty: 'Imaging On-Duty',
  palliative: 'Palliative',
  neurology: 'Neurology',
  neurosurgery: 'Neurosurgery',
  spine: 'Spine',
  gynecology: 'Gynecology',
  critical_care: 'ICU',
  picu: 'PICU',
  anesthesia: 'Anesthesia',
  psychiatry: 'Psychiatry',
  pediatric_neurology: 'Ped Neuro',
  pediatric_cardiology: 'Ped Cardio',
  pediatric_heme_onc: 'Ped Heme-Onc',
  neuro_ir: 'Neuro IR',
  urology: 'Urology',
  ophthalmology: 'Eye',
  oncology: 'Oncology',
  hematology: 'Heme-Onco',
  radonc: 'Rad-Onc',
  nephrology: 'Nephrology',
  kptx: 'Kidney-Tx',
  liver: 'Liver-Tx',
  adult_cardiology: 'Cardiology',
  medicine: 'Medicine',
  dental: 'Dental',
  clinical_lab: 'Clinical Lab',
  physical_medicine_rehabilitation: 'PMR',
  endocrinology: 'Endocrinology',
  dermatology: 'Dermatology',
  rheumatology: 'Rheumatology',
  gastroenterology: 'GI',
  pulmonary: 'Pulmonary',
  infectious: 'Infectious Disease',
};

/**
 * Smart Specialty Matcher
 * @param {string} input — raw text from user or header detection
 * @returns {{ matched:boolean, key?:string, method?:string, ambiguous?:boolean, candidates?:string[], isNew?:boolean, customName?:string }}
 */
function matchSpecialty(input) {
  if (!input || !input.trim()) return { matched: false, isNew: false };
  const norm = input.toLowerCase().replace(/[^a-z0-9\u0600-\u06FF\s-]/g, '').replace(/\s+/g, ' ').trim();
  if (!norm) return { matched: false, isNew: false };

  // Step 1: Exact match on db keys, display names, tag labels
  for (const [key, displayName] of Object.entries(SPECIALTY_DISPLAY_NAMES)) {
    if (norm === key.replace(/_/g, ' ') || norm === displayName.toLowerCase()) {
      return { matched: true, key, method: 'exact' };
    }
  }

  // Step 2: Alias match
  for (const [key, aliases] of Object.entries(SPECIALTY_ALIASES)) {
    for (const alias of aliases) {
      if (norm === alias.toLowerCase()) {
        return { matched: true, key, method: 'alias' };
      }
    }
  }

  // Step 3: Specificity-aware fuzzy match
  const inputWords = norm.split(/\s+/);
  const hasPedHint = inputWords.some(w => ['ped','pediatric','peds','child','infant','أطفال'].includes(w));

  const candidates = [];
  for (const [key, aliases] of Object.entries(SPECIALTY_ALIASES)) {
    if (!hasPedHint && key.startsWith('pediatric_')) continue;
    if (!hasPedHint && key === 'picu') continue;
    for (const alias of [key.replace(/_/g, ' '), ...aliases]) {
      const aliasWords = alias.toLowerCase().split(/\s+/);
      const allMatch = inputWords.every(iw => aliasWords.some(aw => aw.includes(iw) || iw.includes(aw)));
      if (allMatch) {
        candidates.push({ key, matchLength: aliasWords.length });
        break;
      }
    }
  }

  if (!candidates.length) return { matched: false, isNew: true, customName: input.trim() };
  if (candidates.length === 1) return { matched: true, key: candidates[0].key, method: 'fuzzy' };

  // Specificity tiebreak
  const maxLen = Math.max(...candidates.map(c => c.matchLength));
  const winners = candidates.filter(c => c.matchLength === maxLen);
  if (winners.length === 1) return { matched: true, key: winners[0].key, method: 'fuzzy' };

  return { matched: false, ambiguous: true, candidates: winners.map(w => w.key) };
}

// Expose globals for browser (project uses <script> tags, not ES modules)
if (typeof window !== 'undefined') {
  window.SPECIALTY_ALIASES = SPECIALTY_ALIASES;
  window.SPECIALTY_DISPLAY_NAMES = SPECIALTY_DISPLAY_NAMES;
  window.matchSpecialty = matchSpecialty;
}
// CommonJS for server (monitoring.js)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SPECIALTY_ALIASES, SPECIALTY_DISPLAY_NAMES, matchSpecialty };
}
