// ═══════════════════════════════════════════════════════════════
// parsers/radiology.js — Radiology Duty PDF parser
// ═══════════════════════════════════════════════════════════════
// Depends on: core/phone-resolver.js, parsers/generic.js
// ═══════════════════════════════════════════════════════════════

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
    fellow: ['M. Faifi', 'N. Alkhatib', 'N. Makhaita'],
    consultant: ['Dr. Abdullah Al Suwailem'],
    pediatric: ['Dr. Rasees Al Otaibi'],
  },
  'CT - Neuro': {
    consultant: ['Dr. Husam Al Muhaish', 'Dr. Husain Al Arfaj', 'Dr. Fadhel AlMolani', 'Dr. Abdullah Al Suwailem'],
  },
  'CT (In-Patient & ER)': {
    consultant: ['Dr. Khalid Balawi', 'Dr. Safaa Mahmoud', 'Dr. Hana Aboras', 'Dr. Eman Al Momen', 'Dr. Fajer Bosaid', 'Dr. Abdulrahman AlAbdulgader'],
    resident: ['Sokaina Al Khuder', 'Mohammed Al Anaki', 'Bayan Al Kaby', 'F. Alkhabaz'],
  },
  'Thoracic CT/MRI (In-Pt & ER)': {
    consultant: ['Dr. Ahmed Al Dhafiri', 'Dr. Huda Ismail'],
    fellow: ['Fatimah Albahhar', 'Mohammed Al Ibrahim'],
  },
  'Body Ultrasound': {
    consultant: ['Dr. Mawaheb Kalalah', 'Dr. Adel Mohammed', 'Dr. Tarek Saied', 'Dr. Safaa Mahmoud'],
    fellow: ['Ibtihal S'],
  },
  'Breast In Pt. & Emergency': {
    consultant: ['Dr. Rawan Al Namasy', 'Dr. Salma Al Enezi', 'Dr. Sarah AlArifi'],
    fellow: ['F. Alsaad', 'M. Alshahrani'],
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

  let best = null;
  contacts.forEach(contactName => {
    const match = scoreNameMatch(expanded, contactName) || scoreNameMatch(pretty, contactName);
    if (!match) return;
    if (!best || match.score > best.score) best = { ...match, name: contactName };
  });

  if (best && best.score >= 8) {
    return { name: best.name, confidence: best.uncertain ? 'medium' : 'high', matched:true };
  }
  if (contacts.some(contact => canonicalName(contact) === canonicalName(expanded))) {
    return { name: contacts.find(contact => canonicalName(contact) === canonicalName(expanded)), confidence:'high', matched:true };
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
  const essentialSections = new Set(['CT - Neuro', 'CT (In-Patient & ER)', 'Body Ultrasound', 'Ultrasound - MSK', 'Thoracic CT/MRI (In-Pt & ER)']);
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
      section: 'CT (In-Patient & ER)',
      role: 'Consultant',
      start: /BODY REFERRAL/i,
      end: [/THORACIC REFERRAL/i, /MSK REFERRAL/i],
      aliases: ['K.balawi', 'S.mahmoud', 'H.Aboras', 'E.momen', 'F.Bosaid', 'A.abdulqader'],
    },
    {
      section: 'CT (In-Patient & ER)',
      role: 'Resident',
      start: /BODY REFERRAL/i,
      end: [/THORACIC REFERRAL/i, /MSK REFERRAL/i],
      aliases: ['Sokaina Al Khuder', 'Mohammed Al Anaki', 'Bayan Al Kaby', 'F. Alkhabaz'],
      fallbackToWholeText: true,
    },
    {
      section: 'Body Ultrasound',
      role: 'Consultant',
      start: /Ultrasound \(Consultant\)/i,
      end: [/BODY REFERRAL/i, /THORACIC REFERRAL/i],
      aliases: ['M. Mawaheb Khalalah', 'Mawahib Khalalah', 'T. Saied', 'A. Mohammed', 'S.mahmoud'],
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
      section: 'Thoracic CT/MRI (In-Pt & ER)',
      role: 'Consultant',
      start: /THORACIC REFERRAL/i,
      end: [/MSK REFERRAL/i, /NUCLEAR/i, /PET-CT/i],
      aliases: ['A. Dhafiri', 'H. Ismail'],
      fallbackToWholeText: true,
    },
    {
      section: 'Thoracic CT/MRI (In-Pt & ER)',
      role: 'Fellow / Assistant',
      start: /THORACIC REFERRAL/i,
      end: [/MSK REFERRAL/i, /NUCLEAR/i, /PET-CT/i],
      aliases: ['Mohammed Al Ibrahim', 'Fatimah Buqais'],
      fallbackToWholeText: true,
    },
    {
      section: 'Thoracic CT/MRI (In-Pt & ER)',
      role: 'Fellow / Assistant',
      start: /THORACIC REFERRAL/i,
      end: [/MSK REFERRAL/i, /NUCLEAR/i, /PET-CT/i],
      aliases: ['Fatimah Albahhar'],
      fallbackToWholeText: true,
    },
    {
      section: 'Breast In Pt. & Emergency',
      role: 'Consultant',
      start: /Breast/i,
      end: [/MSK REFERRAL/i, /NUCLEAR/i, /PET-CT/i],
      aliases: ['R. Namasy', 'S. Enezi', 'Sarah AlArifi'],
      fallbackToWholeText: true,
    },
    {
      section: 'Breast In Pt. & Emergency',
      role: 'Fellow / Assistant',
      start: /Breast/i,
      end: [/MSK REFERRAL/i, /NUCLEAR/i, /PET-CT/i],
      aliases: ['F. Alsaad', 'M. Alshahrani'],
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
    const entries = hasLegacyRadiologyDutyEntries(record.entries || [])
      ? normalizeParsedEntries(
        splitMultiDoctorEntries(parseRadiologyDutyPdfEntries(record.rawText, 'radiology_duty'), 'radiology_duty')
      )
      : (Array.isArray(record.entries) ? record.entries : []);
    if (!entries.length) return record;
    const normalizedPayload = buildNormalizedUploadPayload({
      deptKey: 'radiology_duty',
      fileName: record.name || '',
      entries,
      parseDebug: record.diagnostics || record.debug || {},
      rawText: record.rawText || '',
    });
    const publishDecision = decideUploadPublication({
      deptKey: 'radiology_duty',
      parseDebug: record.diagnostics || record.debug || {},
      auditResult: {
        overallConfidence: record.audit?.overallConfidence || 'medium',
        approved: record.audit?.approved !== false,
        publishable: record.audit?.publishable !== false,
        issues: Array.isArray(record.audit?.issues) ? record.audit.issues : [],
      },
      entries,
      normalizedPayload,
      fileName: record.name || '',
      rawText: record.rawText || '',
    });
    if (!publishDecision.publishToLive) {
      if (entries === record.entries) return record;
      return {
        ...record,
        entries,
        normalized: normalizedPayload,
        diagnostics: publishDecision.diagnostics,
      };
    }
    return {
      ...record,
      entries,
      isActive: true,
      parsedActive: true,
      normalized: normalizedPayload,
      diagnostics: publishDecision.diagnostics,
      audit: {
        ...(record.audit || {}),
        publishable: true,
        livePublished: true,
      },
      review: {
        ...(record.review || {}),
        parsing: false,
        auditRejected: false,
        pendingUploadReview: false,
        reviewOnly: false,
        reviewReason: '',
      },
    };
  }
  if (record.deptKey === 'medicine_on_call') {
    // Do NOT re-parse if the record was from server/LLM extraction —
    // client-side re-parsing produces wrong names (Lama Alshehri instead of Almubarak)
    // because it lacks the LLM context and server contacts.
    // Only return the record as-is with display overrides applied at render time.
    return record;
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

