// ═══════════════════════════════════════════════════════════════
// UI · SEARCH — search logic, tag rendering, welcome grid, dept matching
// Extracted from app.js (Sprint 6)
// Depends on: core/time.js, core/phone-resolver.js, ui/card.js, ui/pdf-preview.js,
//             app.js (getEntries, isImagingDeptKey, getRadiologyForcedBannerHtml, etc.)
// ═══════════════════════════════════════════════════════════════

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
  { test:q => hasAnyToken(q, ['ct','mri']) && hasAnyToken(q, ['brain','head','neuro','stroke']), deptKeys:['radiology_duty'], roleIncludes:['NEURO','Neuro'] },
  { test:q => hasAnyToken(q, ['us','ultrasound','sono','sonar']) && hasAnyToken(q, ['msk','musculoskeletal']), deptKeys:['radiology_duty'], roleIncludes:['MSK'] },
  { test:q => hasAnyToken(q, ['us','ultrasound','sono','sonar']) && hasAnyToken(q, ['abd','abdomen','abdominal']), deptKeys:['radiology_duty'], roleIncludes:['Abdomen','Ultrasound'] },
  { test:q => hasAnyToken(q, ['us','ultrasound','sono','sonar']) || hasAnyPhrase(q, ['سونار','التراساوند','ألتراساوند']), deptKeys:['radiology_duty'], roleIncludes:['Ultrasound','MSK','Abdomen'] },
  { test:q => hasAnyToken(q, ['ct','mri']) && hasAnyToken(q, ['abd','abdomen','abdominal']), deptKeys:['radiology_duty'], roleIncludes:['ABDOMEN','Abdomen','BODY'] },
  { test:q => hasAnyPhrase(q, ['pet','pet ct','pet-ct','nuclear','nuc med','نووي']), deptKeys:['radiology_duty'], roleIncludes:['NUCLEAR','Nuclear'] },
  { test:q => hasAnyToken(q, ['ct','mri','radiology','imaging','scan','xray','misc']) || hasAnyPhrase(q, ['x-ray','اشعة','أشعة']), deptKeys:['radiology_duty'], roleIncludes:['CT','MRI','X-Ray','Neuro','BODY','THORACIC','MSK','PEDIATRIC','BREAST','Abdomen','Ultrasound'] },
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

// When set, a radiology icon/card click should show that clicked mode only.
let imagingIconForced = '';
// Sprint 4 (M1): render generation counter — prevents concurrent render interleaving
let _renderGeneration = 0;

async function renderDeptList(matched, qLow, exactMode=false) {
  const myGeneration = ++_renderGeneration;
  const now = new Date();
  // Sprint 4 (M2): capture imaging mode at call time, not from global mid-render
  const capturedImagingForced = imagingIconForced;
  const isImagingIconMode = capturedImagingForced === 'radiology_duty' || capturedImagingForced === 'radiology_oncall';
  if (!isImagingIconMode) {
    matched = normalizeMatchedForActiveShift(matched, now, qLow, exactMode);
  }
  const { date: schedDate, isOvernight } = getScheduleDate(now);
  const schedKey = fmtKey(schedDate);
  const displayKey = fmtKey(now);
  const results = document.getElementById('results');
  const cards = document.getElementById('cards');
  const rcount = document.getElementById('rcount');
  cards.innerHTML = '<div class="empty" style="text-align:center;padding:18px 12px;font-size:13px;color:var(--text-2,#aaa);">Loading…</div>';
  results.classList.add('show');
  await uploadedSpecialtiesReadyPromise.catch(() => null);
  if (myGeneration !== _renderGeneration) return; // stale render — abort

  if (isImagingIconMode) {
    matched = [[capturedImagingForced, ROTAS[capturedImagingForced]]];
  }

  cards.innerHTML = '';
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

  if (isImagingIconMode) {
    const warn = document.createElement('div');
    warn.className = 'upload-debug';
    warn.style.cssText = 'background:rgba(255,200,0,0.13);border:1px solid rgba(255,200,0,0.4);color:#ffe066;border-radius:8px;padding:10px 14px;margin-bottom:12px;font-size:13px;';
    warn.innerHTML = getRadiologyForcedBannerHtml(capturedImagingForced, now);
    cards.appendChild(warn);
  }

  const smart = exactMode ? null : findSmartIntent(qLow);
  for (const [k, d] of matched) {
    await ensureDeptSupportReady(k);
    if (myGeneration !== _renderGeneration) return; // stale render — abort
    let entries;
    if (isImagingIconMode) {
      if (capturedImagingForced === 'radiology_oncall') {
        const shift = getSpecialtyCurrentShiftMeta('radiology_oncall', now);
        // Always show on-call names when icon is clicked — user wants to know who's on-call tonight
        entries = getEntries('radiology_oncall', ROTAS.radiology_oncall, schedKey, now, '');
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
    entries = sortEntries(entries, k);
    lastPreviewContextByDept.set(k, getPdfPreviewContext(k, entries, qLow));
    cards.appendChild(await buildCard(k, d, entries));
    if (myGeneration !== _renderGeneration) return; // stale render — abort
  }
  // Manual "عرض داخل الصفحة" button → open PDF and scroll to it
  cards.querySelectorAll('[data-preview]').forEach(btn => btn.addEventListener('click', () => showPdfPreview(btn.dataset.preview, lastPreviewContextByDept.get(btn.dataset.preview) || null, true)));
  cards.querySelectorAll('[data-exact-specialty]').forEach(btn => btn.addEventListener('click', () => {
    showExactDept(btn.dataset.exactSpecialty);
  }));
  cards.querySelectorAll('[data-copy-phone]').forEach(btn => btn.addEventListener('click', () => copyPhoneNumber(btn.dataset.copyPhone, btn)));
  results.classList.add('show');

  // Auto-open PDF when a specialty is shown in exact (icon-click) mode.
  // showPdfPreview is a no-op when no PDF exists for a specialty.
  // scrollToPdf=false so the view stays on the names list, not the PDF.
  if (exactMode && matched.length === 1) {
    const [[autoKey]] = matched;
    showPdfPreview(autoKey, lastPreviewContextByDept.get(autoKey) || null, false);
  }

  // Scroll to the results/names section on icon-click, not to the PDF.
  if (exactMode) {
    results.scrollIntoView({behavior: 'smooth', block: 'start'});
  }
}

async function showExactDept(deptKey) {
  closePdfPreview();
  if (typeof trackClick === 'function') trackClick(deptKey);
  const welcome = document.getElementById('welcome');
  welcome.style.display = 'none';
  const dept = ROTAS[deptKey];
  if (!dept) return;
  if (deptKey === 'radiology_duty' || deptKey === 'radiology_oncall') {
    imagingIconForced = deptKey;
  } else {
    imagingIconForced = '';
  }
  document.getElementById('search').value = deptKey;
  return renderDeptList([[deptKey, dept]], deptKey, true);
}

const TAG_LIST = [
  ['medicine_on_call','Medicine On-Call'],
  ['hospitalist','Hospitalist'],
  ['surgery','Surgery'],
  ['pediatrics','Pediatrics'],
  ['ent','ENT'],
  ['orthopedics','Orthopedics'],
  ['radiology_oncall','Imaging On-Call'],
  ['radiology_duty','Imaging On-Duty'],
  ['palliative','Palliative'],
  ['neurology','Neurology'],
  ['neurosurgery','Neurosurgery'],
  ['spine','Spine'],
  ['gynecology','Gynecology'],
  ['critical_care','ICU'],
  ['picu','PICU'],
  ['anesthesia','Anesthesia'],
  ['psychiatry','Psychiatry'],
  ['pediatric_neurology','Ped Neuro'],
  ['pediatric_cardiology','Ped Cardio'],
  ['pediatric_heme_onc','Ped Heme-Onc'],
  ['neuro_ir','Neuro IR'],
  ['urology','Urology'],
  ['ophthalmology','Eye'],
  ['oncology','Oncology'],
  ['hematology','Heme-Onco'],
  ['radonc','Rad-Onc'],
  ['nephrology','Nephrology'],
  ['kptx','Kidney-Tx'],
  ['liver','Liver-Tx'],
  ['adult_cardiology','Cardiology'],
  ['medicine','Medicine'],
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

const HIDDEN_BY_DEFAULT_KEYS = new Set([
  'clinical_lab','physical_medicine_rehabilitation','endocrinology',
  'rheumatology','radonc','neuro_ir','pediatric_neurology',
  'pediatric_cardiology','pulmonary',
]);

let _expanderOpen = false;

function renderTags() {
  ensureCoreAggregateSpecialties();
  const tagsEl = document.getElementById('tags');
  tagsEl.innerHTML = '';

  const makeTag = (k, lbl, extraClass) => {
    const t = document.createElement('span');
    t.className = 'tag' + (extraClass ? ' ' + extraClass : '');
    t.textContent = lbl;
    t.onclick = () => {
      document.getElementById('search').value = k;
      document.querySelectorAll('.tag').forEach(x => x.classList.remove('on'));
      t.classList.add('on');
      showExactDept(k);
    };
    return t;
  };

  // Always-visible tags
  TAG_LIST.filter(([k]) => ROTAS[k] && !HIDDEN_BY_DEFAULT_KEYS.has(k)).forEach(([k, lbl]) => {
    tagsEl.appendChild(makeTag(k, lbl));
  });

  // Expander button
  const expander = document.createElement('span');
  expander.className = 'tag tag-expander';
  expander.textContent = _expanderOpen ? '−' : '+';
  expander.title = _expanderOpen ? 'Show less' : 'Show more specialties';
  expander.onclick = () => { _expanderOpen = !_expanderOpen; renderTags(); };
  tagsEl.appendChild(expander);

  // Hidden tags (only when expanded)
  if (_expanderOpen) {
    TAG_LIST.filter(([k]) => ROTAS[k] && HIDDEN_BY_DEFAULT_KEYS.has(k)).forEach(([k, lbl]) => {
      tagsEl.appendChild(makeTag(k, lbl));
    });

    // Uploaded-only specialties
    activeDeptEntries()
      .filter(([k, dept]) => dept.uploadedOnly && !TAG_LIST.some(([tagKey]) => tagKey === k))
      .sort((a, b) => (a[1].label || '').localeCompare(b[1].label || ''))
      .forEach(([k, d]) => {
        tagsEl.appendChild(makeTag(k, d.label));
      });

    // Custom specialties (fetched from server)
    if (window._customSpecialties && window._customSpecialties.length) {
      window._customSpecialties.forEach(cs => {
        const t = makeTag(cs.key, cs.display_name);
        t.style.borderStyle = 'dashed';
        tagsEl.appendChild(t);
      });
    }
  }
}

// Fetch custom specialties on load
(function fetchCustomSpecialties() {
  fetch('/api/monitoring?action=custom-specialties').then(r => r.ok ? r.json() : []).then(data => {
    window._customSpecialties = data || [];
  }).catch(() => { window._customSpecialties = []; });
})();

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

async function search(q) {
  ensureCoreAggregateSpecialties();
  await uploadedSpecialtiesReadyPromise.catch(() => null);
  imagingIconForced = '';
  const qLow = q.trim().toLowerCase();
  if (qLow === '000') {
    const monthBtn = document.getElementById('month-checklist-toggle');
    const auditBtn = document.getElementById('auditor-toggle');
    if (monthBtn) monthBtn.style.display = '';
    if (auditBtn) auditBtn.style.display = '';
    document.getElementById('search').value = '';
    return;
  }
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
