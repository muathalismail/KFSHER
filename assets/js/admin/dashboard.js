// ═══════════════════════════════════════════════════════════════
// admin/dashboard.js — Fetch Supabase data + render specialty cards
// ═══════════════════════════════════════════════════════════════

const SPECIALTY_META = {
  radiology:             { label: 'Radiology / الأشعة',               icon: '📡' },
  radiology_oncall:      { label: 'Radiology On-Call / أشعة المناوبة', icon: '📡' },
  urology:               { label: 'Urology / المسالك البولية',        icon: '🫘' },
  medicine:              { label: 'Medicine / الباطنة',               icon: '🩺' },
  surgery:               { label: 'Surgery / الجراحة',                icon: '🔪' },
  ent:                   { label: 'ENT / أنف وأذن',                   icon: '👂' },
  ophthalmology:         { label: 'Ophthalmology / العيون',            icon: '👁️' },
  neurology:             { label: 'Neurology / الأعصاب',              icon: '🧠' },
  pediatric_neurology:   { label: 'Pediatric Neurology / أعصاب الأطفال', icon: '🧒' },
  critical_care:         { label: 'Critical Care / العناية المركزة',   icon: '🏥' },
  anesthesia:            { label: 'Anesthesia / التخدير',              icon: '💉' },
  pediatrics:            { label: 'Pediatrics / الأطفال',              icon: '👶' },
  picu:                  { label: 'PICU / عناية أطفال',               icon: '🏥' },
  orthopedics:           { label: 'Orthopedics / العظام',             icon: '🦴' },
  hospitalist:           { label: 'Hospitalist / الإقامة',            icon: '🏨' },
  dental:                { label: 'Dental / الأسنان',                 icon: '🦷' },
  gynecology:            { label: 'Gynecology / النسائية',            icon: '🩷' },
  psychiatry:            { label: 'Psychiatry / النفسية',             icon: '🧠' },
  cardiology:            { label: 'Cardiology / القلب',               icon: '❤️' },
  pediatric_cardiology:  { label: 'Pediatric Cardiology / قلب أطفال', icon: '💗' },
  spine:                 { label: 'Spine Surgery / العمود الفقري',     icon: '🦴' },
  neurosurgery:          { label: 'Neurosurgery / جراحة الأعصاب',     icon: '🧠' },
  neuro_ir:              { label: 'Neuro IR / أشعة تداخلية',          icon: '🧠' },
  palliative:            { label: 'Palliative / الرعاية التلطيفية',   icon: '🕊️' },
  nephrology:            { label: 'Nephrology / الكلى',               icon: '🫘' },
  ped_nephrology:        { label: 'Pediatric Nephrology / كلى أطفال', icon: '🫘' },
  hematology:            { label: 'Hematology / الدم',                icon: '🩸' },
  ped_hematology:        { label: 'Ped Hematology / دم أطفال',        icon: '🩸' },
  medical_oncology:      { label: 'Medical Oncology / الأورام',       icon: '🎗️' },
  radiation_oncology:    { label: 'Radiation Oncology / إشعاع',       icon: '☢️' },
  transplant:            { label: 'Transplant / زراعة الأعضاء',       icon: '🫁' },
  liver_transplant:      { label: 'Liver Transplant / زراعة الكبد',   icon: '🫁' },
  kptx:                  { label: 'KPTx / زراعة الكلى',              icon: '🫘' },
  odmt:                  { label: 'ODMT',                              icon: '🏥' },
  lab:                   { label: 'Laboratory / المختبر',             icon: '🔬' },
  medical_physics:       { label: 'Medical Physics / فيزياء طبية',    icon: '⚛️' },
  physical_medicine:     { label: 'Physical Medicine / تأهيل',        icon: '🏋️' },
  pem:                   { label: 'PEM / طوارئ أطفال',               icon: '🚑' },
  emd:                   { label: 'EMD / الطوارئ',                    icon: '🚨' },
  ssd:                   { label: 'SSD',                               icon: '🏥' },
  imaging_on_duty:       { label: 'Imaging On-Duty / الأشعة المناوبة', icon: '📡' },
};

function labelFor(key) {
  return SPECIALTY_META[key]?.label || key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function iconFor(key) {
  return SPECIALTY_META[key]?.icon || '📋';
}

async function fetchAllRecords() {
  const resp = await fetch('/api/records');
  if (!resp.ok) throw new Error(`API error: ${resp.status}`);
  return resp.json();
}

function groupBySpecialty(records) {
  const grouped = {};
  for (const rec of records) {
    const key = rec.specialty || rec.data?.deptKey || 'unknown';
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(rec);
  }
  // Sort each group by created_at desc
  for (const key of Object.keys(grouped)) {
    grouped[key].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }
  return grouped;
}

function analyzeSpecialty(key, records) {
  const latest = records[0];
  const data = latest.data || {};
  const entries = data.entries || [];
  const doctorNames = new Set();
  let totalDays = 0;

  for (const entry of entries) {
    if (entry.doctor) doctorNames.add(entry.doctor);
    if (entry.entries) {
      for (const sub of entry.entries) {
        if (sub.doctor) doctorNames.add(sub.doctor);
      }
    }
  }
  // Count unique dates
  const dates = new Set(entries.map(e => e.date).filter(Boolean));
  totalDays = dates.size;

  const uploadedAt = data.uploadedAt || new Date(latest.created_at).getTime();
  const parsedActive = data.parsedActive !== false;

  // Calculate trend: compare latest vs previous
  let health = 'green';
  let trend = null;
  if (records.length >= 2) {
    const prev = records[1];
    const prevEntries = prev.data?.entries || [];
    const prevCount = prevEntries.length;
    const currCount = entries.length;
    if (prevCount > 0 && currCount > 0) {
      const change = (currCount - prevCount) / prevCount;
      if (change < -0.3) {
        health = 'red';
        trend = Math.round(change * 100);
      } else if (change < -0.15) {
        health = 'yellow';
        trend = Math.round(change * 100);
      }
    }
  }

  // If no entries at all, mark red
  if (entries.length === 0 && records.length === 1) {
    health = 'yellow';
  }

  // Check for warnings in data
  if (data.normalized?.warnings?.length > 0) {
    if (health === 'green') health = 'yellow';
  }

  return {
    key,
    label: labelFor(key),
    icon: iconFor(key),
    doctorCount: doctorNames.size,
    dayCount: totalDays,
    entryCount: entries.length,
    uploadedAt,
    parsedActive,
    health,
    trend,
    totalUploads: records.length,
    recentUploads: records.slice(0, 5).map(r => ({
      date: r.created_at,
      entries: (r.data?.entries || []).length,
      name: r.data?.name || '',
    })),
  };
}

function renderStatsBar(analyses) {
  const totalSpecialties = analyses.length;
  const totalUploads = analyses.reduce((s, a) => s + a.totalUploads, 0);
  const successCount = analyses.filter(a => a.health === 'green').length;
  const successRate = totalSpecialties > 0 ? Math.round((successCount / totalSpecialties) * 100) : 0;

  document.getElementById('stat-specialties').textContent = totalSpecialties;
  document.getElementById('stat-uploads').textContent = totalUploads;
  document.getElementById('stat-success').textContent = successRate + '%';
}

function timeAgo(ts) {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'الآن';
  if (mins < 60) return `${mins} دقيقة`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} ساعة`;
  const days = Math.floor(hours / 24);
  return `${days} يوم`;
}

function formatDate(isoOrTs) {
  const d = typeof isoOrTs === 'number' ? new Date(isoOrTs) : new Date(isoOrTs);
  if (isNaN(d)) return '—';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${dd}/${mm} ${hh}:${mi}`;
}

function renderSpecialtyCard(analysis) {
  const healthClass = `health-${analysis.health}`;
  const healthDot = analysis.health === 'green' ? '🟢' : analysis.health === 'yellow' ? '🟡' : '🔴';
  const trendBadge = analysis.trend !== null ? `<span class="trend-badge ${analysis.trend < -30 ? 'trend-red' : 'trend-yellow'}">${analysis.trend}%</span>` : '';

  const recentHtml = analysis.recentUploads.map(u => {
    const name = u.name ? `<span class="upload-name">${u.name}</span>` : '';
    return `<div class="upload-row">
      <span class="upload-date">${formatDate(u.date)}</span>
      ${name}
      <span class="upload-entries">${u.entries} entries</span>
    </div>`;
  }).join('');

  return `
  <div class="spec-card ${healthClass}">
    <div class="spec-head">
      <div class="spec-icon">${analysis.icon}</div>
      <div class="spec-info">
        <div class="spec-name">${analysis.label}</div>
        <div class="spec-meta">${healthDot} ${trendBadge} <span class="upload-ago">آخر رفع: ${timeAgo(analysis.uploadedAt)}</span></div>
      </div>
    </div>
    <div class="spec-stats">
      <div class="spec-stat">
        <span class="spec-stat-val">${analysis.doctorCount}</span>
        <span class="spec-stat-lbl">أطباء</span>
      </div>
      <div class="spec-stat">
        <span class="spec-stat-val">${analysis.dayCount}</span>
        <span class="spec-stat-lbl">أيام</span>
      </div>
      <div class="spec-stat">
        <span class="spec-stat-val">${analysis.entryCount}</span>
        <span class="spec-stat-lbl">إدخالات</span>
      </div>
      <div class="spec-stat">
        <span class="spec-stat-val">${analysis.totalUploads}</span>
        <span class="spec-stat-lbl">رفعات</span>
      </div>
    </div>
    ${analysis.recentUploads.length > 0 ? `
    <div class="spec-recent">
      <div class="spec-recent-title">آخر الرفعات</div>
      ${recentHtml}
    </div>` : ''}
  </div>`;
}

async function loadDashboard() {
  const loading = document.getElementById('dashboard-loading');
  const grid = document.getElementById('specialty-grid');
  loading.classList.add('active');
  grid.innerHTML = '';

  try {
    const records = await fetchAllRecords();
    const grouped = groupBySpecialty(records);
    const analyses = Object.entries(grouped)
      .map(([key, recs]) => analyzeSpecialty(key, recs))
      .sort((a, b) => {
        // Sort: red first, then yellow, then green. Within same health, by uploadedAt desc
        const order = { red: 0, yellow: 1, green: 2 };
        const diff = (order[a.health] ?? 2) - (order[b.health] ?? 2);
        return diff !== 0 ? diff : b.uploadedAt - a.uploadedAt;
      });

    renderStatsBar(analyses);
    grid.innerHTML = analyses.map(renderSpecialtyCard).join('');
  } catch (err) {
    grid.innerHTML = `<div class="error-msg">خطأ في تحميل البيانات: ${err.message}</div>`;
  } finally {
    loading.classList.remove('active');
  }

  // Load click analytics
  loadClickStats();
}

// ═══════════════════════════════════════════════════════════════
// Click Analytics
// ═══════════════════════════════════════════════════════════════

let _clickStatsRange = '7d';
let _clickRefreshTimer = null;

async function loadClickStats() {
  const container = document.getElementById('click-stats');
  if (!container) return;

  try {
    const resp = await fetch(`/api/click-stats?range=${_clickStatsRange}&_t=${Date.now()}`);
    if (!resp.ok) return;
    const stats = await resp.json();
    renderClickStats(stats);
  } catch {}

  // Auto-refresh every 60s
  clearInterval(_clickRefreshTimer);
  _clickRefreshTimer = setInterval(() => loadClickStats(), 60000);
}

function renderClickStats(stats) {
  const container = document.getElementById('click-stats');
  if (!container) return;

  const maxCount = stats.length ? stats[0].count : 1;
  const RANGE_LABELS = {
    'today': 'اليوم',
    '24h': 'آخر 24 ساعة',
    '7d': 'آخر 7 أيام',
    '30d': 'آخر 30 يوم',
    'all': 'الكل',
  };

  let html = `<div class="click-header">
    <h3>🔥 الأكثر استخداماً</h3>
    <div class="click-range">
      ${Object.entries(RANGE_LABELS).map(([val, label]) =>
        `<button class="click-range-btn${val === _clickStatsRange ? ' active' : ''}" data-range="${val}">${label}</button>`
      ).join('')}
    </div>
  </div>`;

  if (!stats.length) {
    html += '<div class="click-empty">لا توجد بيانات للفترة المحددة</div>';
  } else {
    html += '<div class="click-bars">';
    for (const { specialty, count } of stats) {
      const pct = Math.round((count / maxCount) * 100);
      html += `<div class="click-bar-row">
        <span class="click-bar-label">${iconFor(specialty)} ${labelFor(specialty)}</span>
        <div class="click-bar-track"><div class="click-bar-fill" style="width:${pct}%"></div></div>
        <span class="click-bar-count">${count}</span>
      </div>`;
    }
    html += '</div>';
  }

  container.innerHTML = html;

  // Bind range buttons
  container.querySelectorAll('.click-range-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      _clickStatsRange = btn.dataset.range;
      loadClickStats();
    });
  });
}
