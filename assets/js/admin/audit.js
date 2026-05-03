// ═══════════════════════════════════════════════════════════════
// admin/audit.js — Audit log viewer with filters, search, CSV export
// ═══════════════════════════════════════════════════════════════

const Audit = (function () {

const PAGE_SIZE = 50;
let entries = [];
let filtered = [];
let page = 1;
let filters = { specialty: '', action: '', search: '' };
let loading = false;

function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
function escHtml(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'الآن';
  if (mins < 60) return `منذ ${mins} دقيقة`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `منذ ${hours} ساعة`;
  const days = Math.floor(hours / 24);
  return `منذ ${days} يوم`;
}

function formatDate(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '—';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

async function fetchAuditLog(specialty) {
  const resp = await fetch('/api/admin-save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'fetch_audit', specialty: specialty || '', limit: 500, offset: 0 }),
  });
  if (!resp.ok) throw new Error('Failed to fetch audit log');
  return resp.json();
}

function applyFilters() {
  filtered = entries.filter(e => {
    if (filters.specialty && e.specialty !== filters.specialty) return false;
    if (filters.action && e.action !== filters.action) return false;
    if (filters.search) {
      const q = filters.search.toLowerCase();
      const searchable = [e.specialty, e.entry_id, e.field_name, e.old_value, e.new_value, e.changed_by].join(' ').toLowerCase();
      if (!searchable.includes(q)) return false;
    }
    return true;
  });
  page = 1;
}

function getPagedEntries() {
  const start = (page - 1) * PAGE_SIZE;
  return {
    items: filtered.slice(start, start + PAGE_SIZE),
    total: filtered.length,
    totalPages: Math.ceil(filtered.length / PAGE_SIZE),
  };
}

function actionIcon(action) {
  switch (action) {
    case 'edit': return '✏️';
    case 'delete': return '🗑️';
    case 'add': return '➕';
    default: return '📝';
  }
}

function actionClass(action) {
  switch (action) {
    case 'edit': return 'audit-edit';
    case 'delete': return 'audit-delete';
    case 'add': return 'audit-add';
    default: return '';
  }
}

function renderFilters() {
  const el = document.getElementById('audit-filters');
  if (!el) return;

  // Build specialty options from entries
  const specialties = [...new Set(entries.map(e => e.specialty))].sort();
  const specOptions = specialties.map(s => `<option value="${s}" ${filters.specialty === s ? 'selected' : ''}>${iconFor(s)} ${labelFor(s)}</option>`).join('');

  el.innerHTML = `
    <select id="audit-spec-filter" class="audit-filter-select">
      <option value="">كل التخصصات</option>
      ${specOptions}
    </select>
    <select id="audit-action-filter" class="audit-filter-select">
      <option value="">كل الإجراءات</option>
      <option value="edit" ${filters.action === 'edit' ? 'selected' : ''}>✏️ تعديل</option>
      <option value="add" ${filters.action === 'add' ? 'selected' : ''}>➕ إضافة</option>
      <option value="delete" ${filters.action === 'delete' ? 'selected' : ''}>🗑️ حذف</option>
    </select>
    <div class="audit-search-wrap">
      <input type="text" id="audit-search" class="audit-search" placeholder="بحث..." value="${escHtml(filters.search)}">
    </div>
    <button id="audit-export-btn" class="audit-export-btn" title="تصدير CSV">📥 CSV</button>
  `;

  document.getElementById('audit-spec-filter').addEventListener('change', (e) => { filters.specialty = e.target.value; applyFilters(); renderList(); });
  document.getElementById('audit-action-filter').addEventListener('change', (e) => { filters.action = e.target.value; applyFilters(); renderList(); });
  document.getElementById('audit-search').addEventListener('input', debounce((e) => { filters.search = e.target.value; applyFilters(); renderList(); }, 300));
  document.getElementById('audit-export-btn').addEventListener('click', exportCSV);
}

function renderList() {
  const el = document.getElementById('audit-list');
  if (!el) return;
  const { items, total, totalPages } = getPagedEntries();

  if (!items.length) {
    el.innerHTML = '<div class="ed-empty">لا توجد سجلات مراجعة</div>';
    renderAuditPagination(totalPages);
    return;
  }

  const countEl = document.getElementById('audit-count');
  if (countEl) countEl.textContent = `${total} سجل`;

  let html = '';
  for (const entry of items) {
    const cls = actionClass(entry.action);
    html += `<div class="audit-entry ${cls}">
      <div class="audit-entry-head">
        <span class="audit-action-icon">${actionIcon(entry.action)}</span>
        <span class="audit-action-label">${entry.action.toUpperCase()}</span>
        <span class="audit-spec-badge">${iconFor(entry.specialty)} ${labelFor(entry.specialty)}</span>
        ${entry.field_name ? `<span class="audit-field">${entry.field_name}</span>` : ''}
        <span class="audit-time" title="${formatDate(entry.created_at)}">${timeAgo(entry.created_at)}</span>
        <span class="audit-user">by ${escHtml(entry.changed_by)}</span>
      </div>`;

    if (entry.action === 'edit' && entry.old_value !== null) {
      html += `<div class="audit-diff">
        <span class="audit-old">${escHtml(entry.old_value)}</span>
        <span class="audit-arrow">→</span>
        <span class="audit-new">${escHtml(entry.new_value)}</span>
      </div>`;
    } else if (entry.action === 'add' && entry.new_value) {
      html += `<div class="audit-diff"><span class="audit-new">${escHtml(entry.new_value)}</span></div>`;
    } else if (entry.action === 'delete' && entry.old_value) {
      html += `<div class="audit-diff"><span class="audit-old">${escHtml(entry.old_value)}</span></div>`;
    }

    if (entry.entry_id) {
      html += `<div class="audit-entry-id">${escHtml(entry.entry_id)}</div>`;
    }
    html += '</div>';
  }
  el.innerHTML = html;
  renderAuditPagination(totalPages);
}

function renderAuditPagination(totalPages) {
  const el = document.getElementById('audit-pagination');
  if (!el || totalPages <= 1) { if (el) el.innerHTML = ''; return; }

  let html = `<button class="ed-pg-btn" ${page <= 1 ? 'disabled' : ''} data-pg="prev">السابق</button>`;
  const start = Math.max(1, page - 2);
  const end = Math.min(totalPages, start + 4);
  for (let p = start; p <= end; p++) {
    html += `<button class="ed-pg-btn${p === page ? ' active' : ''}" data-pg="${p}">${p}</button>`;
  }
  html += `<button class="ed-pg-btn" ${page >= totalPages ? 'disabled' : ''} data-pg="next">التالي</button>`;
  el.innerHTML = html;

  el.querySelectorAll('.ed-pg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const pg = btn.dataset.pg;
      if (pg === 'prev') page = Math.max(1, page - 1);
      else if (pg === 'next') page = Math.min(totalPages, page + 1);
      else page = parseInt(pg);
      renderList();
    });
  });
}

function exportCSV() {
  if (!filtered.length) return;
  const headers = ['Action', 'Specialty', 'Entry ID', 'Field', 'Old Value', 'New Value', 'Changed By', 'Date'];
  const rows = filtered.map(e => [
    e.action, e.specialty, e.entry_id || '', e.field_name || '',
    (e.old_value || '').replace(/"/g, '""'), (e.new_value || '').replace(/"/g, '""'),
    e.changed_by, e.created_at,
  ]);
  const csv = [headers.join(','), ...rows.map(r => r.map(v => `"${v}"`).join(','))].join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `audit_log_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

async function initAudit() {
  const el = document.getElementById('audit-list');
  const loadingEl = document.getElementById('audit-loading');
  if (loadingEl) loadingEl.classList.add('active');

  try {
    entries = await fetchAuditLog('');
    filtered = [...entries];
    renderFilters();
    renderList();
  } catch (err) {
    if (el) el.innerHTML = `<div class="error-msg">خطأ: ${err.message}</div>`;
  } finally {
    if (loadingEl) loadingEl.classList.remove('active');
  }
}

return { initAudit };

})();
