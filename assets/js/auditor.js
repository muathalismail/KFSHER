// ═══════════════════════════════════════════════════════════════
// AUDITOR / VALIDATION LAYER
// ═══════════════════════════════════════════════════════════════
// Runs after every PDF parse. Does NOT trust raw parsed output.
// Checks logical completeness, not just syntax.
// All validation happens before a record is made active/searchable.
//
// API used by the upload pipeline:
//   const auditResult = await Auditor.auditParsedRecord(record, oldRecord);
//   if (!auditResult.approved) → do not activate; push to review queue
//
// Standalone review panel: Auditor.renderReviewPanel()
// Runs on-demand and on startup to audit all stored records.
// ═══════════════════════════════════════════════════════════════

const Auditor = (() => {

  // ── REVIEW QUEUE (in-memory, shown in review panel) ──────────
  // Each item: { id, specialty, fileName, issueType, severity, explanation, affectedRows, ts }
  const _queue = [];
  let _queueIdCounter = 0;
  const _goldenResults = new Map();

  function _push(item) {
    const id = ++_queueIdCounter;
    _queue.unshift({ id, ts: Date.now(), ...item });
    if (_queue.length > 200) _queue.pop(); // cap
    _renderQueueBadge();
    return id;
  }

  function _clearForFile(fileName) {
    const before = _queue.length;
    const idx = [];
    _queue.forEach((item, i) => { if (item.fileName === fileName) idx.push(i); });
    for (let i = idx.length - 1; i >= 0; i--) _queue.splice(idx[i], 1);
    if (_queue.length !== before) _renderQueueBadge();
  }

  function _clearByPredicate(predicate) {
    const before = _queue.length;
    for (let i = _queue.length - 1; i >= 0; i--) {
      if (predicate(_queue[i])) _queue.splice(i, 1);
    }
    if (_queue.length !== before) _renderQueueBadge();
  }

  function _renderQueueBadge() {
    const badge = document.getElementById('auditor-badge');
    if (!badge) return;
    const errors = _queue.filter(i => i.severity === 'error').length;
    const warns  = _queue.filter(i => i.severity === 'warn').length;
    badge.textContent = errors + warns > 0 ? `${errors + warns}` : '';
    badge.style.display = errors + warns > 0 ? '' : 'none';
    badge.style.background = errors > 0 ? 'var(--red,#ff5252)' : 'var(--amber,#ffab40)';
  }

  function _summarizeRow(entry={}) {
    const bits = [
      entry.name || 'Unknown doctor',
      entry.role || 'No role',
      entry.phone ? `#${entry.phone}` : '',
      entry.date || '',
    ].filter(Boolean);
    return bits.join(' · ');
  }

  function _isRadiologyDutyTemplate(sourceText='') {
    const markers = [
      /NEURO REFERRAL/i,
      /BODY REFERRAL/i,
      /SECTION SPECIALTY/i,
      /WEEKLY DUTY ROTA/i,
      /Ultrasound \(Consultant\)/i,
    ];
    return markers.filter(re => re.test(sourceText || '')).length >= 4;
  }

  function _checkRadiologyDutyTemplateCoverage(entries=[], sourceText='') {
    if (!_isRadiologyDutyTemplate(sourceText)) return [];
    const essential = ['CT - Neuro', 'CT - General', 'Ultrasound - Abdomen', 'Ultrasound - MSK', 'X-Ray / General'];
    const sections = new Set(entries.filter(_hasUsableDoctorRow).map(entry => entry.section).filter(Boolean));
    const missing = essential.filter(section => !sections.has(section));
    if (!missing.length) return [];
    return [{
      severity: 'error',
      issueType: 'template-sections-missing',
      explanation: `Radiology Duty template detected, but essential sections were not extracted: ${missing.join(', ')}.`,
      affectedRows: entries.slice(0, 5).map(_summarizeRow),
    }];
  }

  function _isRadiologySpecialty(deptKey='') {
    return deptKey === 'radiology_duty' || deptKey === 'radiology_oncall';
  }

  const HARD_BLOCK_ISSUE_TYPES = new Set([
    'empty-pdf',
    'no-rows',
    'zero-usable-rows',
    'obvious-names-missed',
    'row-mapping',
    'template-sections-missing',
    'radiology-no-sections',
    'radiology-no-doctors',
    'radiology-empty-section',
  ]);

  function _isHardBlockIssue(issue={}) {
    return HARD_BLOCK_ISSUE_TYPES.has(issue.issueType || '');
  }

  function _applyDeptAuditState(deptKey, { verified=true, hardBlocked=false, source='' } = {}) {
    if (!ROTAS[deptKey]) return;
    ROTAS[deptKey].verified = !!verified;
    ROTAS[deptKey].auditBlocked = !!hardBlocked;
    ROTAS[deptKey].auditSource = source || '';
  }

  function _checkRadiologySectionMapping(entries=[], deptKey='') {
    if (!entries.length) {
      return [{
        severity: 'error',
        issueType: 'radiology-no-sections',
        explanation: 'Radiology parsing produced no structured rows.',
        affectedRows: [],
      }];
    }

    const usable = entries.filter(_hasUsableDoctorRow);
    if (!usable.length) {
      return [{
        severity: 'error',
        issueType: 'radiology-no-doctors',
        explanation: 'Radiology rows were extracted but no usable doctors were mapped to sections.',
        affectedRows: entries.slice(0, 5).map(_summarizeRow),
      }];
    }

    if (deptKey === 'radiology_oncall') {
      return [];
    }

    const bySection = new Map();
    usable.forEach(entry => {
      const section = (entry.section || '').trim();
      if (!section) return;
      if (!bySection.has(section)) bySection.set(section, []);
      bySection.get(section).push(entry);
    });

    if (!bySection.size) {
      return [{
        severity: 'error',
        issueType: 'radiology-no-sections',
        explanation: 'Radiology doctor rows were found, but none were mapped to a named section.',
        affectedRows: usable.slice(0, 5).map(_summarizeRow),
      }];
    }

    const emptySections = [...bySection.entries()]
      .filter(([, rows]) => !rows.some(row => canonicalName(row.name || '')))
      .map(([section]) => section);
    if (emptySections.length) {
      return [{
        severity: 'error',
        issueType: 'radiology-empty-section',
        explanation: `Radiology section(s) were detected without doctor mapping: ${emptySections.join(', ')}.`,
        affectedRows: emptySections,
      }];
    }

    return [];
  }

  const GOLDEN_TESTS = [
    {
      id: 'ent_0804',
      specialty: 'ent',
      dateKey: '08/04',
      requiredTiers: ['1st', '2nd', 'consultant'],
      expectedRows: [
        { name: 'Malak Alamoudi', roleIncludes: '1st On-Call', phone: '0566750002' },
        { name: 'Dinah Alnoaimi', roleIncludes: '2nd On-Call', phone: '0568449906' },
        { name: 'Dr. Bshair Aldriweesh', roleIncludes: 'Consultant', phone: '0506853000' },
      ],
    },
    {
      id: 'surgery_0804',
      specialty: 'surgery',
      dateKey: '08/04',
      requiredTiers: ['1st', '2nd', 'associate', 'consultant'],
      expectedRows: [
        { name: 'Dr. Haidar AlNahwai', roleIncludes: '1st On-Call', phone: '0546396981' },
        { name: 'Dr. Hamidah Abdullah', roleIncludes: '2nd On-Call', phone: '0505556322' },
        { name: 'Dr. Awrad Nasralla', roleIncludes: 'Associate', phone: '0535366396' },
        { name: 'Dr. Ahmed Zidan', roleIncludes: 'Consultant', phone: '0567964034' },
      ],
    },
    {
      id: 'picu_0804',
      specialty: 'picu',
      dateKey: '08/04',
      requiredTiers: ['resident', 'assistant', 'consultant'],
      expectedRows: [
        { name: 'Dr. Marah', roleIncludes: 'Resident — Day Shift' },
        { name: 'Dr. Ghadeer', roleIncludes: 'Resident — Day Shift' },
        { name: 'Dr. Abbas', roleIncludes: 'Assistant 1st' },
        { name: 'Dr. Ayman', roleIncludes: 'Assistant 2nd', phone: '0501414849' },
        { name: 'Dr. Marwan', roleIncludes: 'Resident 24h' },
        { name: 'Dr. Hoda', roleIncludes: 'After-Hours' },
        { name: 'Dr. A. Wahab', roleIncludes: 'Consultant On-Call 24h', phone: '0504150451' },
      ],
    },
    {
      id: 'ophthalmology_0804',
      specialty: 'ophthalmology',
      dateKey: '08/04',
      requiredTiers: ['1st', 'consultant'],
      expectedRows: [
        { name: 'Dr. Hussam Aboullo', roleIncludes: '1st', phone: '0551702651' },
        { name: 'Dr. Jamal Al Humam', roleIncludes: 'Consultant', phone: '0505823378' },
      ],
    },
    {
      id: 'kptx_0804',
      specialty: 'kptx',
      dateKey: '08/04',
      requiredTiers: ['1st', 'consultant'],
      expectedRows: [
        { name: 'Ali', roleIncludes: 'Day Coverage', phone: '0550789096' },
        { name: 'Abdullah', roleIncludes: 'Day Coverage', phone: '0554291442' },
        { name: 'Zahra', roleIncludes: '1st On-Call', phone: '0532592591' },
        { name: 'Dr. Khalid Akkari', roleIncludes: 'Consultant', phone: '0599932293' },
      ],
    },
    {
      id: 'palliative_0704',
      specialty: 'palliative',
      dateKey: '07/04',
      requiredTiers: ['1st', '2nd', 'consultant'],
      expectedRows: [
        { name: 'Dr. Yasmeen Almansour', roleIncludes: '1st', phone: '0556194213' },
        { name: 'Dr. Malak', roleIncludes: '2nd' },
        { name: 'Dr. Haneen Al Nweider', roleIncludes: 'Consultant', phone: '0569208448' },
      ],
    },
    {
      id: 'dermatology_0804',
      specialty: 'dermatology',
      dateKey: '08/04',
      requiredTiers: ['resident', '2nd'],
      expectedRows: [
        { name: 'Dr. Alzahraa Al Ahmad', roleIncludes: 'Resident', phone: '0550981362' },
        { name: 'Dr. Gamil Mohammed', roleIncludes: '2nd On-Call', phone: '0552559807' },
      ],
    },
    {
      id: 'infectious_0804',
      specialty: 'infectious',
      dateKey: '08/04',
      requiredTiers: ['fellow', 'consultant'],
      expectedRows: [
        { name: 'Dr. Amal Al Suliman', roleIncludes: 'Fellow', phone: '0530733361' },
        { name: 'Dr. Z. AlKhalifah', roleIncludes: 'Consultant', phone: '0567727188' },
        { name: 'Dr. Yamama Al-Jishi', roleIncludes: 'Consultant', phone: '0504824956' },
      ],
    },
    {
      id: 'pediatrics_0804',
      specialty: 'pediatrics',
      dateKey: '08/04',
      requiredTiers: ['1st', '2nd'],
      expectedRows: [
        { name: 'Lamia Alzahrani', roleIncludes: '1st On-Call' },
        { name: 'Albandari Alzahed', roleIncludes: '2nd On-Call' },
        { name: 'Dr. Abdulrahim Abdullahi', roleIncludes: 'Hospitalist ER', phone: '0554762721' },
        { name: 'Dr. Abdalazeem Hamad', roleIncludes: 'KFSH ER', phone: '0552831081' },
      ],
    },
    {
      id: 'radiology_oncall_0804',
      specialty: 'radiology_oncall',
      dateKey: '08/04',
      requiredTiers: ['1st', '2nd', 'consultant'],
      mode: 'radiology_oncall',
      expectedRows: [
        { name: 'Mohammed Al Ibrahim', roleIncludes: '1st On-Call', phone: '0508063629' },
        { name: 'Sokaina Al Khuder', roleIncludes: '2nd On-Call', phone: '0562058856' },
        { name: 'Dr. Mawaheb Kalalah', roleIncludes: '3rd', phone: '0500015528' },
      ],
    },
    {
      id: 'radiology_duty_ct_0804',
      specialty: 'radiology_duty',
      mode: 'radiology_duty',
      query: 'ct neuro',
      at: '2026-04-08T10:00:00+03:00',
      expectedRows: [
        { name: 'Dr. Husain Al Arfaj', roleIncludes: 'On-Duty', phone: '0553004187' },
      ],
    },
  ];

  function _sameName(a='', b='') {
    return canonicalName(a) === canonicalName(b);
  }

  function _findGoldenRow(actualRows, expected) {
    return actualRows.find(row => {
      if (!_sameName(row.name || '', expected.name || '')) return false;
      const role = row.role || '';
      return !expected.roleIncludes || role.toLowerCase().includes(expected.roleIncludes.toLowerCase());
    }) || null;
  }

  function _extractGoldenRows(test) {
    if (test.mode === 'radiology_oncall') {
      return sortEntries(getRadiologyOnCallEntriesForDate(test.dateKey));
    }
    if (test.mode === 'radiology_duty') {
      const uploaded = uploadedRecordForDept(test.specialty);
      if (uploaded && uploaded.parsedActive && Array.isArray(uploaded.entries) && uploaded.entries.length) {
        return sortEntries(uploaded.entries.map(entry => ({ ...entry })));
      }
      return sortEntries(getEntries('radiology_duty', ROTAS.radiology_duty, test.dateKey || '', new Date(test.at), ''));
    }
    const uploaded = uploadedRecordForDept(test.specialty);
    if (uploaded && uploaded.parsedActive && Array.isArray(uploaded.entries)) {
      const rows = uploaded.entries.filter(entry => !entry.date || entry.date === test.dateKey || entry.date === 'dynamic-weekday');
      return sortEntries(rows.map(entry => ({ ...entry })));
    }
    const dept = ROTAS[test.specialty];
    if (!dept) return [];
    const rows = (dept.schedule && dept.schedule[test.dateKey]) || [];
    return sortEntries(rows.map(entry => ({ ...entry })));
  }

  function _runRadiologyDutyGoldenCheck(actualRows=[]) {
    const failures = [];
    const sectionIssues = _checkRadiologySectionMapping(actualRows);
    const essential = ['CT - Neuro', 'CT - General', 'Ultrasound - Abdomen', 'Ultrasound - MSK', 'X-Ray / General'];
    const sections = new Set(actualRows.filter(_hasUsableDoctorRow).map(row => (row.section || '').trim()).filter(Boolean));
    const missing = essential.filter(section => !sections.has(section));
    if (sectionIssues.length) {
      failures.push(...sectionIssues.map(issue => issue.explanation));
    }
    if (missing.length) {
      failures.push(`Missing radiology duty sections: ${missing.join(', ')}`);
    }
    return failures;
  }

  const BUG_REGRESSION_FIXTURES = {
    surgery_consultant_phone_parser: {
      type: 'mock-parser-fixture',
      text: '05 52 95871\nDr. Thabet Al-Ghazal Consultant',
      expected: { name: 'Dr. Thabet Al-Ghazal', phone: '0552958971' },
    },
    surgery_senior_alias_phone_resolution: {
      type: 'mock-structured-fixture',
      alias: 'AlMusianed',
      expectedName: 'Dr. Mohammed AlMusained',
      expectedPhone: '0591797444',
    },
    pediatrics_role_behavior_1004: {
      type: 'mock-structured-fixture',
      morningAt: '2026-04-10T10:00:00+03:00',
      eveningAt: '2026-04-10T20:00:00+03:00',
      dateKey: '10/04',
      expectedMorning: ['Dr. Abdalazeem Hamad', 'Othman Alessa'],
      expectedEvening: ['Hawraa Alshakhs', 'Othman Alessa'],
      forbidden: ['Dr. Khulood Al Thobaiti'],
    },
    pediatrics_includes_kfsh_er_hospitalist: {
      type: 'mock-structured-fixture',
      morningAt: '2026-04-10T10:00:00+03:00',
      eveningAt: '2026-04-10T20:00:00+03:00',
      dateKey: '10/04',
      expectedName: 'Dr. Abdalazeem Hamad',
      expectedRole: 'KFSH ER Hospitalist',
      expectedPhone: '0552831081',
    },
    pediatrics_page3_phone_reconciliation: {
      type: 'mock-parser-fixture',
      text: `DOCTORS’ NAME ID# MOBILE # OFFICE# Residents MOBILE
Dr. Abdalazeem Hamad 51592172 0552831081 6319
Hawraa Alshakhs 500869452
Othman Alessa 568916700`,
      expected: [
        { name: 'Dr. Abdalazeem Hamad', phone: '0552831081' },
        { name: 'Hawraa Alshakhs', phone: '0500869452' },
        { name: 'Othman Alessa', phone: '0568916700' },
      ],
    },
    pediatrics_third_oncall_empty_when_unassigned: {
      type: 'mock-structured-fixture',
      dateKey: '10/04',
      at: '2026-04-10T20:00:00+03:00',
      forbiddenRole: '3rd On-Call',
    },
    picu_structured_parser_1104: {
      type: 'mock-parser-fixture',
      line: 'Sat 11/04/2026 Dr.Ghadeer Dr.Alaa Dr.Ayman Dr.Ghadeer Dr.Mohamed Dr.A.wahab Dr. Hoda Abdelhamid 51618655 0597911953 3031',
      dateKey: '11/04',
      expectedRows: [
        { name: 'Dr. Ghadeer', role: 'Resident — Day Shift' },
        { name: 'Dr. Alaa', role: 'Assistant 1st — Day Shift' },
        { name: 'Dr. Ali', role: 'Assistant 2nd — Day Shift' },
        { name: 'Dr. Ghadeer', role: 'Resident 24h' },
        { name: 'Dr. Mohamed', role: 'After-Hours On-Call' },
        { name: 'Dr. A. Wahab', role: 'Consultant On-Call 24h', phone: '0504150451' },
      ],
      forbiddenNames: ['Dr. Hoda Abdelhamid'],
    },
    picu_current_time_behavior: {
      type: 'mock-structured-fixture',
      dateKey: '11/04',
      morningAt: '2026-04-11T10:00:00+03:00',
      eveningAt: '2026-04-11T17:00:00+03:00',
      expectedMorning: [
        { name: 'Dr. Ghadeer', role: 'Resident — Day Shift' },
        { name: 'Dr. Alaa', role: 'Assistant 1st — Day Shift' },
        { name: 'Dr. Ali', role: 'Assistant 2nd — Day Shift' },
        { name: 'Dr. Ghadeer', role: 'Resident 24h' },
        { name: 'Dr. A. Wahab', role: 'Consultant On-Call 24h', phone: '0504150451' },
      ],
      expectedEvening: [
        { name: 'Dr. Ghadeer', role: 'Resident 24h' },
        { name: 'Dr. Mohamed', role: 'After-Hours On-Call', phone: '0544473530' },
        { name: 'Dr. A. Wahab', role: 'Consultant On-Call 24h', phone: '0504150451' },
      ],
      forbiddenEvening: [
        'Resident — Day Shift',
        'Assistant 1st — Day Shift',
        'Assistant 2nd — Day Shift',
      ],
    },
    picu_phone_binding_and_confidence: {
      type: 'mock-structured-fixture',
      dateKey: '11/04',
      at: '2026-04-11T17:00:00+03:00',
      expectedRows: [
        { name: 'Dr. Ghadeer', role: 'Resident 24h' },
        { name: 'Dr. Mohamed', role: 'After-Hours On-Call', phone: '0544473530' },
        { name: 'Dr. A. Wahab', role: 'Consultant On-Call 24h', phone: '0504150451' },
      ],
    },
    non_picu_medicine_on_call_unchanged: {
      type: 'mock-structured-fixture',
      specialty: 'medicine_on_call',
      dateKey: '01/04',
      at: '2026-04-01T10:00:00+03:00',
      expectedRows: [
        { name: 'Dr. Mohammed Hadadd', role: 'Junior ER', phone: '0549095077' },
        { name: 'Dr. Ali Ayman Bazroon', role: 'Senior ER', phone: '0546488997' },
      ],
    },
    radiology_weekend_banner_text: {
      type: 'mock-ui-fixture',
      fridayAt: '2026-04-10T10:00:00+03:00',
      sundayAt: '2026-04-12T17:00:00+03:00',
      expectedWeekendTime: '07:30 – 07:30',
      expectedWeekdayTime: '16:30 – 07:30',
    },
    radiology_weekend_0730_0730_rule: {
      type: 'mock-rule-fixture',
      fridayAt: '2026-04-10T10:00:00+03:00',
      saturdayAt: '2026-04-11T23:30:00+03:00',
      expectedTime: '07:30-07:30',
    },
    liver_daytime_active_coverage_0904: {
      type: 'mock-structured-fixture',
      dateKey: '09/04',
      at: '2026-04-09T10:00:00+03:00',
      expected: ['May Magdy', 'Dr. Attalaah'],
    },
    hematology_second_oncall_resolution_0904: {
      type: 'mock-structured-fixture',
      dateKey: '09/04',
      at: '2026-04-09T10:00:00+03:00',
      expectedName: 'Dr. Reem Alsudairi',
      expectedRole: '2nd On-Call',
    },
    pdf_search_removed_if_not_standard: {
      type: 'mock-ui-fixture',
      forbiddenIds: ['pdfSearchInput', 'pdfSearchBtn', 'pdfSearchStatus', 'pdfSearchResults'],
    },
    gyne_amna_phone_exists: {
      type: 'mock-structured-fixture',
      dateKey: '10/04',
      expectedName: 'Amnah',
      expectedPhone: '0531524143',
    },
    psychiatry_amro_phone_exists: {
      type: 'mock-structured-fixture',
      dateKey: '10/04',
      expectedName: 'Amro',
      expectedPhone: '0535971741',
    },
    neurosurgery_laila_and_mazen_present: {
      type: 'mock-structured-fixture',
      dateKey: '11/04',
      at: '2026-04-11T20:00:00+03:00',
      expectedRows: [
        { name: 'Dr. Laila Batarfi', roleIncludes: 'second on-call' },
        { name: 'Dr. Mazen Al Otaibi', roleIncludes: 'consultant' },
      ],
    },
    liver_before_9pm_smor_active: {
      type: 'mock-structured-fixture',
      dateKey: '11/04',
      at: '2026-04-11T20:00:00+03:00',
      mustInclude: ['Dr. Mujtaba Almishqab', 'Noora'],
      mustExclude: ['Dr. Naseer Alenezi', 'May Magdy', 'Dr. Attalaah', 'May'],
      expectedRole: 'SMROD',
    },
    kptx_consultant_khalid_present: {
      type: 'mock-structured-fixture',
      dateKey: '10/04',
      at: '2026-04-10T10:00:00+03:00',
      expectedName: 'Dr. Khalid B. Akkari',
      expectedRole: 'consultant',
      expectedPhone: '0599932293',
    },
    liver_smrod_ordering_before_9pm: {
      type: 'mock-structured-fixture',
      dateKey: '11/04',
      at: '2026-04-11T20:00:00+03:00',
      firstName: 'Dr. Mujtaba Almishqab',
      firstRole: 'SMROD',
      mustExclude: ['May', 'May Magdy', 'Dr. Attalaah', 'Rehab', 'Dr. Naseer Alenezi'],
    },
    liver_after_9pm_second_oncall: {
      type: 'mock-structured-fixture',
      dateKey: '11/04',
      at: '2026-04-11T21:30:00+03:00',
      expectedRows: [
        { name: 'Dr. Naseer Alenezi', role: 'SMROD' },
        { name: 'May', role: '2nd On-Call' },
        { name: 'Noora', role: '3rd On-Call' }
      ],
      forbiddenNames: ['Rehab'],
    },
    header_beta_typography: {
      type: 'mock-ui-fixture',
      selector: 'footer .mono',
      maxLetterSpacingPx: 1,
    },
    meta_info_order: {
      type: 'mock-ui-fixture',
      expectedLabels: ['التوقيت', 'اليوم', 'التاريخ'],
    },
    pdf_viewer_text_layer_enabled: {
      type: 'mock-ui-fixture',
      requiredSelectors: ['.pdf-page-stage', '.pdf-text-layer'],
      requiredSourceSnippets: ['renderTextLayer', 'pdf-text-layer'],
    },
  };

  const REAL_FIXTURE_MANIFEST_PATH = 'tests/fixtures/real/manifest.json';

  const REGRESSION_VALIDATORS = {
    surgeryConsultantPhone(fixture) {
      const phones = extractSurgeryConsultantPhones(fixture.text || '');
      const failures = [];
      if (phones[canonicalName(fixture.expected.name)] !== fixture.expected.phone) {
        failures.push(`Surgery consultant phone extractor did not recover ${fixture.expected.name} from the consultant list.`);
      }
      return {
        failures,
        affectedRows: Object.entries(phones).slice(0, 3).map(([name, phone]) => `${name} · #${phone}`),
      };
    },
    surgerySeniorAliasPhone(fixture) {
      const resolved = resolveSurgeryTemplateName(fixture.alias, {});
      const failures = [];
      if (canonicalName(resolved.name || '') !== canonicalName(fixture.expectedName)) {
        failures.push(`Surgery senior alias ${fixture.alias} did not resolve to ${fixture.expectedName}.`);
      }
      const phone = cleanPhone(resolved.phone || resolvePhone(ROTAS.surgery, { name: resolved.name || fixture.alias, phone:'' })?.phone || '');
      if (phone !== cleanPhone(fixture.expectedPhone)) {
        failures.push(`Surgery senior alias ${fixture.alias} did not resolve phone ${fixture.expectedPhone}.`);
      }
      return { failures, affectedRows: [`${fixture.alias} -> ${resolved.name || ''} · #${phone || 'none'}`] };
    },
    pediatricsRoleBehavior(fixture) {
      const morningRows = getEntries('pediatrics', ROTAS.pediatrics, fixture.dateKey, new Date(fixture.morningAt), '');
      const eveningRows = getEntries('pediatrics', ROTAS.pediatrics, fixture.dateKey, new Date(fixture.eveningAt), '');
      const failures = [];
      fixture.expectedMorning.forEach(name => {
        if (!morningRows.some(row => canonicalName(row.name || '') === canonicalName(name))) {
          failures.push(`Pediatrics morning behavior is missing ${name}.`);
        }
      });
      fixture.expectedEvening.forEach(name => {
        if (!eveningRows.some(row => canonicalName(row.name || '') === canonicalName(name))) {
          failures.push(`Pediatrics evening behavior is missing ${name}.`);
        }
      });
      fixture.forbidden.forEach(name => {
        if (morningRows.some(row => canonicalName(row.name || '') === canonicalName(name))) {
          failures.push(`Pediatrics still includes forbidden non-on-call row ${name}.`);
        }
      });
      return {
        failures,
        affectedRows: ['Morning'].concat(morningRows.map(_summarizeRow)).concat(['Evening']).concat(eveningRows.map(_summarizeRow)),
      };
    },
    pediatricsKfshErHospitalist(fixture) {
      const morningRows = getEntries('pediatrics', ROTAS.pediatrics, fixture.dateKey, new Date(fixture.morningAt), '');
      const eveningRows = getEntries('pediatrics', ROTAS.pediatrics, fixture.dateKey, new Date(fixture.eveningAt), '');
      const failures = [];
      [morningRows, eveningRows].forEach((rows, idx) => {
        const match = rows.find(row =>
          canonicalName(row.name || '') === canonicalName(fixture.expectedName) &&
          normalizeText(row.role || '') === normalizeText(fixture.expectedRole)
        );
        if (!match) {
          failures.push(`Pediatrics ${idx === 0 ? 'morning' : 'evening'} is missing the KFSH ER hospitalist row.`);
          return;
        }
        const actualPhone = cleanPhone(match.phone || resolvePhone(ROTAS.pediatrics, match)?.phone || '');
        if (actualPhone !== cleanPhone(fixture.expectedPhone)) {
          failures.push(`Wrong KFSH ER hospitalist phone: expected ${fixture.expectedPhone}, got ${actualPhone || 'none'}`);
        }
      });
      return { failures, affectedRows: morningRows.map(_summarizeRow).concat(['Evening'], eveningRows.map(_summarizeRow)) };
    },
    pediatricsPage3PhoneReconciliation(fixture) {
      const contactResult = buildContactMapFromText(fixture.text || '');
      const failures = [];
      fixture.expected.forEach(person => {
        const resolved = resolvePhoneFromContactMap(person.name, contactResult);
        const actualPhone = cleanPhone(resolved?.phone || '');
        if (actualPhone !== cleanPhone(person.phone)) {
          failures.push(`Pediatrics page-3 reconciliation missed ${person.name}: expected ${person.phone}, got ${actualPhone || 'none'}`);
        }
      });
      return { failures, affectedRows: fixture.expected.map(person => `${person.name} · #${person.phone}`) };
    },
    pediatricsThirdOnCallEmpty(fixture) {
      const rows = getEntries('pediatrics', ROTAS.pediatrics, fixture.dateKey, new Date(fixture.at), '');
      const failures = [];
      if (rows.some(row => normalizeText(row.role || '') === normalizeText(fixture.forbiddenRole))) {
        failures.push(`Pediatrics still renders ${fixture.forbiddenRole} even though that lane is unassigned.`);
      }
      return { failures, affectedRows: rows.map(_summarizeRow) };
    },
    picuStructuredParsing(fixture) {
      const tokens = stripPicuContactListBleed(extractPicuDoctorTokens(fixture.line || ''), fixture.line || '');
      const rows = buildPicuRowEntries(fixture.dateKey, tokens, { map: { 'Dr. Abdelwahab Omara':'0504150451' }, altMap:{} });
      const failures = _validateExpectedRows(rows, fixture.expectedRows || [], false);
      (fixture.forbiddenNames || []).forEach(name => {
        if (rows.some(row => canonicalName(row.name || '') === canonicalName(name))) {
          failures.push(`PICU parser incorrectly kept ${name} from the contact-list bleed.`);
        }
      });
      return { failures, affectedRows: rows.map(_summarizeRow) };
    },
    picuCurrentTimeBehavior(fixture) {
      const morningRows = getEntries('picu', ROTAS.picu, fixture.dateKey, new Date(fixture.morningAt), '');
      const eveningRows = getEntries('picu', ROTAS.picu, fixture.dateKey, new Date(fixture.eveningAt), '');
      const failures = [];
      failures.push(..._validateExpectedRows(morningRows, fixture.expectedMorning || [], false));
      failures.push(..._validateExpectedRows(eveningRows, fixture.expectedEvening || [], false));
      (fixture.forbiddenEvening || []).forEach(role => {
        if (eveningRows.some(row => normalizeText(row.role || '') === normalizeText(role))) {
          failures.push(`PICU evening view still includes expired day-shift role ${role}.`);
        }
      });
      return {
        failures,
        affectedRows: ['Morning'].concat(morningRows.map(_summarizeRow)).concat(['Evening']).concat(eveningRows.map(_summarizeRow)),
      };
    },
    picuPhoneBindingAndConfidence(fixture) {
      const rows = getEntries('picu', ROTAS.picu, fixture.dateKey, new Date(fixture.at), '');
      const failures = _validateExpectedRows(rows, fixture.expectedRows || [], false);
      (fixture.expectedRows || []).forEach(expected => {
        const match = _findExpectedRow(rows, expected);
        if (!match) return;
        if (expected.phone && match.phoneUncertain) failures.push(`PICU valid phone for ${expected.name} is still marked uncertain.`);
        if (match.doctorNameUncertain) failures.push(`PICU valid structured name for ${expected.name} is still marked uncertain.`);
      });
      return { failures, affectedRows: rows.map(_summarizeRow) };
    },
    nonPicuSpecialtyUnchanged(fixture) {
      const specialty = fixture.specialty || 'medicine_on_call';
      const rows = getEntries(specialty, ROTAS[specialty], fixture.dateKey, new Date(fixture.at), '');
      const failures = _validateExpectedRows(rows, fixture.expectedRows || [], false);
      return { failures, affectedRows: rows.map(_summarizeRow) };
    },
    radiologyWeekendBanner(fixture) {
      const fridayBanner = getRadiologyForcedBannerHtml('radiology_oncall', new Date(fixture.fridayAt));
      const sundayBanner = getRadiologyForcedBannerHtml('radiology_oncall', new Date(fixture.sundayAt));
      const failures = [];
      if (!fridayBanner.includes(fixture.expectedWeekendTime)) failures.push('Radiology weekend banner text did not switch to 24h wording.');
      if (!sundayBanner.includes(fixture.expectedWeekdayTime)) failures.push('Radiology weekday banner text no longer shows the normal weekday window.');
      return { failures, affectedRows: [fridayBanner, sundayBanner] };
    },
    radiologyWeekend0730Rule(fixture) {
      const friday = getSpecialtyCurrentShiftMeta('radiology_oncall', new Date(fixture.fridayAt));
      const saturday = getSpecialtyCurrentShiftMeta('radiology_oncall', new Date(fixture.saturdayAt));
      const failures = [];
      if ((friday.time || '') !== fixture.expectedTime) failures.push(`Friday weekend meta should be ${fixture.expectedTime}.`);
      if ((saturday.time || '') !== fixture.expectedTime) failures.push(`Saturday weekend meta should be ${fixture.expectedTime}.`);
      return { failures, affectedRows: [JSON.stringify(friday), JSON.stringify(saturday)] };
    },
    liverDaytimeCoverage(fixture) {
      const rows = getEntries('liver', ROTAS.liver, fixture.dateKey, new Date(fixture.at), '');
      const failures = [];
      fixture.expected.forEach(name => {
        if (!rows.some(row => canonicalName(row.name || '') === canonicalName(name))) {
          failures.push(`Liver daytime coverage is missing ${name}.`);
        }
      });
      return { failures, affectedRows: rows.map(_summarizeRow) };
    },
    hematologySecondOnCall(fixture) {
      const rows = getEntries('hematology', ROTAS.hematology, fixture.dateKey, new Date(fixture.at), '');
      const failures = [];
      const second = rows.find(row => canonicalName(row.name || '') === canonicalName(fixture.expectedName) && normalizeText(row.role || '') === normalizeText(fixture.expectedRole));
      if (!second) failures.push(`Hematology did not resolve ${fixture.expectedName} as ${fixture.expectedRole}.`);
      return { failures, affectedRows: rows.map(_summarizeRow) };
    },
    pdfSearchRemovedIfNotStandard(fixture) {
      const failures = [];
      const affectedRows = [];
      fixture.forbiddenIds.forEach(id => {
        const present = !!document.getElementById(id);
        affectedRows.push(`${id}=${present ? 'present' : 'absent'}`);
        if (present) failures.push(`PDF search UI element ${id} is still present even though the non-standard search feature should be removed.`);
      });
      return { failures, affectedRows };
    },
    gynePhonePresent(fixture) {
      const rows = getEntries('gynecology', ROTAS.gynecology, fixture.dateKey, new Date('2026-04-10T10:00:00+03:00'), '');
      const match = rows.find(row => canonicalName(row.name || '') === canonicalName(fixture.expectedName));
      const failures = [];
      if (!match) failures.push(`Gynecology is missing ${fixture.expectedName} on ${fixture.dateKey}.`);
      const actualPhone = cleanPhone((match && (match.phone || resolvePhone(ROTAS.gynecology, match)?.phone)) || '');
      if (actualPhone !== cleanPhone(fixture.expectedPhone)) failures.push(`Gynecology phone binding failed for ${fixture.expectedName}.`);
      return { failures, affectedRows: rows.map(_summarizeRow) };
    },
    psychiatryPhonePresent(fixture) {
      const rows = getEntries('psychiatry', ROTAS.psychiatry, fixture.dateKey, new Date('2026-04-10T10:00:00+03:00'), '');
      const match = rows.find(row => canonicalName(row.name || '') === canonicalName(fixture.expectedName));
      const failures = [];
      if (!match) failures.push(`Psychiatry is missing ${fixture.expectedName} on ${fixture.dateKey}.`);
      const actualPhone = cleanPhone((match && (match.phone || resolvePhone(ROTAS.psychiatry, match)?.phone)) || '');
      if (actualPhone !== cleanPhone(fixture.expectedPhone)) failures.push(`Psychiatry phone binding failed for ${fixture.expectedName}.`);
      return { failures, affectedRows: rows.map(_summarizeRow) };
    },
    neurosurgerySecondaryCoverage(fixture) {
      const rows = getEntries('neurosurgery', ROTAS.neurosurgery, fixture.dateKey, new Date(fixture.at), '');
      const failures = [];
      fixture.expectedRows.forEach(expected => {
        const match = rows.find(row =>
          canonicalName(row.name || '') === canonicalName(expected.name) &&
          (row.role || '').toLowerCase().includes(String(expected.roleIncludes || '').toLowerCase())
        );
        if (!match) failures.push(`Neurosurgery is missing ${expected.name} (${expected.roleIncludes}).`);
      });
      return { failures, affectedRows: rows.map(_summarizeRow) };
    },
    liverBefore9PmResolver(fixture) {
      const rows = getEntries('liver', ROTAS.liver, fixture.dateKey, new Date(fixture.at), '');
      const failures = [];
      fixture.mustInclude.forEach(name => {
        if (!rows.some(row => canonicalName(row.name || '') === canonicalName(name))) {
          failures.push(`Liver before 9 PM is missing ${name}.`);
        }
      });
      fixture.mustExclude.forEach(name => {
        if (rows.some(row => canonicalName(row.name || '') === canonicalName(name))) {
          failures.push(`Liver before 9 PM still incorrectly shows ${name}.`);
        }
      });
      const smor = rows.find(row => canonicalName(row.name || '') === canonicalName('Dr. Mujtaba Almishqab'));
      if (!smor || normalizeText(smor.role || '') !== normalizeText(fixture.expectedRole)) {
        failures.push('Liver before 9 PM did not resolve the active SMOR doctor correctly.');
      }
      return { failures, affectedRows: rows.map(_summarizeRow) };
    },
    kptxConsultantPresence(fixture) {
      const rows = getEntries('kptx', ROTAS.kptx, fixture.dateKey, new Date(fixture.at), '');
      const failures = [];
      const match = rows.find(row =>
        canonicalName(row.name || '') === canonicalName(fixture.expectedName) &&
        (row.role || '').toLowerCase().includes(String(fixture.expectedRole || '').toLowerCase())
      );
      if (!match) failures.push(`KPTx is missing consultant ${fixture.expectedName}.`);
      const actualPhone = cleanPhone((match && (match.phone || resolvePhone(ROTAS.kptx, match)?.phone)) || '');
      if (actualPhone !== cleanPhone(fixture.expectedPhone)) failures.push(`KPTx consultant phone binding failed for ${fixture.expectedName}.`);
      return { failures, affectedRows: rows.map(_summarizeRow) };
    },
    liverSmrodOrdering(fixture) {
      const rows = sortEntries(getEntries('liver', ROTAS.liver, fixture.dateKey, new Date(fixture.at), ''));
      const failures = [];
      const first = rows[0];
      if (!first || canonicalName(first.name || '') !== canonicalName(fixture.firstName) || normalizeText(first.role || '') !== normalizeText(fixture.firstRole)) {
        failures.push(`Liver should show ${fixture.firstName} as the first active ${fixture.firstRole} row before 9 PM.`);
      }
      fixture.mustExclude.forEach(name => {
        if (rows.some(row => canonicalName(row.name || '') === canonicalName(name))) {
          failures.push(`Liver before 9 PM still incorrectly shows ${name}.`);
        }
      });
      return { failures, affectedRows: rows.map(_summarizeRow) };
    },
    liverAfter9PmSecondOnCall(fixture) {
      const rows = sortEntries(getEntries('liver', ROTAS.liver, fixture.dateKey, new Date(fixture.at), ''));
      const failures = _validateExpectedRows(rows, fixture.expectedRows || [], false);
      (fixture.forbiddenNames || []).forEach(name => {
        if (rows.some(row => canonicalName(row.name || '') === canonicalName(name))) {
          failures.push(`Liver after 9 PM still incorrectly shows ${name}.`);
        }
      });
      return { failures, affectedRows: rows.map(_summarizeRow) };
    },
    headerBetaTypography(fixture) {
      const failures = [];
      const node = document.querySelector(fixture.selector);
      if (!node) {
        failures.push(`Missing beta typography node ${fixture.selector}.`);
        return { failures, affectedRows: [] };
      }
      const style = window.getComputedStyle(node);
      const spacing = parseFloat(style.letterSpacing || '0');
      if (!(spacing <= fixture.maxLetterSpacingPx)) {
        failures.push(`Beta footer letter spacing is still too wide: ${style.letterSpacing}`);
      }
      return { failures, affectedRows: [`letter-spacing=${style.letterSpacing}`, `font-family=${style.fontFamily}`] };
    },
    metaInfoOrder(fixture) {
      const failures = [];
      const labels = Array.from(document.querySelectorAll('.tbar .tl')).map(node => node.textContent.trim());
      if (JSON.stringify(labels) !== JSON.stringify(fixture.expectedLabels)) {
        failures.push(`Meta info order mismatch: got ${labels.join(' | ')}`);
      }
      return { failures, affectedRows: labels };
    },
    pdfViewerTextLayerEnabled(fixture) {
      const failures = [];
      const renderSource = typeof renderPdfPreviewPages === 'function' ? String(renderPdfPreviewPages) : '';
      fixture.requiredSourceSnippets.forEach(snippet => {
        if (!renderSource.includes(snippet)) {
          failures.push(`PDF viewer renderer is missing text-layer snippet: ${snippet}`);
        }
      });
      const styles = Array.from(document.styleSheets).flatMap(sheet => {
        try { return Array.from(sheet.cssRules || []); } catch (err) { return []; }
      }).map(rule => rule.cssText || '');
      fixture.requiredSelectors.forEach(selector => {
        if (!styles.some(text => text.includes(selector))) {
          failures.push(`PDF viewer styles are missing ${selector}.`);
        }
      });
      return { failures, affectedRows: fixture.requiredSelectors };
    },
  };

  function _findExpectedRow(rows=[], expected={}) {
    return rows.find(row => {
      if (canonicalName(row.name || '') !== canonicalName(expected.name || '')) return false;
      if (expected.role && normalizeText(row.role || '') !== normalizeText(expected.role || '')) return false;
      return true;
    });
  }

  function _validateExpectedRows(rows=[], expectedRows=[], allowExtra=true) {
    const failures = [];
    expectedRows.forEach(expected => {
      const match = _findExpectedRow(rows, expected);
      if (!match) {
        failures.push(`Missing expected row: ${expected.name}${expected.role ? ` · ${expected.role}` : ''}`);
        return;
      }
      if (expected.phone) {
        const dept = ROTAS[match.specialty]
          || Object.values(ROTAS).find(candidate => candidate?.label === match.section)
          || { contacts:{} };
        const actualPhone = cleanPhone(match.phone || resolvePhone(dept, match)?.phone || '');
        if (actualPhone !== cleanPhone(expected.phone)) {
          failures.push(`Wrong phone for ${expected.name}: expected ${expected.phone}, got ${actualPhone || 'none'}`);
        }
      }
    });
    if (!allowExtra) {
      const unexpected = rows.filter(row => !expectedRows.some(expected => _findExpectedRow([row], expected)));
      if (unexpected.length) failures.push(`Unexpected rows: ${unexpected.slice(0, 3).map(_summarizeRow).join(' | ')}`);
    }
    return failures;
  }

  async function loadRealPdfFixtureManifest() {
    const res = await fetch(REAL_FIXTURE_MANIFEST_PATH, { cache:'no-store' });
    if (!res.ok) throw new Error(`Failed to load real fixture manifest: ${res.status}`);
    return res.json();
  }

  async function loadRealPdfFixture(path='') {
    const res = await fetch(path, { cache:'no-store' });
    if (!res.ok) throw new Error(`Failed to load real fixture ${path}: ${res.status}`);
    return res.json();
  }

  function validateRealPdfFixture(fixture={}) {
    const specialty = fixture.specialty || '';
    const dept = ROTAS[specialty];
    if (!dept) {
      return { failures:[`Unknown specialty in real fixture: ${specialty}`], affectedRows:[] };
    }
    const checks = Array.isArray(fixture.checks) ? fixture.checks : [{
      dateKey: fixture.dateKey,
      at: fixture.at,
      expectedRows: fixture.expectedRows || [],
      forbiddenNames: fixture.forbiddenNames || [],
      allowExtra: fixture.allowExtra !== false,
    }];
    const failures = [];
    const affectedRows = [];
    checks.forEach(check => {
      const now = new Date(check.at);
      const rows = getEntries(specialty, dept, check.dateKey, now, '');
      const rowFailures = _validateExpectedRows(rows, check.expectedRows || [], check.allowExtra !== false);
      failures.push(...rowFailures);
      (check.forbiddenNames || []).forEach(name => {
        if (rows.some(row => canonicalName(row.name || '') === canonicalName(name))) {
          failures.push(`Forbidden row present: ${name}`);
        }
      });
      affectedRows.push(`[${check.dateKey} @ ${check.at}]`);
      affectedRows.push(...rows.map(_summarizeRow));
    });
    return { failures, affectedRows };
  }

  async function runRealPdfFixtureTests() {
    const manifest = await loadRealPdfFixtureManifest();
    const snapshots = manifest && Array.isArray(manifest.snapshots) ? manifest.snapshots : [];
    const results = [];
    for (const path of snapshots) {
      const fixture = await loadRealPdfFixture(path);
      const outcome = validateRealPdfFixture(fixture);
      results.push({
        id: fixture.id || path,
        specialty: fixture.specialty || 'unknown',
        passed: (outcome.failures || []).length === 0,
        hardBlocked: false,
        failures: outcome.failures || [],
        checkedAt: Date.now(),
        fixtureType: 'real-pdf-snapshot',
        fixturePath: path,
      });
    }
    return results;
  }

  async function loadPdfFixtureFile(sourcePdf='') {
    const res = await fetch(sourcePdf, { cache:'no-store' });
    if (!res.ok) throw new Error(`Failed to load PDF fixture ${sourcePdf}: ${res.status}`);
    const blob = await res.blob();
    const fileName = sourcePdf.split('/').pop() || 'fixture.pdf';
    return new File([blob], fileName, { type: 'application/pdf' });
  }

  function validateUploadPipelineDisplay(fixture={}, normalizedPayload=null) {
    const dept = ROTAS[fixture.specialty];
    if (!dept) {
      return { failures:[`Unknown specialty in upload fixture: ${fixture.specialty}`], affectedRows:[] };
    }
    const checks = Array.isArray(fixture.checks) ? fixture.checks : [{
      dateKey: fixture.dateKey,
      at: fixture.at,
      expectedRows: fixture.expectedRows || [],
      forbiddenNames: fixture.forbiddenNames || [],
      allowExtra: fixture.allowExtra !== false,
    }];
    const failures = [];
    const affectedRows = [];
    checks.forEach(check => {
      const rows = resolveDisplayEntriesFromNormalizedPayload(
        fixture.specialty,
        normalizedPayload,
        check.dateKey,
        new Date(check.at),
        ''
      );
      failures.push(..._validateExpectedRows(rows, check.expectedRows || [], check.allowExtra !== false));
      (check.forbiddenNames || []).forEach(name => {
        if (rows.some(row => canonicalName(row.name || '') === canonicalName(name))) {
          failures.push(`Forbidden upload-display row present: ${name}`);
        }
      });
      affectedRows.push(`[${check.dateKey} @ ${check.at}]`);
      affectedRows.push(...rows.map(_summarizeRow));
    });
    return { failures, affectedRows };
  }

  async function runUploadPipelineFixtureTests() {
    const manifest = await loadRealPdfFixtureManifest();
    const snapshots = manifest && Array.isArray(manifest.snapshots) ? manifest.snapshots : [];
    const results = [];
    for (const path of snapshots) {
      const fixture = await loadRealPdfFixture(path);
      if (!fixture.sourcePdf || !fixture.specialty) continue;
      const file = await loadPdfFixtureFile(fixture.sourcePdf);
      const detected = await detectDeptKeyFromPdf(file);
      const parsed = await parseUploadedPdf(file, fixture.specialty);
      const auditResult = await auditParsedRecord({
        deptKey: fixture.specialty,
        name: file.name,
        entries: parsed.entries || [],
        textSample: parsed.textSample || '',
        specialtyLabel: specialtyLabelForKey(fixture.specialty, file.name),
        specialtyUncertain: detected.deptKey !== fixture.specialty,
        rawText: parsed.rawText || '',
      }, null);
      const normalizedPayload = buildNormalizedUploadPayload({
        deptKey: fixture.specialty,
        fileName: file.name,
        entries: auditResult.annotatedEntries || parsed.entries || [],
        parseDebug: parsed.debug || {},
        rawText: parsed.rawText || '',
      });
      const decision = decideUploadPublication({
        deptKey: fixture.specialty,
        parseDebug: parsed.debug || {},
        auditResult,
        entries: auditResult.annotatedEntries || parsed.entries || [],
        normalizedPayload,
        fileName: file.name,
        rawText: parsed.rawText || '',
      });
      const displayOutcome = validateUploadPipelineDisplay(fixture, normalizedPayload);
      const failures = [...(displayOutcome.failures || [])];
      if (!parsed.entries || !parsed.entries.length) {
        failures.push('Upload pipeline extracted zero rows from the real PDF fixture.');
      }
      if (!normalizedPayload.roles || !normalizedPayload.roles.length) {
        failures.push('Upload pipeline failed to produce normalized roles.');
      }
      if (!auditResult.publishable && decision.publishToLive) {
        failures.push('Upload pipeline activated a fixture even though validation marked it non-publishable.');
      }
      if (decision.publishToLive && normalizedPayload.specialty !== fixture.specialty) {
        failures.push(`Activated specialty mismatch: expected ${fixture.specialty}, got ${normalizedPayload.specialty}.`);
      }
      results.push({
        id: `upload_${fixture.id || path}`,
        specialty: fixture.specialty,
        passed: failures.length === 0,
        hardBlocked: false,
        failures,
        checkedAt: Date.now(),
        fixtureType: 'upload-pipeline',
        fixturePath: path,
        affectedRows: displayOutcome.affectedRows || [],
      });
    }
    return results;
  }

  async function _uploadThroughRuntimeHandler(sourcePdf='') {
    const input = document.getElementById('pdfUploadInline');
    const status = document.getElementById('uploadStatus');
    if (!input || !status) throw new Error('Upload UI elements not found.');
    const res = await fetch(sourcePdf, { cache:'no-store' });
    if (!res.ok) throw new Error(`Failed to load runtime upload fixture ${sourcePdf}: ${res.status}`);
    const blob = await res.blob();
    const fileName = sourcePdf.split('/').pop() || 'upload.pdf';
    const file = new File([blob], fileName, { type:'application/pdf' });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles:true }));

    let settled = false;
    for (let i = 0; i < 160; i += 1) {
      await new Promise(resolve => setTimeout(resolve, 250));
      const text = String(status.innerText || '').trim();
      const active = uploadedRecordForDept('medicine_on_call');
      if (active?.name === file.name && active?.parsedActive) {
        settled = true;
        break;
      }
      if (text && !/Checking uploaded PDF|Checking \d+ uploaded PDFs/i.test(text)) {
        const direct = await getPdfRecord('medicine_on_call').catch(() => null);
        if (direct?.name === file.name) {
          settled = true;
          break;
        }
      }
    }
    if (!settled) {
      throw new Error(`Runtime upload did not settle for ${file.name}.`);
    }
    await loadUploadedSpecialties();
    return {
      fileName,
      record: await getPdfRecord('medicine_on_call'),
      active: uploadedRecordForDept('medicine_on_call'),
      statusText: String(status.innerText || '').trim(),
    };
  }

  function shouldRunRuntimeUploadE2E() {
    try {
      const params = new URLSearchParams(window.location.search || '');
      return params.get('runRuntimeUploadE2E') === '1';
    } catch (_) {
      return false;
    }
  }

  async function runRegressionSuite() {
    const golden = await runGoldenTests();
    let realFixtures = [];
    let uploadFixtures = [];
    try {
      realFixtures = await runRealPdfFixtureTests();
    } catch (err) {
      realFixtures = [{
        id: 'real-fixture-loader',
        specialty: 'system',
        passed: false,
        hardBlocked: false,
        failures: [String(err && err.message ? err.message : err)],
        checkedAt: Date.now(),
        fixtureType: 'real-pdf-snapshot',
      }];
    }
    try {
      uploadFixtures = await runUploadPipelineFixtureTests();
    } catch (err) {
      uploadFixtures = [{
        id: 'upload-fixture-loader',
        specialty: 'system',
        passed: false,
        hardBlocked: false,
        failures: [String(err && err.message ? err.message : err)],
        checkedAt: Date.now(),
        fixtureType: 'upload-pipeline',
      }];
    }
    [...realFixtures, ...uploadFixtures].forEach(result => {
      if (!result.passed) {
        _push({
          specialty: result.specialty,
          fileName: result.fixturePath || '(real fixture)',
          severity: 'error',
          issueType: 'golden-failed',
          explanation: result.failures[0],
          affectedRows: [],
        });
      }
    });
    return { golden, realFixtures, uploadFixtures };
  }

  const BUG_REGRESSION_TESTS = [
    {
      id: 'medicine_runtime_upload_handler_activation',
      specialty: 'medicine_on_call',
      async run() {
        const previous = await getPdfRecord('medicine_on_call').catch(() => null);
        try {
          const outcome = await _uploadThroughRuntimeHandler('assets/pdfs/Block 7 (Mar 15 - Apr 11).pdf');
          const failures = [];
          if (!outcome.record) failures.push('Runtime upload did not persist a Medicine record.');
          if (!outcome.record?.parsedActive) failures.push('Runtime upload persisted Medicine as inactive.');
          if (outcome.record?.audit?.publishable === false) failures.push('Runtime upload kept audit.publishable=false on an active Medicine upload.');
          if (outcome.record?.review?.reviewOnly) failures.push('Runtime upload left Medicine marked reviewOnly after activation.');
          if (outcome.record?.review?.specialty) failures.push('Runtime upload left Medicine marked specialty review after activation.');
          if ((outcome.record?.review?.policyIssues || []).some(issueType => ['uncertain-specialty', 'missing-consultant', 'weak-phone-match', 'noisy-label'].includes(issueType))) {
            failures.push('Runtime upload kept warning-only Medicine policy issues on the active saved record.');
          }
          if (!outcome.record?.diagnostics?.activation?.activated) failures.push('Runtime upload did not persist activated diagnostics for Medicine.');
          if (!outcome.active?.parsedActive) failures.push('Runtime upload did not register Medicine as the active searchable upload.');
          return {
            failures,
            affectedRows: [
              outcome.fileName,
              outcome.statusText,
              `parsedActive=${!!outcome.record?.parsedActive}`,
              `audit.publishable=${String(outcome.record?.audit?.publishable)}`,
              `reviewOnly=${String(outcome.record?.review?.reviewOnly)}`,
              `policyIssues=${(outcome.record?.review?.policyIssues || []).join('|') || 'none'}`,
            ],
          };
        } finally {
          if (previous) {
            if (previous.parsedActive) await saveActivePdfRecord(previous);
            else await savePdfRecord(previous);
          }
          else {
            const db = await openPdfDb();
            await new Promise((resolve, reject) => {
              const tx = db.transaction('pdfs', 'readwrite');
              tx.objectStore('pdfs').delete('medicine_on_call');
              tx.oncomplete = () => resolve();
              tx.onerror = () => reject(tx.error);
            });
          }
          await loadUploadedSpecialties();
        }
      },
    },
    {
      id: 'medicine_upload_activation_valid_readable',
      specialty: 'medicine_on_call',
      run() {
        const now = new Date('2026-04-01T10:00:00+03:00');
        const entries = [
          { specialty:'medicine_on_call', date:'01/04', role:'Junior ER', name:'Dr. Mohammed Hadadd', phone:'0549095077', section:'Junior ER', shiftType:'day', startTime:'07:30', endTime:'21:00' },
          { specialty:'medicine_on_call', date:'01/04', role:'Senior ER', name:'Dr. Ali Ayman Bazroon', phone:'0546488997', section:'Senior', shiftType:'day', startTime:'07:30', endTime:'21:00' },
        ];
        const normalized = buildNormalizedUploadPayload({ deptKey:'medicine_on_call', fileName:'medicine.pdf', entries, parseDebug:{ parserMode:'specialized', templateDetected:true } });
        const decision = decideUploadPublication({
          deptKey:'medicine_on_call',
          parseDebug:{ parserMode:'specialized', templateDetected:true },
          auditResult:{ approved:true, publishable:true, overallConfidence:'medium', issues:[] },
          entries,
          normalizedPayload: normalized,
          fileName:'medicine.pdf',
          rawText:'Wed 1/4 Abrar A.Alsughir M.Alhaddad Ahmed Bazroon H.Barbari',
          now,
        });
        const failures = [];
        if (!decision.publishToLive) failures.push('Readable Medicine upload did not activate.');
        if (!decision.diagnostics?.medicine?.currentActiveRolesResolved) failures.push('Medicine diagnostics did not report current active roles as resolved.');
        return { failures, affectedRows: (decision.diagnostics?.medicine?.currentActiveRows || []).map(row => `${row.name} · ${row.role}`) };
      },
    },
    {
      id: 'medicine_upload_weak_phone_warning_only',
      specialty: 'medicine_on_call',
      run() {
        const now = new Date('2026-04-01T10:00:00+03:00');
        const entries = [
          { specialty:'medicine_on_call', date:'01/04', role:'Junior ER', name:'Dr. Mohammed Hadadd', phone:'', phoneUncertain:true, section:'Junior ER', shiftType:'day', startTime:'07:30', endTime:'21:00' },
          { specialty:'medicine_on_call', date:'01/04', role:'Senior ER', name:'Dr. Ali Ayman Bazroon', phone:'', phoneUncertain:true, section:'Senior', shiftType:'day', startTime:'07:30', endTime:'21:00' },
        ];
        const normalized = buildNormalizedUploadPayload({ deptKey:'medicine_on_call', fileName:'medicine.pdf', entries, parseDebug:{ parserMode:'specialized', templateDetected:true } });
        const decision = decideUploadPublication({
          deptKey:'medicine_on_call',
          parseDebug:{ parserMode:'specialized', templateDetected:true },
          auditResult:{ approved:true, publishable:true, overallConfidence:'medium', issues:[{ severity:'warn', issueType:'weak-phone-match', explanation:'phones incomplete' }] },
          entries,
          normalizedPayload: normalized,
          fileName:'medicine.pdf',
          rawText:'Wed 1/4 Abrar A.Alsughir M.Alhaddad Ahmed Bazroon H.Barbari',
          now,
        });
        const failures = [];
        if (!decision.publishToLive) failures.push('Weak phone binding alone still blocked Medicine activation.');
        if (!(decision.diagnostics?.activation?.reasonCodes || []).every(code => code !== 'FAILED_SPECIALTY_VALIDATION')) {
          failures.push('Weak phone binding still triggered FAILED_SPECIALTY_VALIDATION for Medicine.');
        }
        return { failures, affectedRows: decision.previewRows || [] };
      },
    },
    {
      id: 'medicine_upload_previous_consultant_warning_only',
      specialty: 'medicine_on_call',
      async run() {
        const now = new Date('2026-04-01T10:00:00+03:00');
        const record = {
          deptKey:'medicine_on_call',
          name:'medicine.pdf',
          rawText:'Wed 1/4 Abrar A.Alsughir M.Alhaddad Ahmed Bazroon H.Barbari',
          entries:[
            { specialty:'medicine_on_call', date:'01/04', role:'Junior ER', name:'Dr. Mohammed Hadadd', phone:'0549095077', section:'Junior ER', shiftType:'day', startTime:'07:30', endTime:'21:00' },
            { specialty:'medicine_on_call', date:'01/04', role:'Senior ER', name:'Dr. Ali Ayman Bazroon', phone:'0546488997', section:'Senior', shiftType:'day', startTime:'07:30', endTime:'21:00' },
          ],
        };
        const oldRecord = {
          entries:[{ role:'Consultant On-Call', name:'Dr. Legacy Consultant' }],
        };
        const audit = await auditParsedRecord(record, oldRecord);
        const normalized = buildNormalizedUploadPayload({ deptKey:'medicine_on_call', fileName:'medicine.pdf', entries:audit.annotatedEntries, parseDebug:{ parserMode:'specialized', templateDetected:true }, rawText:record.rawText });
        const decision = decideUploadPublication({
          deptKey:'medicine_on_call',
          parseDebug:{ parserMode:'specialized', templateDetected:true },
          auditResult:audit,
          entries:audit.annotatedEntries,
          normalizedPayload: normalized,
          fileName:'medicine.pdf',
          rawText:record.rawText,
          now,
        });
        const failures = [];
        if (!audit.issues.some(issue => issue.issueType === 'missing-consultant')) failures.push('Medicine consultant disappearance warning was not emitted.');
        if (!decision.publishToLive) failures.push('Previous consultant disappearance alone still blocked Medicine activation.');
        if (decision.diagnostics?.medicine?.consultantIssue !== 'historical-diff-warning') failures.push('Medicine diagnostics did not classify consultant drift as a historical diff warning.');
        return { failures, affectedRows: (audit.issues || []).map(issue => issue.issueType) };
      },
    },
    {
      id: 'medicine_upload_invalid_stays_inactive',
      specialty: 'medicine_on_call',
      async run() {
        const now = new Date('2026-04-01T10:00:00+03:00');
        const audit = await auditParsedRecord({
          deptKey:'medicine_on_call',
          name:'bad.pdf',
          entries:[],
          textSample:'',
          rawText:'',
          specialtyLabel:'Medicine On-Call',
          specialtyUncertain:false,
        }, null);
        const decision = decideUploadPublication({
          deptKey:'medicine_on_call',
          parseDebug:{ parserMode:'specialized', templateDetected:false },
          auditResult:audit,
          entries:[],
          normalizedPayload: buildNormalizedUploadPayload({ deptKey:'medicine_on_call', fileName:'bad.pdf', entries:[], parseDebug:{ parserMode:'specialized', templateDetected:false }, rawText:'' }),
          fileName:'bad.pdf',
          rawText:'',
          now,
        });
        const failures = [];
        if (decision.publishToLive) failures.push('Invalid Medicine upload activated unexpectedly.');
        if (!decision.diagnostics?.validation?.hardBlocker) failures.push('Invalid Medicine upload did not report a hard blocker.');
        return { failures, affectedRows: (audit.issues || []).map(issue => issue.issueType) };
      },
    },
    {
      id: 'medicine_display_er_only_role_bound_phone',
      specialty: 'medicine_on_call',
      run() {
        const now = new Date('2026-04-12T10:00:00+03:00');
        const normalized = buildNormalizedUploadPayload({
          deptKey:'medicine_on_call',
          fileName:'IM Resident Rota (Block 8).pdf',
          entries:[
            { specialty:'medicine_on_call', date:'12/04', role:'Junior Ward', name:'Dr. Zainab Alsalman', phone:'0544229280', section:'Junior Ward', shiftType:'day', startTime:'07:30', endTime:'21:00' },
            { specialty:'medicine_on_call', date:'12/04', role:'Junior ER', name:'Dr. Hussain Ali Aldarwish', phone:'0539217592', section:'Junior ER', shiftType:'day', startTime:'07:30', endTime:'21:00' },
            { specialty:'medicine_on_call', date:'12/04', role:'Senior ER', name:'Dr. M. Abdulatif', phone:'0591536669', section:'Senior', shiftType:'day', startTime:'07:30', endTime:'21:00' },
          ],
          parseDebug:{ parserMode:'specialized', templateDetected:true },
          rawText:'Sun 12/4 Z.Alsalman Marwa H.Darwish M.Alahmad M.Abdulatif Maha',
        });
        const rows = resolveDisplayEntriesFromNormalizedPayload('medicine_on_call', normalized, '12/04', now, '');
        const failures = [];
        const junior = rows.find(entry => normalizeText(entry.role || '') === 'junior er');
        const senior = rows.find(entry => normalizeText(entry.role || '') === 'senior er');
        if (rows.some(entry => normalizeText(entry.section || '').includes('ward'))) failures.push('Medicine display still included Ward coverage rows.');
        if (rows.length !== 2) failures.push(`Medicine display should expose exactly 2 ER rows, got ${rows.length}.`);
        if (!junior || junior.name !== 'Dr. Hussain Ali Aldarwish' || cleanPhone(junior.phone || '') !== '0539217592') {
          failures.push('Junior ER did not stay bound to the Resident 1 / ER doctor and phone.');
        }
        if (!senior || senior.name !== 'Dr. Mohammed Alabdulatif' || cleanPhone(senior.phone || '') !== '0591536669') {
          failures.push('Senior ER did not resolve to Dr. Mohammed Alabdulatif with the correct Resident 4 phone.');
        }
        return { failures, affectedRows: rows.map(entry => `${entry.role} · ${entry.name} · ${entry.phone || 'none'}`) };
      },
    },
    {
      id: 'radiology_oncall_split_1004',
      specialty: 'radiology_oncall',
      run() {
        const rows = getEntries('radiology_oncall', ROTAS.radiology_oncall, '10/04', new Date('2026-04-10T22:00:00+03:00'), '');
        const failures = [];
        const abdulrahman = rows.find(row => canonicalName(row.name || '') === canonicalName('Abdulrahman Alshammari') && /2nd on-call/i.test(row.role || ''));
        const anaki = rows.find(row => canonicalName(row.name || '') === canonicalName('Mohammed Al Anaki') && /2nd on-call/i.test(row.role || ''));
        if (!abdulrahman) failures.push('Radiology On-Call did not split Abdulrahman Alshammari into a separate 2nd on-call row.');
        if (!anaki) failures.push('Radiology On-Call did not split Mohammed Al Anaki into a separate 2nd on-call row.');
        if (abdulrahman && cleanPhone(abdulrahman.phone || '') !== '0558718972') failures.push('Radiology On-Call Abdulrahman Alshammari phone was not linked correctly.');
        if (anaki && cleanPhone(anaki.phone || '') !== '0592037777') failures.push('Radiology On-Call Mohammed Al Anaki phone was not linked correctly.');
        return { failures, affectedRows: rows.slice(0, 6).map(_summarizeRow) };
      },
    },
    {
      id: 'surgery_resident_phone_parser',
      specialty: 'surgery',
      run() {
        const mockText = 'Senior Resident\nRawan Alibrahim R5 54 94 84181\nMahdi Ahmad R4 53 59 90880';
        const phones = extractSurgeryResidentPhones(mockText);
        const failures = [];
        if (phones[canonicalName('Dr. Rawan AlIbrahim')] !== '0549484181') {
          failures.push('Surgery resident phone extractor did not recover Dr. Rawan AlIbrahim from the resident table.');
        }
        return { failures, affectedRows: Object.entries(phones).slice(0, 3).map(([name, phone]) => `${name} · #${phone}`) };
      },
    },
    {
      id: 'surgery_consultant_phone_parser',
      specialty: 'surgery',
      run() {
        return REGRESSION_VALIDATORS.surgeryConsultantPhone(BUG_REGRESSION_FIXTURES.surgery_consultant_phone_parser);
      },
    },
    {
      id: 'surgery_senior_alias_phone_resolution',
      specialty: 'surgery',
      run() {
        return REGRESSION_VALIDATORS.surgerySeniorAliasPhone(BUG_REGRESSION_FIXTURES.surgery_senior_alias_phone_resolution);
      },
    },
    {
      id: 'pediatrics_role_behavior_1004',
      specialty: 'pediatrics',
      run() {
        return REGRESSION_VALIDATORS.pediatricsRoleBehavior(BUG_REGRESSION_FIXTURES.pediatrics_role_behavior_1004);
      },
    },
    {
      id: 'pediatrics_includes_kfsh_er_hospitalist',
      specialty: 'pediatrics',
      run() {
        return REGRESSION_VALIDATORS.pediatricsKfshErHospitalist(BUG_REGRESSION_FIXTURES.pediatrics_includes_kfsh_er_hospitalist);
      },
    },
    {
      id: 'pediatrics_page3_phone_reconciliation',
      specialty: 'pediatrics',
      run() {
        return REGRESSION_VALIDATORS.pediatricsPage3PhoneReconciliation(BUG_REGRESSION_FIXTURES.pediatrics_page3_phone_reconciliation);
      },
    },
    {
      id: 'pediatrics_third_oncall_empty_when_unassigned',
      specialty: 'pediatrics',
      run() {
        return REGRESSION_VALIDATORS.pediatricsThirdOnCallEmpty(BUG_REGRESSION_FIXTURES.pediatrics_third_oncall_empty_when_unassigned);
      },
    },
    {
      id: 'picu_structured_parser_1104',
      specialty: 'picu',
      run() {
        return REGRESSION_VALIDATORS.picuStructuredParsing(BUG_REGRESSION_FIXTURES.picu_structured_parser_1104);
      },
    },
    {
      id: 'picu_current_time_behavior',
      specialty: 'picu',
      run() {
        return REGRESSION_VALIDATORS.picuCurrentTimeBehavior(BUG_REGRESSION_FIXTURES.picu_current_time_behavior);
      },
    },
    {
      id: 'picu_phone_binding_and_confidence',
      specialty: 'picu',
      run() {
        return REGRESSION_VALIDATORS.picuPhoneBindingAndConfidence(BUG_REGRESSION_FIXTURES.picu_phone_binding_and_confidence);
      },
    },
    {
      id: 'non_picu_medicine_on_call_unchanged',
      specialty: 'medicine_on_call',
      run() {
        return REGRESSION_VALIDATORS.nonPicuSpecialtyUnchanged(BUG_REGRESSION_FIXTURES.non_picu_medicine_on_call_unchanged);
      },
    },
    {
      id: 'radiology_weekend_banner_text',
      specialty: 'radiology_oncall',
      run() {
        return REGRESSION_VALIDATORS.radiologyWeekendBanner(BUG_REGRESSION_FIXTURES.radiology_weekend_banner_text);
      },
    },
    {
      id: 'radiology_weekend_0730_0730_rule',
      specialty: 'radiology_oncall',
      run() {
        return REGRESSION_VALIDATORS.radiologyWeekend0730Rule(BUG_REGRESSION_FIXTURES.radiology_weekend_0730_0730_rule);
      },
    },
    {
      id: 'orthopedics_24h_shift_0904',
      specialty: 'orthopedics',
      run() {
        const rows = getEntries('orthopedics', ROTAS.orthopedics, '09/04', new Date('2026-04-09T10:00:00+03:00'), '');
        const failures = [];
        if (!rows.length) failures.push('Orthopedics returned no active rows for the audited date.');
        if (rows.some(row => getShiftTime(row, new Date('2026-04-09T10:00:00+03:00')) !== '07:30-07:30')) {
          failures.push('Orthopedics still shows a daytime-only shift instead of 24h 07:30-07:30 coverage.');
        }
        return { failures, affectedRows: rows.map(_summarizeRow) };
      },
    },
    {
      id: 'neurology_cross_page_phone_reconciliation',
      specialty: 'neurology',
      run() {
        const mockText = [
          'Dr. Hattan AlGhamdi 595770273',
          'Dr. Faisal Tarabzoni 582233320',
          'Fri 10-Apr-26 Eman Faisal Dr. Adnan Dr. Adnan',
        ].join('\n');
        const contactMap = buildNeurologyUploadContactMap(mockText);
        const hattan = resolveNeurologyTemplatePerson('Hattan', contactMap);
        const faisal = resolveNeurologyTemplatePerson('Faisal', contactMap);
        const failures = [];
        if (cleanPhone(hattan.phone || '') !== '0595770273') failures.push('Neurology cross-page reconciliation did not recover Hattan’s phone.');
        if (cleanPhone(faisal.phone || '') !== '0582233320') failures.push('Neurology cross-page reconciliation did not recover Faisal’s phone.');
        return { failures, affectedRows: [personToRow(hattan), personToRow(faisal)].filter(Boolean) };
      },
    },
    {
      id: 'kptx_consultant_visibility_0904',
      specialty: 'kptx',
      run() {
        const rows = getEntries('kptx', ROTAS.kptx, '09/04', new Date('2026-04-09T10:00:00+03:00'), '');
        const failures = [];
        const consultant = rows.find(row => /consultant/i.test(row.role || '') && cleanPhone(row.phone || resolvePhone(ROTAS.kptx, row)?.phone || '') === '0599932293');
        if (!consultant) failures.push('Kidney Transplant daytime view still drops consultant Dr. Khalid Akkari.');
        return { failures, affectedRows: rows.map(_summarizeRow) };
      },
    },
    {
      id: 'liver_daytime_active_coverage_0904',
      specialty: 'liver',
      run() {
        return REGRESSION_VALIDATORS.liverDaytimeCoverage(BUG_REGRESSION_FIXTURES.liver_daytime_active_coverage_0904);
      },
    },
    {
      id: 'liver_after_hours_smr_resolution',
      specialty: 'liver',
      run() {
        const mockNow = new Date('2026-04-09T22:00:00+03:00');
        const rows = normalizeLiverRowsForDisplay([
          { role:'Day Coverage', name:'May/Attalaah' },
          { role:'Night On-Call (9PM–9AM)', name:'SMRO' },
          { role:'2nd On-Call', name:'May' },
          { role:'3rd On-Call', name:'Noora' },
        ], '09/04', mockNow);
        const failures = [];
        if (!rows.some(row => canonicalName(row.name || '') === canonicalName('Dr. Naseer Alenezi') && /smrod/i.test(row.role || ''))) {
          failures.push('Liver after-hours logic did not hand off to the active SMROD doctor after 9 PM.');
        }
        if (rows.some(row => /smro|im\.resident|im resident/i.test(row.name || ''))) {
          failures.push('Liver after-hours view still exposes the unresolved SMR/IM.Resident alias.');
        }
        if (!rows.some(row => canonicalName(row.name || '') === canonicalName('May') && /2nd on-call/i.test(row.role || ''))) {
          failures.push('Liver after-hours view did not show the valid 2nd on-call doctor after 9 PM.');
        }
        return { failures, affectedRows: rows.map(_summarizeRow) };
      },
    },
    {
      id: 'hematology_second_oncall_resolution_0904',
      specialty: 'hematology',
      run() {
        return REGRESSION_VALIDATORS.hematologySecondOnCall(BUG_REGRESSION_FIXTURES.hematology_second_oncall_resolution_0904);
      },
    },
    {
      id: 'pdf_search_removed_if_not_standard',
      specialty: 'system',
      run() {
        return REGRESSION_VALIDATORS.pdfSearchRemovedIfNotStandard(BUG_REGRESSION_FIXTURES.pdf_search_removed_if_not_standard);
      },
    },
    {
      id: 'gyne_amna_phone_exists',
      specialty: 'gynecology',
      run() {
        return REGRESSION_VALIDATORS.gynePhonePresent(BUG_REGRESSION_FIXTURES.gyne_amna_phone_exists);
      },
    },
    {
      id: 'psychiatry_amro_phone_exists',
      specialty: 'psychiatry',
      run() {
        return REGRESSION_VALIDATORS.psychiatryPhonePresent(BUG_REGRESSION_FIXTURES.psychiatry_amro_phone_exists);
      },
    },
    {
      id: 'neurosurgery_laila_and_mazen_present',
      specialty: 'neurosurgery',
      run() {
        return REGRESSION_VALIDATORS.neurosurgerySecondaryCoverage(BUG_REGRESSION_FIXTURES.neurosurgery_laila_and_mazen_present);
      },
    },
    {
      id: 'liver_before_9pm_smor_active',
      specialty: 'liver',
      run() {
        return REGRESSION_VALIDATORS.liverBefore9PmResolver(BUG_REGRESSION_FIXTURES.liver_before_9pm_smor_active);
      },
    },
    {
      id: 'kptx_consultant_khalid_present',
      specialty: 'kptx',
      run() {
        return REGRESSION_VALIDATORS.kptxConsultantPresence(BUG_REGRESSION_FIXTURES.kptx_consultant_khalid_present);
      },
    },
    {
      id: 'liver_smrod_ordering_before_9pm',
      specialty: 'liver',
      run() {
        return REGRESSION_VALIDATORS.liverSmrodOrdering(BUG_REGRESSION_FIXTURES.liver_smrod_ordering_before_9pm);
      },
    },
    {
      id: 'liver_after_9pm_second_oncall',
      specialty: 'liver',
      run() {
        return REGRESSION_VALIDATORS.liverAfter9PmSecondOnCall(BUG_REGRESSION_FIXTURES.liver_after_9pm_second_oncall);
      },
    },
    {
      id: 'header_beta_typography',
      specialty: 'system',
      run() {
        return REGRESSION_VALIDATORS.headerBetaTypography(BUG_REGRESSION_FIXTURES.header_beta_typography);
      },
    },
    {
      id: 'meta_info_order',
      specialty: 'system',
      run() {
        return REGRESSION_VALIDATORS.metaInfoOrder(BUG_REGRESSION_FIXTURES.meta_info_order);
      },
    },
    {
      id: 'pdf_viewer_text_layer_enabled',
      specialty: 'system',
      run() {
        return REGRESSION_VALIDATORS.pdfViewerTextLayerEnabled(BUG_REGRESSION_FIXTURES.pdf_viewer_text_layer_enabled);
      },
    },
  ];

  function personToRow(person={}) {
    if (!person || !person.name) return '';
    return `${person.name} · #${person.phone || 'none'}`;
  }

  async function _setVerifiedState(specialty, result) {
    _applyDeptAuditState(specialty, {
      verified: !!result.passed,
      hardBlocked: !!result.hardBlocked,
      source: 'golden-test',
    });
    _goldenResults.set(specialty, result);
    try {
      const existing = await getPdfRecord(specialty);
      if (existing) {
        const updated = {
          ...existing,
          verified: !!result.passed,
          auditBlocked: !!result.hardBlocked,
          goldenResult: result,
        };
        await savePdfRecord(updated);
        uploadedPdfRecords.set(specialty, canonicalizeUploadedRecord(updated));
      }
    } catch (err) {
      console.warn('Golden verification persistence failed:', err);
    }
  }

  async function runGoldenTests() {
    _clearByPredicate(item => item.issueType === 'golden-failed');
    const results = [];
    for (const test of GOLDEN_TESTS) {
      const actualRows = _extractGoldenRows(test);
      const dept = ROTAS[test.specialty];
      const failures = [];

      if (test.mode === 'radiology_duty') {
        failures.push(..._runRadiologyDutyGoldenCheck(actualRows));
        const passed = failures.length === 0;
        const result = {
          id: test.id,
          specialty: test.specialty,
          passed,
          hardBlocked: false,
          failures,
          checkedAt: Date.now(),
        };
        await _setVerifiedState(test.specialty, result);
        results.push(result);
        if (!passed) {
          _push({
            specialty: test.specialty,
            fileName: '(golden test)',
            severity: 'error',
            issueType: 'golden-failed',
            explanation: failures[0],
            affectedRows: actualRows.slice(0, 5).map(_summarizeRow),
          });
        }
        continue;
      }

      const names = actualRows.map(row => row.name || '');
      test.expectedRows.forEach((expected, index) => {
        const match = _findGoldenRow(actualRows, expected);
        if (!match) {
          failures.push(`Missing expected row: ${expected.name}`);
          return;
        }
        if (expected.phone) {
          const resolved = resolvePhone(dept || { contacts:{} }, match);
          const actualPhone = cleanPhone((resolved && resolved.phone) || match.phone || '');
          if (actualPhone !== cleanPhone(expected.phone)) {
            failures.push(`Wrong phone for ${expected.name}: expected ${expected.phone}, got ${actualPhone || 'none'}`);
          }
        }
      });

      const unexpected = actualRows.filter(row => !test.expectedRows.some(expected => _findGoldenRow([row], expected)));
      if (unexpected.length) {
        failures.push(`Unexpected row(s): ${unexpected.slice(0, 3).map(_summarizeRow).join(' | ')}`);
      }

      if (test.requiredTiers && test.requiredTiers.length) {
        const missingTiers = test.requiredTiers.filter(tier => {
          const normalized = tier.toLowerCase();
          return !actualRows.some(row => {
            const role = (row.role || '').toLowerCase();
            if (normalized === 'resident') return role.includes('resident');
            if (normalized === 'consultant') return role.includes('consultant');
            if (normalized === 'fellow') return role.includes('fellow');
            return role.includes(normalized);
          });
        });
        if (missingTiers.length) failures.push(`Missing tiers: ${missingTiers.join(', ')}`);
      }

      const passed = failures.length === 0;
      const result = {
        id: test.id,
        specialty: test.specialty,
        passed,
        hardBlocked: false,
        failures,
        checkedAt: Date.now(),
      };
      await _setVerifiedState(test.specialty, result);
      results.push(result);
      if (!passed) {
        _push({
          specialty: test.specialty,
          fileName: '(golden test)',
          severity: 'error',
          issueType: 'golden-failed',
          explanation: failures[0],
          affectedRows: actualRows.slice(0, 5).map(_summarizeRow),
        });
      }
    }
    for (const test of BUG_REGRESSION_TESTS) {
      if (test.id === 'medicine_runtime_upload_handler_activation' && !shouldRunRuntimeUploadE2E()) continue;
      const outcome = await Promise.resolve(test.run());
      const failures = outcome.failures || [];
      const result = {
        id: test.id,
        specialty: test.specialty,
        passed: failures.length === 0,
        hardBlocked: false,
        failures,
        checkedAt: Date.now(),
      };
      results.push(result);
      if (failures.length) {
        _push({
          specialty: test.specialty,
          fileName: '(golden test)',
          severity: 'error',
          issueType: 'golden-failed',
          explanation: failures[0],
          affectedRows: outcome.affectedRows || [],
        });
      }
    }
    return results;
  }

  function _hasUsableDoctorRow(entry={}) {
    return !isNoCoverageEntry(entry) && !!(entry.name || entry.role || entry.phone);
  }

  function _setDeptVerified(deptKey, passed, hardBlocked=false, source='') {
    _applyDeptAuditState(deptKey, { verified: !!passed, hardBlocked: !!hardBlocked, source });
  }

  // ── CONFIDENCE SCORING ────────────────────────────────────────
  // Returns 'high' | 'medium' | 'low'
  function scoreRow(entry) {
    let score = 100;

    // Name
    if (!entry.name || entry.name.length < 2)              score -= 50;
    else if (entry.name.split(' ').length < 2)             score -= 15; // single word
    else if (/^[A-Z]{2,4}$/.test(entry.name.trim()))       score -= 40; // abbreviation only

    // Role
    if (!entry.role || entry.role.length < 2)              score -= 30;
    else if (!/consultant|fellow|resident|on.call|duty|1st|2nd|3rd/i.test(entry.role)) score -= 10;

    // Phone
    if (!entry.phone)                                       score -= 8;
    else if (entry.phoneUncertain)                          score -= 4;
    else if (!/^05\d{8}$/.test(entry.phone))               score -= 15;

    // Date — missing date means we can't pin it to a schedule slot
    if (!entry.date)                                        score -= 4;
    else if (entry.date === 'dynamic-weekday')              score -= 0;

    if (score >= 75) return 'high';
    if (score >= 45) return 'medium';
    return 'low';
  }

  // ── EXPECTED TIER PATTERNS ────────────────────────────────────
  // For each specialty, define what roles we expect to see when data is present.
  // Used for missing-tier detection.
  const EXPECTED_TIERS = {
    picu:             ['resident', '1st', '2nd'],
    orthopedics:      ['resident', '2nd', 'consultant'],
    surgery:          ['1st', '2nd', 'associate', 'consultant'],
    neurosurgery:     ['resident', '2nd', 'consultant', 'associate'],
    ent:              ['1st', '2nd', 'consultant'],
    gynecology:       ['resident', 'fellow', 'consultant'],
    urology:          ['resident', '2nd', 'consultant'],
    hematology:       [],
    radonc:           ['1st', 'consultant'],
    nephrology:       ['1st', '2nd', 'consultant'],
    kptx:             ['1st', 'consultant'],
    liver:            ['day', 'after-hours', '3rd'],
    psychiatry:       ['resident', 'consultant'],
    pediatrics:       ['1st', '2nd'],
    pediatric_heme_onc: ['1st', '2nd', 'consultant'],
    adult_cardiology: ['2nd', '3rd'],
    endocrinology:    ['fellow', 'consultant'],
    rheumatology:     ['fellow', 'consultant'],
    gastroenterology: ['fellow', 'consultant'],
    pulmonary:        [],
    infectious:       ['fellow', 'consultant'],
    dermatology:      ['resident', '2nd'],
    anesthesia:       ['resident', 'assistant', 'consultant'],
  };

  function _tierMatchesRole(tier='', role='') {
    const r = (role || '').toLowerCase();
    const t = (tier || '').toLowerCase();
    if (!r) return false;
    if (t === 'resident') return r.includes('resident');
    if (t === '1st') return /\b(1st|first)\b/.test(r) || r.includes('1st responder') || r.includes('resident');
    if (t === '2nd') return /\b(2nd|second)\b/.test(r) || r.includes('2nd responder');
    if (t === '3rd') return /\b(3rd|third)\b/.test(r);
    if (t === 'fellow') return r.includes('fellow');
    if (t === 'consultant') return r.includes('consultant');
    if (t === 'associate') return r.includes('associate');
    if (t === 'assistant') return r.includes('assistant');
    if (t === 'day') return r.includes('day coverage') || r.includes('day duty') || r.includes('day ');
    if (t === 'after-hours') return r.includes('after-hours') || r.includes('after duty') || r.includes('on-call');
    return r.includes(t);
  }

  function _checkMissingTiers(deptKey, entries) {
    const expected = EXPECTED_TIERS[deptKey];
    if (!expected || !expected.length || !entries.length) return [];
    return expected.filter(tier => !entries.some(entry => _tierMatchesRole(tier, entry.role || '')));
  }

  function _checkConsultantTierGap(entries=[]) {
    const hasConsultant = entries.some(e => _tierMatchesRole('consultant', e.role || ''));
    if (!hasConsultant) return false;
    const hasEarlierTier = ['1st', '2nd', '3rd', 'fellow', 'resident', 'associate', 'assistant']
      .some(tier => entries.some(entry => _tierMatchesRole(tier, entry.role || '')));
    const missingFrontTier = !entries.some(entry => _tierMatchesRole('1st', entry.role || '') || _tierMatchesRole('resident', entry.role || ''));
    return hasEarlierTier && missingFrontTier;
  }

  // ── NAME NORMALISATION / NOISE DETECTION ─────────────────────
  const _NOISE_RE = /(!{2,}|signed|taam|revision|rev\s*\d+|update[d]?|approved|rota|schedule|duty|on.call|april|march|may|\d{4})/i;

  function _isNoisyLabel(label='') {
    return _NOISE_RE.test(label) || label.length < 3 || label.length > 60;
  }

  function _normalizeSpecialtyLabel(raw='') {
    return raw
      .replace(/\.pdf$/i, '')
      .replace(/[-_]+/g, ' ')
      .replace(_NOISE_RE, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim()
      .replace(/\b\w/g, c => c.toUpperCase()); // title-case
  }

  // ── DUPLICATE ROW DETECTION ───────────────────────────────────
  function _findDuplicates(entries) {
    const seen = new Map();
    const dupes = [];
    entries.forEach((e, i) => {
      const key = [
        canonicalName(e.name),
        (e.date || ''),
        (e.role || '').toLowerCase().slice(0, 12),
      ].join('|');
      if (seen.has(key)) dupes.push({ a: seen.get(key), b: i });
      else seen.set(key, i);
    });
    return dupes;
  }

  function _findWeakPhones(entries=[]) {
    return entries.filter(entry => {
      if (isNoCoverageEntry(entry)) return false;
      if (!entry.phone) return false;
      if (entry.phoneUncertain) return true;
      return !/^05\d{8}$/.test(entry.phone);
    });
  }

  function _nameExistsInRawText(name='', rawText='') {
    const canonical = canonicalName(name);
    const source = canonicalName(rawText || '');
    if (!canonical || !source) return false;
    const tokens = canonical.split(' ').filter(t => t.length >= 3);
    if (!tokens.length) return false;
    const strong = tokens.filter(t => source.includes(t));
    return strong.length >= Math.min(2, tokens.length) || source.includes(canonical);
  }

  function _extractSourceNames(rawText='') {
    const contactResult = buildContactMapFromText(rawText || '');
    const map = (contactResult && contactResult.map) || {};
    return Object.keys(map).filter(name => {
      const tokens = canonicalName(name).split(' ').filter(t => t.length >= 3);
      return tokens.length >= 2;
    });
  }

  function _checkRawTextAlignment(entries=[], rawText='') {
    if (!rawText || !entries.length) return [];
    const issues = [];
    const missing = entries.filter(entry => {
      if (!_hasUsableDoctorRow(entry)) return false;
      const tokens = canonicalName(entry.name || '').split(' ').filter(t => t.length >= 3);
      if (tokens.length < 2 && !/^dr/i.test(entry.name || '')) return false;
      return !_nameExistsInRawText(entry.name || '', rawText);
    });
    if (missing.length) {
      issues.push({
        severity: 'warn',
        issueType: 'name-not-in-source',
        explanation: `${missing.length} extracted doctor row(s) were not found in the source PDF text.`,
        affectedRows: missing.slice(0, 5).map(_summarizeRow),
      });
    }
    return issues;
  }

  function _checkMissingObviousNames(entries=[], rawText='') {
    if (!rawText) return [];
    const sourceNames = _extractSourceNames(rawText);
    const entryNames = new Set(entries.map(entry => canonicalName(entry.name || '')));
    const missing = sourceNames.filter(name => !entryNames.has(canonicalName(name)));
    if (entries.length === 0 && sourceNames.length > 0) {
      return [{
        severity: 'error',
        issueType: 'obvious-names-missed',
        explanation: `Source PDF contains obvious doctor names, but no structured rows were extracted.`,
        affectedRows: sourceNames.slice(0, 5),
      }];
    }
    return [];
  }

  function _allowConsultantOnly(entries=[]) {
    const usable = entries.filter(_hasUsableDoctorRow);
    return usable.length > 0 && usable.every(entry => /consultant/i.test(entry.role || ''));
  }

  function _checkDateColumnMapping(record, entries=[]) {
    if (record.deptKey !== 'medicine_on_call' || !entries.length) return [];
    const byDate = new Map();
    entries.forEach(entry => {
      const key = entry.date || '';
      if (!byDate.has(key)) byDate.set(key, []);
      byDate.get(key).push(entry);
    });
    const issues = [];
    byDate.forEach((rows, dateKey) => {
      if (!dateKey) return;
      const dayER = rows.filter(r => r.section === 'Junior ER' && r.shiftType === 'day');
      const nightER = rows.filter(r => r.section === 'Junior ER' && r.shiftType === 'night');
      const daySenior = rows.filter(r => r.section === 'Senior' && r.shiftType === 'day');
      const nightSenior = rows.filter(r => r.section === 'Senior' && r.shiftType === 'night');
      if (dayER.length > 1 || nightER.length > 1 || daySenior.length > 1 || nightSenior.length > 1) {
        issues.push({
          severity: 'error',
          issueType: 'row-mapping',
          explanation: `Medicine On-Call row mapping is inconsistent for ${dateKey}. Date/column mix detected.`,
          affectedRows: rows.slice(0, 6).map(_summarizeRow),
        });
      }
    });
    return issues;
  }

  function _checkPicuStructuredCoverage(record, entries=[]) {
    if (record.deptKey !== 'picu' || !entries.length) return [];
    const fields = new Set(entries.map(entry => normalizeText(entry.picuField || '')).filter(Boolean));
    const issues = [];
    if (!fields.has('consultant_24h')) {
      issues.push({
        severity: 'error',
        issueType: 'row-mapping',
        explanation: 'PICU consultant 24h row was not extracted from the consultant-specific field.',
        affectedRows: entries.slice(0, 6).map(_summarizeRow),
      });
    }
    if (!fields.has('after_hours_doctor')) {
      issues.push({
        severity: 'error',
        issueType: 'row-mapping',
        explanation: 'PICU after-hours coverage row was not extracted.',
        affectedRows: entries.slice(0, 6).map(_summarizeRow),
      });
    }
    if (!fields.has('resident_24h')) {
      issues.push({
        severity: 'warn',
        issueType: 'missing-tiers',
        explanation: 'PICU 24h primary/resident coverage is missing.',
        affectedRows: entries.slice(0, 6).map(_summarizeRow),
      });
    }
    return issues;
  }

  // ── MULTI-DOCTOR MERGE SUSPICION ─────────────────────────────
  // Detects a name like "Dr. A / Dr. B" or "Ahmad & Khaled" merged into one row
  function _isMergedName(name='') {
    return /\bDr\.?\s+\w+.{0,20}Dr\.?\s+\w+/i.test(name) ||
           /\bDr\.?\s+\w+\s*[\/,&]\s*Dr\.?\s+\w+/i.test(name);
  }

  function _medicineCurrentResolution(record={}, annotatedEntries=[], now=new Date()) {
    if (record.deptKey !== 'medicine_on_call') return { ok:false, rows:[] };
    if (typeof buildNormalizedUploadPayload !== 'function' || typeof isMedicineOnCallCurrentResolutionUsable !== 'function') {
      return { ok:false, rows:[] };
    }
    const normalized = buildNormalizedUploadPayload({
      deptKey: record.deptKey,
      fileName: record.name || '',
      entries: annotatedEntries,
      parseDebug: record.parseDebug || { parserMode:'specialized', templateDetected:true },
      rawText: record.rawText || record.textSample || '',
    });
    return isMedicineOnCallCurrentResolutionUsable(normalized, now);
  }

  // ── CHANGE DETECTION (old vs new record) ─────────────────────
  function _diffRecords(oldRecord, newRecord) {
    const issues = [];
    if (!oldRecord || !oldRecord.entries) return issues;

    const oldCount  = oldRecord.entries.length;
    const newCount  = newRecord.entries.length;

    // Significant drop in doctor rows
    if (oldCount > 0 && newCount < oldCount * 0.6) {
      issues.push({
        severity: 'error',
        issueType: 'data-loss',
        explanation: `Doctor rows dropped from ${oldCount} to ${newCount} (lost ${oldCount - newCount}). Possible parsing regression or wrong file.`,
      });
    }

    // Check if old consultants are still present
    const oldConsultants = new Set(
      oldRecord.entries
        .filter(e => /consultant/i.test(e.role))
        .map(e => canonicalName(e.name))
    );
    const newNames = new Set(newRecord.entries.map(e => canonicalName(e.name)));
    const lost = [...oldConsultants].filter(n => n && !newNames.has(n));
    if (lost.length) {
      issues.push({
        severity: 'warn',
        issueType: 'missing-consultant',
        explanation: `Consultant(s) from previous version not found in new parse: ${lost.slice(0,3).join(', ')}`,
      });
    }

    return issues;
  }

  // ── CORE AUDIT FUNCTION ───────────────────────────────────────
  // Called immediately after parsing, before saveActivePdfRecord.
  // Returns: { approved, confidence, issues, annotatedEntries }
  //   approved=false → do not make searchable
  async function auditParsedRecord(record, oldRecord = null) {
    const { deptKey, name: fileName, entries = [], textSample = '', specialtyLabel = '', specialtyUncertain, rawText = '' } = record;
    const issues = [];
    const noCoverageOnly = entries.length > 0 && entries.every(isNoCoverageEntry);
    const usableEntries = entries.filter(_hasUsableDoctorRow);
    const sourceText = rawText || textSample || '';
    const isRadiology = _isRadiologySpecialty(deptKey);

    // Clear previous issues for this file so we don't double-count
    _clearForFile(fileName);

    // ── 1. Uploaded file verification ────────────────────────────
    if (!sourceText || sourceText.trim().length < 50) {
      issues.push({ severity: 'error', issueType: 'empty-pdf', explanation: 'PDF produced no readable text. May be scanned/image-only or corrupted.' });
    }

    if (!entries.length) {
      issues.push({ severity: 'error', issueType: 'no-rows', explanation: 'Zero doctor rows extracted. Parsing failed or PDF has unexpected format.' });
    }
    if (entries.length > 0 && !usableEntries.length && !noCoverageOnly) {
      issues.push({ severity: 'error', issueType: 'zero-usable-rows', explanation: 'Rows were extracted but none contained usable doctor data.' });
    }
    issues.push(..._checkMissingObviousNames(entries, sourceText));
    if (deptKey === 'radiology_duty') {
      issues.push(..._checkRadiologyDutyTemplateCoverage(entries, sourceText));
    }

    // ── 2. Specialty label validation ────────────────────────────
    if (specialtyUncertain) {
      issues.push({ severity: 'warn', issueType: 'uncertain-specialty', explanation: `Specialty detected with low confidence. Detected as "${deptKey}". Verify manually.` });
    }
    if (_isNoisyLabel(specialtyLabel)) {
      const cleaned = _normalizeSpecialtyLabel(specialtyLabel);
      issues.push({ severity: 'warn', issueType: 'noisy-label', explanation: `Specialty label "${specialtyLabel}" looks noisy or messy. Suggested: "${cleaned}"` });
    }

    // ── 3. Row-level validation ───────────────────────────────────
    const annotatedEntries = entries.map(entry => {
      const rowIssues = [];
      const confidence = isNoCoverageEntry(entry) ? 'high' : scoreRow(entry);

      if (isNoCoverageEntry(entry)) {
        return { ...entry, _confidence: confidence, _rowIssues: rowIssues };
      }

      if (!entry.name || entry.name.length < 2) {
        rowIssues.push({ field: 'name', msg: 'Missing doctor name' });
      }
      if (_isMergedName(entry.name || '')) {
        rowIssues.push({ field: 'name', msg: 'Possible merged doctors — row may need splitting' });
      }
      if (!entry.role || entry.role.length < 2) {
        rowIssues.push({ field: 'role', msg: 'Missing role' });
      }
      if (!entry.phone && !entry.phoneUncertain) {
        rowIssues.push({ field: 'phone', msg: 'No phone number found or inferred' });
      }
      if (entry.phone && !/^05\d{8}$/.test(entry.phone)) {
        rowIssues.push({ field: 'phone', msg: `Phone format unexpected: ${entry.phone}` });
      }

      return { ...entry, _confidence: confidence, _rowIssues: rowIssues };
    });

    const usableAnnotated = annotatedEntries.filter(_hasUsableDoctorRow);
    const lowConfidenceCount  = usableAnnotated.filter(e => e._confidence === 'low').length;
    const medConfidenceCount  = usableAnnotated.filter(e => e._confidence === 'medium').length;
    const mergedCount         = usableAnnotated.filter(e => _isMergedName(e.name || '')).length;
    const noPhoneCount        = usableAnnotated.filter(e => !e.phone).length;
    const weakPhoneRows       = _findWeakPhones(usableAnnotated);

    if (lowConfidenceCount > 0) {
      issues.push({
        severity: 'warn',
        issueType: 'low-confidence-rows',
        explanation: `${lowConfidenceCount} row(s) have low confidence and should be reviewed before trust.`,
        affectedRows: usableAnnotated.filter(e => e._confidence === 'low').slice(0, 5).map(_summarizeRow),
      });
    }
    if (mergedCount > 0) {
      issues.push({
        severity: 'warn',
        issueType: 'merged-names',
        explanation: `${mergedCount} row(s) may contain merged doctor names (e.g. "Dr. A / Dr. B" in one row).`,
        affectedRows: usableAnnotated.filter(e => _isMergedName(e.name || '')).slice(0, 5).map(_summarizeRow),
      });
    }
    if (usableAnnotated.length > 0 && noPhoneCount === usableAnnotated.length) {
      issues.push({ severity: 'warn', issueType: 'all-missing-phones', explanation: 'No phone numbers found for any row. Contact matching may be incomplete.' });
    }
    if (weakPhoneRows.length > 0) {
      issues.push({
        severity: 'warn',
        issueType: 'weak-phone-match',
        explanation: `${weakPhoneRows.length} row(s) have weak or uncertain phone matching.`,
        affectedRows: weakPhoneRows.slice(0, 5).map(_summarizeRow),
      });
    }

    // ── 4. Missing tier detection ─────────────────────────────────
    if (isRadiology) {
      issues.push(..._checkRadiologySectionMapping(usableAnnotated, deptKey));
    } else {
      const missingTiers = (noCoverageOnly || _allowConsultantOnly(usableAnnotated)) ? [] : _checkMissingTiers(deptKey, usableAnnotated);
      if (missingTiers.length) {
        issues.push({
          severity: 'warn',
          issueType: 'missing-tiers',
          explanation: `Expected role tiers not found: ${missingTiers.join(', ')}. Source PDF may have these roles — check if parsing captured them.`,
        });
      }
      if (!noCoverageOnly && _checkConsultantTierGap(usableAnnotated)) {
        issues.push({
          severity: 'warn',
          issueType: 'consultant-gap',
          explanation: 'Consultant is present while earlier tiers appear to be missing. Verify 1st/resident coverage extraction.',
          affectedRows: usableAnnotated.filter(e => /consultant/i.test(e.role || '')).slice(0, 3).map(_summarizeRow),
        });
      }
    }

    // ── 5. Duplicate detection ────────────────────────────────────
    const dupes = _findDuplicates(usableAnnotated);
    if (dupes.length) {
      issues.push({
        severity: 'warn',
        issueType: 'duplicates',
        explanation: `${dupes.length} duplicate row(s) detected (same name + date + role).`,
        affectedRows: dupes.slice(0, 5).map(pair => _summarizeRow(usableAnnotated[pair.b] || usableAnnotated[pair.a] || {})),
      });
    }

    // ── 6. Change detection vs previous record ────────────────────
    if (oldRecord) {
      const changeIssues = _diffRecords(oldRecord, { ...record, entries: annotatedEntries });
      issues.push(...changeIssues);
    }
    issues.push(..._checkRawTextAlignment(usableAnnotated, sourceText));
    issues.push(..._checkDateColumnMapping(record, usableAnnotated));
    issues.push(..._checkPicuStructuredCoverage(record, usableAnnotated));

    if (noCoverageOnly) {
      issues.push({ severity: 'info', issueType: 'no-coverage', explanation: 'PDF explicitly indicates no coverage for this schedule.' });
    }

    // ── Push all issues to review queue ──────────────────────────
    issues.forEach(issue => _push({ specialty: deptKey, fileName, ...issue }));

    // ── Approval decision ─────────────────────────────────────────
    // High confidence => publish, medium => publish with warnings, low => review only
    const hardErrors = issues.filter(_isHardBlockIssue);
    const approved   = hardErrors.length === 0;

    // Overall record confidence
    const totalRows = usableAnnotated.length;
    const highCount = usableAnnotated.filter(e => e._confidence === 'high').length;
    const mediumOrHighCount = usableAnnotated.filter(e => e._confidence !== 'low').length;
    let overallConfidence = noCoverageOnly ? 'high'
      : totalRows === 0 ? 'low'
      : highCount / totalRows >= 0.7 ? 'high'
      : mediumOrHighCount / totalRows >= 0.6 ? 'medium'
      : 'low';
    const medicineResolution = _medicineCurrentResolution(record, usableAnnotated);
    if (deptKey === 'medicine_on_call' && approved && medicineResolution.ok && overallConfidence === 'low') {
      overallConfidence = 'medium';
      issues.push({
        severity: 'info',
        issueType: 'medicine-current-roles-resolved',
        explanation: 'Medicine current active ER roles resolved successfully, so activation can proceed despite weaker row confidence.',
        affectedRows: (medicineResolution.rows || []).slice(0, 4).map(_summarizeRow),
      });
    }
    const publishable = approved && (overallConfidence !== 'low' || (deptKey === 'medicine_on_call' && medicineResolution.ok));

    _setDeptVerified(deptKey, publishable || noCoverageOnly, hardErrors.length > 0, 'upload-audit');
    return { approved, publishable, overallConfidence, issues, annotatedEntries };
  }

  // ── STARTUP AUDIT (runs on all stored records) ────────────────
  async function auditAllStoredRecords() {
    let allRecords = [];
    try { allRecords = await getAllPdfRecords(); } catch (e) { return; }
    const now     = new Date();
    const schedKey = fmtKey(now);

    for (const record of allRecords) {
      const { deptKey, entries = [], name: fileName, parsedActive } = record;
      _clearForFile(fileName);
      let hardBlocked = !parsedActive;
      _setDeptVerified(deptKey, !!parsedActive, hardBlocked, 'stored-record');

      // Uploaded but not activated
      if (!parsedActive) {
        _push({ specialty: deptKey, fileName, severity: 'warn', issueType: 'not-activated', explanation: 'Record is stored but not marked active. It will not appear in search.' });
        continue;
      }

      // Zero rows
      if (!entries.length) {
        hardBlocked = true;
        _push({ specialty: deptKey, fileName, severity: 'error', issueType: 'no-rows', explanation: 'Active record has zero doctor rows — parsing must have failed.' });
      }

      // Not appearing on homepage
      if (deptKey && !ROTAS[deptKey]) {
        _push({ specialty: deptKey, fileName, severity: 'error', issueType: 'missing-from-rotas', explanation: `Specialty "${deptKey}" is not registered in ROTAS. Will not appear on homepage or in search.` });
      }

      // Missing tiers for today's date
      const todayEntries = entries.filter(e => !e.date || e.date === schedKey);
      const noCoverageOnly = entries.length > 0 && entries.every(isNoCoverageEntry);
      if (_isRadiologySpecialty(deptKey)) {
        const radiologyIssues = _checkRadiologySectionMapping(todayEntries.length ? todayEntries : entries, deptKey);
        radiologyIssues.forEach(issue => _push({ specialty: deptKey, fileName, ...issue }));
        hardBlocked = hardBlocked || radiologyIssues.some(_isHardBlockIssue);
        _setDeptVerified(deptKey, !hardBlocked, hardBlocked, 'stored-record');
      } else {
        const missingTiers = noCoverageOnly ? [] : _checkMissingTiers(deptKey, todayEntries.length ? todayEntries : entries);
        if (missingTiers.length && entries.length > 0) {
          _push({ specialty: deptKey, fileName, severity: 'warn', issueType: 'missing-tiers', explanation: `Missing expected role tiers: ${missingTiers.join(', ')}` });
        }
        _setDeptVerified(deptKey, !hardBlocked, hardBlocked, 'stored-record');
      }

      // All low-confidence
      const lowCount = entries.filter(e => e._confidence && e._confidence === 'low').length;
      if (lowCount > 0 && lowCount === entries.length) {
        _push({ specialty: deptKey, fileName, severity: 'warn', issueType: 'all-low-confidence', explanation: 'All rows have low confidence. Data quality is poor.' });
      }
    }
  }

  // ── SYSTEM-LEVEL CHECKS (cross-specialty) ────────────────────
  // Checks rotas.js entries for zero schedules, empty contacts, etc.
  async function auditSystemState() {
    // Specialties in ROTAS with no schedule entries at all
    Object.entries(ROTAS).forEach(([key, dept]) => {
      if (dept.aggregateOnly || dept.hidden || dept.uploadedOnly) return;
      const scheduleEntryCount = Object.values(dept.schedule || {})
        .reduce((sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0), 0);
      if (scheduleEntryCount === 0 && !dept.duty_consultants) {
        _push({
          specialty: key,
          fileName: '(static data)',
          severity: 'warn',
          issueType: 'empty-schedule',
          explanation: `"${dept.label}" has no schedule entries in rotas.js. Upload a PDF to activate it.`,
        });
      }
    });

    // Specialties on homepage priority but not in ROTAS at all
    HOMEPAGE_PRIORITY.forEach(key => {
      if (!ROTAS[key]) {
        _push({
          specialty: key,
          fileName: '(system)',
          severity: 'warn',
          issueType: 'missing-from-rotas',
          explanation: `"${key}" appears in HOMEPAGE_PRIORITY but is not defined in ROTAS.`,
        });
      }
    });
  }

  async function auditAllExistingSpecialties() {
    _clearByPredicate(item => item.fileName === '(source audit)');
    const now = new Date();
    const schedKey = fmtKey(getScheduleDate(now).date);
    for (const [deptKey, dept] of Object.entries(ROTAS)) {
      if (dept.aggregateOnly || dept.hidden || dept.uploadedOnly) continue;
      const baseEntries = deptKey === 'radiology_duty' || deptKey === 'radiology_oncall'
        ? getEntries(deptKey, dept, schedKey, now, '')
        : ((dept.schedule && dept.schedule[schedKey]) || []);
      const entries = Array.isArray(baseEntries) ? baseEntries : [];
      const rawText = await getRawPdfTextForDept(deptKey);
      const issues = [];
      const usableEntries = entries.filter(_hasUsableDoctorRow);
      const noCoverageOnly = entries.length > 0 && entries.every(isNoCoverageEntry);
      if (!entries.length && !noCoverageOnly) {
        _setDeptVerified(deptKey, true, false, 'source-audit');
        continue;
      }
      if (!noCoverageOnly) {
        issues.push(..._checkMissingObviousNames(entries, rawText));
        issues.push(..._checkRawTextAlignment(usableEntries, rawText));
        if (_isRadiologySpecialty(deptKey)) {
          if (deptKey === 'radiology_duty') {
            issues.push(..._checkRadiologyDutyTemplateCoverage(entries, rawText));
          }
          issues.push(..._checkRadiologySectionMapping(usableEntries, deptKey));
        } else {
          const missingTiers = _allowConsultantOnly(usableEntries) ? [] : _checkMissingTiers(deptKey, usableEntries);
          if (missingTiers.length) {
            issues.push({
              severity: 'warn',
              issueType: 'missing-tiers',
              explanation: `Missing expected role tiers for ${schedKey}: ${missingTiers.join(', ')}`,
              affectedRows: usableEntries.slice(0, 5).map(_summarizeRow),
            });
          }
          if (_checkConsultantTierGap(usableEntries)) {
            issues.push({
              severity: 'warn',
              issueType: 'consultant-gap',
              explanation: 'Consultant is shown while earlier tiers appear to be missing.',
              affectedRows: usableEntries.filter(e => /consultant/i.test(e.role || '')).slice(0, 3).map(_summarizeRow),
            });
          }
        }
        issues.push(..._checkDateColumnMapping({ deptKey }, usableEntries));
      }
      const hardBlocked = issues.some(_isHardBlockIssue);
      const passed = !hardBlocked;
      _setDeptVerified(deptKey, passed || noCoverageOnly, hardBlocked, 'source-audit');
      issues.forEach(issue => _push({ specialty: deptKey, fileName: '(source audit)', ...issue }));
    }
  }

  // ── REVIEW PANEL RENDERER ─────────────────────────────────────
  const SEVERITY_ICON = { error: '🔴', warn: '🟡', info: '🔵' };
  const ISSUE_LABELS = {
    'no-rows':             'No Rows',
    'zero-usable-rows':    'Zero Usable Rows',
    'empty-pdf':           'Empty PDF',
    'uncertain-specialty': 'Specialty Uncertain',
    'noisy-label':         'Noisy Label',
    'not-activated':       'Not Activated',
    'missing-from-rotas':  'Not in System',
    'missing-tiers':       'Missing Tiers',
    'consultant-gap':      'Consultant Gap',
    'low-confidence-rows': 'Low Confidence',
    'all-low-confidence':  'All Low Confidence',
    'all-missing-phones':  'No Phones',
    'weak-phone-match':    'Weak Phone Match',
    'name-not-in-source':  'Name Not In Source',
    'obvious-names-missed':'Names Missed',
    'row-mapping':         'Row Mapping',
    'template-sections-missing':'Template Sections Missing',
    'merged-names':        'Merged Names',
    'duplicates':          'Duplicates',
    'data-loss':           'Data Loss',
    'missing-consultant':  'Missing Consultant',
    'empty-schedule':      'Empty Schedule',
    'no-coverage':         'No Coverage',
    'golden-failed':       'Golden Test Failed',
  };

  function renderReviewPanel() {
    const panel = document.getElementById('auditor-panel');
    if (!panel) return;

    if (!_queue.length) {
      panel.innerHTML = '<div style="color:var(--text-3,#888);padding:10px;font-size:13px;">✅ No issues detected.</div>';
      return;
    }

    const bySpecialty = {};
    _queue.forEach(item => {
      const key = item.specialty || 'unknown';
      if (!bySpecialty[key]) bySpecialty[key] = [];
      bySpecialty[key].push(item);
    });

    const errorCount = _queue.filter(i => i.severity === 'error').length;
    const warnCount  = _queue.filter(i => i.severity === 'warn').length;

    let html = `<div style="font-size:12px;color:var(--text-3,#888);margin-bottom:10px;">
      ${errorCount > 0 ? `<span style="color:var(--red,#ff5252);font-weight:600;">🔴 ${errorCount} error${errorCount>1?'s':''}</span>&nbsp;&nbsp;` : ''}
      ${warnCount > 0  ? `<span style="color:var(--amber,#ffab40);font-weight:600;">🟡 ${warnCount} warning${warnCount>1?'s':''}</span>` : ''}
    </div>`;

    Object.entries(bySpecialty)
      .sort((a,b) => {
        const aHasError = a[1].some(i=>i.severity==='error') ? 0 : 1;
        const bHasError = b[1].some(i=>i.severity==='error') ? 0 : 1;
        return aHasError - bHasError || a[0].localeCompare(b[0]);
      })
      .forEach(([spec, items]) => {
        const dept   = ROTAS[spec];
        const icon   = dept?.icon || '📋';
        const label  = dept?.label?.split(' / ')[0] || spec;
        const hasErr = items.some(i => i.severity === 'error');

        html += `<div style="margin-bottom:10px;border:1px solid ${hasErr ? 'rgba(255,82,82,0.3)' : 'rgba(255,171,64,0.25)'};border-radius:8px;overflow:hidden;">
          <div style="background:${hasErr ? 'rgba(255,82,82,0.08)' : 'rgba(255,171,64,0.07)'};padding:7px 12px;font-size:13px;font-weight:600;display:flex;align-items:center;gap:8px;">
            <span>${icon}</span><span>${escapeHtml(label)}</span>
            <span style="margin-left:auto;font-weight:400;font-size:11px;color:var(--text-3,#888);">${items.length} issue${items.length>1?'s':''}</span>
          </div>`;

        items.forEach(item => {
          const sev  = SEVERITY_ICON[item.severity] || '⚪';
          const lbl  = ISSUE_LABELS[item.issueType] || item.issueType;
          const file = item.fileName && item.fileName !== '(static data)' && item.fileName !== '(system)'
            ? `<span style="font-size:10px;color:var(--text-3,#888);display:block;margin-top:2px;">${escapeHtml(item.fileName)}</span>`
            : '';
          const rows = Array.isArray(item.affectedRows) && item.affectedRows.length
            ? `<div style="margin-top:5px;color:var(--text-3,#888);font-size:11px;">Affected: ${item.affectedRows.map(escapeHtml).join(' · ')}</div>`
            : '';
          html += `<div style="padding:7px 12px 7px 16px;border-top:1px solid rgba(255,255,255,0.05);font-size:12px;">
            <div style="display:flex;align-items:flex-start;gap:6px;">
              <span style="flex-shrink:0;margin-top:1px;">${sev}</span>
              <div>
                <span style="font-weight:600;">${escapeHtml(lbl)}</span>
                — <span style="color:var(--text-2,#bbb);">${escapeHtml(item.explanation)}</span>
                ${file}
                ${rows}
              </div>
            </div>
          </div>`;
        });

        html += `</div>`;
      });

    panel.innerHTML = html;
  }

  // ── PUBLIC API ────────────────────────────────────────────────
  return {
    auditParsedRecord,
    auditAllStoredRecords,
    auditSystemState,
    auditAllExistingSpecialties,
    runGoldenTests,
    runRealPdfFixtureTests,
    runUploadPipelineFixtureTests,
    runRegressionSuite,
    validateRealPdfFixture,
    renderReviewPanel,
    getQueue: () => [..._queue],
    getGoldenResults: () => new Map(_goldenResults),
    getRegressionFixtures: () => ({ ...BUG_REGRESSION_FIXTURES }),
    getRegressionValidators: () => ({ ...REGRESSION_VALIDATORS }),
    clearQueue: () => { _queue.length = 0; _renderQueueBadge(); },
    scoreRow,
  };

})();
