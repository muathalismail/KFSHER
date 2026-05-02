// ═══════════════════════════════════════════════════════════════
// upload/pipeline.js — Upload policy, trust, and publication logic
// ═══════════════════════════════════════════════════════════════
// Constants: AUTO_PUBLISH_SPECIALTIES, REVIEW_ONLY_SPECIALTIES,
//            UPLOAD_TRUST_PROFILES, UPLOAD_REASON_CODES,
//            SPECIALTY_PIPELINE_RULES, HARD_REVIEW_ISSUE_TYPES
// Trust: uploadModeForSpecialty, isTrustedAutoPublishSpecialty,
//        hasTrustedUploadParser, getParserTrustProfile
// Validation: countUsableParsedEntries, summarizeUploadPreviewRows,
//             getUploadIssueTypes, findRequiredRoleCoverage,
//             mapValidationReasonCodes, buildUploadPipelineDiagnostics
// Decision: decideUploadPublication, runUploadPolicyChecks
// Normalization: normalizedCoverageType, summarizeNormalizedDateRange,
//               buildNormalizedUploadPayload, normalizedRolesToEntries
// Depends on: core/entry-model.js, core/time.js, core/phone-resolver.js
// ═══════════════════════════════════════════════════════════════

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

const AUTO_PUBLISH_SPECIALTIES = new Set([
  'neurology',
  'surgery',
  'radiology_duty',
  'hospitalist',
  'picu',
  'pediatrics',
  'hematology',
  'orthopedics',
  'urology',
  'dental',
  'gynecology',
  'psychiatry',
  'adult_cardiology',
  'kptx',
  'liver',
  'ent',
  'neurosurgery',
  'spine',
  'palliative',
  'radiology_oncall',
  'medicine_on_call',
  'pediatric_heme_onc',
  'critical_care',
  ...MEDICINE_SUBSPECIALTY_KEYS,
]);

const REVIEW_ONLY_SPECIALTIES = new Set([
  'medicine_on_call',
  'radiology_oncall',
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
    requiredRoles: ['junior', 'senior', 'consultant'],
    autoActivate: true,
  },
  neurology: {
    requiredRoles: ['1st on-call', '2nd on-call', 'consultant'],
    autoActivate: true,
  },
  hospitalist: {
    requiredRoles: ['oncology er'],
    autoActivate: true,
  },
  picu: {
    requiredRoles: ['resident 24h', 'after-hours', 'consultant'],
    autoActivate: true,
  },
  radiology_duty: {
    requiredRoles: ['ct', 'ultrasound'],
    autoActivate: true,
  },
  radiology_oncall: {
    requiredRoles: ['on-call'],
    autoActivate: true,
  },
  medicine_on_call: {
    requiredRoles: ['junior er', 'senior er'],
    autoActivate: true,
  },
  pediatrics: {
    requiredRoles: ['1st on-call', '2nd on-call', 'hospitalist'],
    autoActivate: true,
  },
  hematology: {
    requiredRoles: ['fellow on-call', 'consultant on-call', 'er'],
    autoActivate: true,
  },
  orthopedics: {
    requiredRoles: ['resident', '2nd on-call', 'consultant'],
    autoActivate: true,
  },
  kptx: {
    requiredRoles: ['1st on-call', 'consultant on-call'],
    autoActivate: true,
  },
  liver: {
    requiredRoles: ['day coverage', '2nd on-call', 'consultant on call'],
    autoActivate: true,
  },
  ent: {
    requiredRoles: ['1st on-call', '2nd on-call', 'consultant'],
    autoActivate: true,
  },
  neurosurgery: {
    requiredRoles: ['resident', 'consultant'],
    autoActivate: true,
  },
  spine: {
    requiredRoles: ['resident', 'consultant'],
    autoActivate: true,
  },
  palliative: {
    requiredRoles: ['1st on-call', 'consultant'],
    autoActivate: true,
  },
  dental: {
    requiredRoles: [],
    autoActivate: true,
  },
  gynecology: {
    requiredRoles: [],
    autoActivate: true,
  },
  critical_care: {
    requiredRoles: [],
    autoActivate: true,
  },
  urology: {
    requiredRoles: [],
    autoActivate: true,
  },
  pediatric_heme_onc: {
    requiredRoles: ['on-duty', 'consultant'],
    autoActivate: true,
  },
  dermatology: {
    requiredRoles: ['on-call'],
    autoActivate: true,
  },
  infectious: {
    requiredRoles: ['fellow', 'consultant'],
    autoActivate: true,
  },
  oncology: {
    autoActivate: true,
  },
};

// uploadedPdfRecords → now in store/memory-cache.js (loaded as global)
// uploadedSpecialtiesReadyPromise, radiologyDutyTrace → defined in app.js
// MEDICINE_SUBSPECIALTY_KEYS, isMedicineSubspecialty → now in core/entry-model.js

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
  if (deptKey === 'radiology_duty') return parserMode === 'specialized' || !!parseDebug.templateDetected;
  if (deptKey === 'surgery') return parserMode === 'specialized' && !!parseDebug.templateDetected;
  if (deptKey === 'hospitalist') return parserMode === 'specialized' && !!parseDebug.templateDetected;
  if (deptKey === 'neurology') return parserMode === 'specialized' && !!parseDebug.templateDetected;
  if (deptKey === 'picu') return parserMode === 'specialized' && !!parseDebug.templateDetected;
  if (deptKey === 'pediatrics') return parserMode === 'specialized' && !!parseDebug.templateDetected;
  if (deptKey === 'hematology') return parserMode === 'specialized' && !!parseDebug.templateDetected;
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
  if (['surgery', 'hospitalist', 'neurology'].includes(deptKey) && !templateDetected) {
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
  if (issueTypes.has('missing-consultant') && !['medicine_on_call', 'pediatrics'].includes(deptKey)) {
    trustScore -= 18;
    riskReasons.push('Previously known consultant names disappeared');
  } else if (issueTypes.has('missing-consultant') && ['medicine_on_call', 'pediatrics'].includes(deptKey)) {
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

  const hasAutoActivate = !!(SPECIALTY_PIPELINE_RULES[deptKey] && SPECIALTY_PIPELINE_RULES[deptKey].autoActivate);
  // PDF-view-only specialties (image PDFs) skip all validation
  const isPdfViewOnly = deptKey === 'critical_care' || deptKey === 'oncology';
  if (!(normalizedPayload?.roles || []).length && !isPdfViewOnly && !hasAutoActivate) {
    reasonCodes.add(UPLOAD_REASON_CODES.NO_DOCTOR_ROWS_FOUND);
  }
  if (
    (!auditResult?.publishable && !(deptKey === 'medicine_on_call' && medicineStructurallyUsable) && !hasAutoActivate)
    || (issueTypes.has('uncertain-specialty') && !(deptKey === 'medicine_on_call' && medicineStructurallyUsable) && !hasAutoActivate)
  ) {
    reasonCodes.add(UPLOAD_REASON_CODES.FAILED_SPECIALTY_VALIDATION);
  }
  if ((auditResult?.overallConfidence === 'low' || trustProfile.trustScore < 60) && !(deptKey === 'medicine_on_call' && medicineStructurallyUsable) && !hasAutoActivate) {
    reasonCodes.add(UPLOAD_REASON_CODES.LOW_PARSE_CONFIDENCE);
  }
  if ((issueTypes.has('row-mapping') || issueTypes.has('data-loss')) && !hasAutoActivate) {
    reasonCodes.add(UPLOAD_REASON_CODES.BLOCK_DATE_MISMATCH);
  }
  if (requiredRoles.missing.length) {
    reasonCodes.add(UPLOAD_REASON_CODES.MISSING_REQUIRED_ROLE);
  }
  if (issueTypes.has('all-missing-phones') || issueTypes.has('weak-phone-match')) {
    reasonCodes.add(UPLOAD_REASON_CODES.PHONE_BINDING_INCOMPLETE);
  }
  if (
    (parseDebug?.parserMode === 'generic'
    || parseDebug?.parserMode === 'generic-fallback'
    || issueTypes.has('merged-names')
    || issueTypes.has('template-sections-missing'))
    && !hasAutoActivate
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
  // Default: auto-activate all specialties. Unknown specialties publish without
  // required role checks — sustainable for future uploads without code changes.
  const profile = SPECIALTY_PIPELINE_RULES[deptKey]
    || { autoActivate: true, requiredRoles: [] };
  const isPdfViewOnly = deptKey === 'critical_care' || deptKey === 'oncology';
  const medicineCurrentResolution = deptKey === 'medicine_on_call'
    ? isMedicineOnCallCurrentResolutionUsable(normalizedPayload, now)
    : null;
  const medicineUsableNow = !!(medicineCurrentResolution && medicineCurrentResolution.ok);
  const validationPassed = !!auditResult?.approved;
  const radiologyDutyUsableNow = deptKey === 'radiology_duty'
    && validationPassed
    && ((normalizedPayload?.roles || []).length > 0);
  const publishable = !!auditResult?.publishable
    || (deptKey === 'medicine_on_call' && validationPassed && medicineUsableNow)
    || radiologyDutyUsableNow;
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
  const activationBlockingCodes = deptKey === 'radiology_duty'
    ? [
      UPLOAD_REASON_CODES.NO_DOCTOR_ROWS_FOUND,
      UPLOAD_REASON_CODES.BLOCK_DATE_MISMATCH,
      UPLOAD_REASON_CODES.FAILED_SPECIALTY_VALIDATION,
    ]
    : [
      UPLOAD_REASON_CODES.NO_DOCTOR_ROWS_FOUND,
      UPLOAD_REASON_CODES.BLOCK_DATE_MISMATCH,
      UPLOAD_REASON_CODES.FAILED_SPECIALTY_VALIDATION,
      UPLOAD_REASON_CODES.AMBIGUOUS_LAYOUT,
      UPLOAD_REASON_CODES.MISSING_REQUIRED_ROLE,
    ];
  const eligibleForActivation = isPdfViewOnly
    || (validationPassed
    && publishable
    && profile.autoActivate
    && !validation.reasonCodes.some(code => activationBlockingCodes.includes(code)));
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
