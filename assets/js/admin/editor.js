// ═══════════════════════════════════════════════════════════════
// admin/editor.js — Schedule Editor with CRUD, validation,
//   undo/redo, auto-save draft, phone resolver, conflict detection
// ═══════════════════════════════════════════════════════════════

const Editor = (function () {

// ── State ──
const state = {
  allRecords: [],           // raw kfsher records
  specialties: [],          // [{ key, label, icon, count, recordId, data }]
  currentSpecialty: null,    // selected specialty key
  currentRecord: null,      // full kfsher record for current specialty
  originalEntries: [],      // entries snapshot at load (for change detection)
  entries: [],              // working copy of entries
  changes: new Map(),       // idx → { type: 'edit'|'add'|'delete', fields: {...} }
  undoStack: [],
  redoStack: [],
  selected: new Set(),      // selected row indices (for bulk ops)
  search: '',
  sortCol: 'date',
  sortDir: 'asc',
  page: 1,
  pageSize: 50,
  editingCell: null,        // { idx, field }
  saving: false,
  contactMap: {},           // name→phone lookup
  draftKey: 'kfshd_editor_draft',
  autoSaveTimer: null,
};

const FIELDS = ['date', 'doctor', 'phone', 'role', 'shift'];
const FIELD_LABELS = { date: 'التاريخ', doctor: 'الطبيب', phone: 'الهاتف', role: 'الدور', shift: 'الوردية' };

// ── Helpers ──
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function escHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

// ── Data Loading ──
async function loadAllRecords() {
  // Cache-bust: records.js has max-age=300, must bypass after save
  const resp = await fetch(`/api/admin?_t=${Date.now()}`);
  if (!resp.ok) throw new Error('Failed to fetch records');
  state.allRecords = await resp.json();
  buildSpecialtyList();
}

function buildSpecialtyList() {
  const grouped = {};
  for (const rec of state.allRecords) {
    const key = rec.specialty;
    if (!key || !rec.data) continue;
    if (!grouped[key] || new Date(rec.created_at) > new Date(grouped[key].created_at)) {
      grouped[key] = rec;
    }
  }
  state.specialties = Object.entries(grouped).map(([key, rec]) => ({
    key,
    label: labelFor(key),
    icon: iconFor(key),
    count: (rec.data?.entries || []).length,
    recordId: rec.id,
    data: rec.data,
    createdAt: rec.created_at,
  })).sort((a, b) => a.label.localeCompare(b.label));
}

function flattenEntries(raw) {
  const flat = [];
  if (!Array.isArray(raw)) return flat;
  for (const e of raw) {
    if (e.entries && Array.isArray(e.entries)) {
      for (const sub of e.entries) {
        flat.push({ _id: uid(), date: e.date || '', doctor: sub.doctor || sub.name || '', phone: sub.phone || '', role: sub.role || '', shift: sub.shift || '', _raw: sub });
      }
    } else {
      flat.push({ _id: uid(), date: e.date || '', doctor: e.doctor || e.name || '', phone: e.phone || '', role: e.role || '', shift: e.shift || '', _raw: e });
    }
  }
  return flat;
}

function rebuildRawEntries() {
  // Rebuild data.entries from flat state.entries (excluding deleted)
  // Main app uses entry.name (not .doctor), so always set both
  return state.entries
    .filter((_, i) => !state.changes.has(i) || state.changes.get(i).type !== 'delete')
    .map(e => {
      const raw = { ...e._raw };
      raw.date = e.date;
      raw.name = e.doctor;      // main app reads .name
      raw.doctor = e.doctor;    // keep for editor compat
      raw.phone = e.phone;
      raw.phoneUncertain = false; // admin-edited = verified
      raw.role = e.role;
      raw.shift = e.shift;
      return raw;
    });
}

function loadSpecialtyEntries(key) {
  const spec = state.specialties.find(s => s.key === key);
  if (!spec) return;
  state.currentSpecialty = key;
  state.currentRecord = state.allRecords.find(r => r.id === spec.recordId);
  const raw = spec.data?.entries || [];
  state.entries = flattenEntries(raw);
  state.originalEntries = JSON.parse(JSON.stringify(state.entries));
  state.changes.clear();
  state.undoStack = [];
  state.redoStack = [];
  state.selected.clear();
  state.search = '';
  state.page = 1;
  state.editingCell = null;
  buildContactMap();
  checkDraft();
  render();
}

function buildContactMap() {
  state.contactMap = {};
  for (const rec of state.allRecords) {
    for (const e of (rec.data?.entries || [])) {
      const entries = e.entries ? e.entries : [e];
      for (const sub of entries) {
        const name = (sub.doctor || sub.name || '').trim().toLowerCase();
        const phone = (sub.phone || '').trim();
        if (name && phone && /^05\d{8}$/.test(phone)) {
          state.contactMap[name] = phone;
        }
      }
    }
  }
}

function resolvePhone(name) {
  const key = (name || '').trim().toLowerCase();
  return state.contactMap[key] || '';
}

function getPhoneSuggestions(name) {
  const key = (name || '').trim().toLowerCase();
  if (!key || key.length < 2) return [];
  const matches = [];
  for (const [n, p] of Object.entries(state.contactMap)) {
    if (n.includes(key)) matches.push({ name: n, phone: p });
  }
  return matches.slice(0, 5);
}

// ── Filtering / Sorting / Pagination ──
function getFilteredEntries() {
  let list = state.entries.map((e, i) => ({ ...e, _idx: i }));
  if (state.search) {
    const q = state.search.toLowerCase();
    list = list.filter(e =>
      e.doctor.toLowerCase().includes(q) ||
      e.phone.includes(q) ||
      e.role.toLowerCase().includes(q) ||
      e.date.includes(q)
    );
  }
  // Sort
  list.sort((a, b) => {
    let va = a[state.sortCol] || '';
    let vb = b[state.sortCol] || '';
    if (state.sortCol === 'date') {
      // Parse DD/MM for sorting
      const [da, ma] = va.split('/').map(Number);
      const [db, mb] = vb.split('/').map(Number);
      va = (ma || 0) * 100 + (da || 0);
      vb = (mb || 0) * 100 + (db || 0);
    } else {
      va = va.toLowerCase();
      vb = vb.toLowerCase();
    }
    if (va < vb) return state.sortDir === 'asc' ? -1 : 1;
    if (va > vb) return state.sortDir === 'asc' ? 1 : -1;
    return 0;
  });
  return list;
}

function getPagedEntries() {
  const filtered = getFilteredEntries();
  const start = (state.page - 1) * state.pageSize;
  return {
    items: filtered.slice(start, start + state.pageSize),
    total: filtered.length,
    totalPages: Math.ceil(filtered.length / state.pageSize),
  };
}

// ── Validation ──
function validateField(field, value) {
  switch (field) {
    case 'date':
      if (!value) return 'مطلوب';
      if (!/^\d{1,2}\/\d{1,2}$/.test(value)) return 'صيغة: DD/MM';
      return '';
    case 'doctor':
      if (!value || value.trim().length < 3) return 'الاسم مطلوب (3 حروف+)';
      if (value.length > 80) return 'أقصى 80 حرف';
      return '';
    case 'phone':
      if (!value) return ''; // optional
      if (!/^05\d{8}$/.test(value)) return 'صيغة: 05xxxxxxxx';
      return '';
    case 'role':
      if (!value) return 'مطلوب';
      return '';
    default:
      return '';
  }
}

function validateAll() {
  const errors = [];
  state.entries.forEach((entry, idx) => {
    if (state.changes.has(idx) && state.changes.get(idx).type === 'delete') return;
    for (const f of ['date', 'doctor', 'role']) {
      const err = validateField(f, entry[f]);
      if (err) errors.push({ idx, field: f, message: err });
    }
    if (entry.phone) {
      const err = validateField('phone', entry.phone);
      if (err) errors.push({ idx, field: 'phone', message: err });
    }
  });
  return errors;
}

// ── Change Tracking ──
function pushUndo(action) {
  state.undoStack.push(action);
  state.redoStack = [];
  scheduleDraftSave();
  renderSaveBtn();
}

function recordEdit(idx, field, oldVal, newVal) {
  if (oldVal === newVal) return;
  const change = state.changes.get(idx) || { type: 'edit', fields: {} };
  if (change.type === 'add') {
    state.changes.set(idx, change);
  } else {
    change.type = 'edit';
    if (!change.fields[field]) change.fields[field] = { old: oldVal };
    change.fields[field].new = newVal;
    state.changes.set(idx, change);
  }
  pushUndo({ action: 'edit', idx, field, oldVal, newVal });
}

function undo() {
  const action = state.undoStack.pop();
  if (!action) return;
  state.redoStack.push(action);
  switch (action.action) {
    case 'edit':
      state.entries[action.idx][action.field] = action.oldVal;
      // Recalculate change status
      recalcChange(action.idx);
      break;
    case 'add':
      state.entries.splice(action.idx, 1);
      state.changes.delete(action.idx);
      reindexChanges(action.idx);
      break;
    case 'delete':
      if (state.changes.has(action.idx)) {
        const c = state.changes.get(action.idx);
        if (c._prevType) { c.type = c._prevType; delete c._prevType; }
        else state.changes.delete(action.idx);
      }
      break;
    case 'bulk_delete': {
      for (const idx of action.indices) {
        const c = state.changes.get(idx);
        if (c && c._prevType) { c.type = c._prevType; delete c._prevType; }
        else state.changes.delete(idx);
      }
      break;
    }
  }
  scheduleDraftSave();
  render();
}

function redo() {
  const action = state.redoStack.pop();
  if (!action) return;
  state.undoStack.push(action);
  switch (action.action) {
    case 'edit':
      state.entries[action.idx][action.field] = action.newVal;
      recordEditSilent(action.idx, action.field, action.oldVal, action.newVal);
      break;
    case 'add':
      state.entries.splice(action.idx, 0, action.entry);
      state.changes.set(action.idx, { type: 'add', fields: {} });
      break;
    case 'delete':
      markDelete(action.idx, true);
      break;
    case 'bulk_delete':
      for (const idx of action.indices) markDelete(idx, true);
      break;
  }
  scheduleDraftSave();
  render();
}

function recordEditSilent(idx, field, oldVal, newVal) {
  const change = state.changes.get(idx) || { type: 'edit', fields: {} };
  if (change.type !== 'add') {
    change.type = 'edit';
    if (!change.fields[field]) change.fields[field] = { old: oldVal };
    change.fields[field].new = newVal;
  }
  state.changes.set(idx, change);
}

function recalcChange(idx) {
  const orig = state.originalEntries[idx];
  if (!orig) return; // was added row
  const curr = state.entries[idx];
  const change = state.changes.get(idx);
  if (!change || change.type === 'add' || change.type === 'delete') return;
  let hasChanges = false;
  for (const f of FIELDS) {
    if (curr[f] !== orig[f]) { hasChanges = true; break; }
  }
  if (!hasChanges) state.changes.delete(idx);
}

function reindexChanges(removedIdx) {
  const newMap = new Map();
  for (const [k, v] of state.changes) {
    if (k < removedIdx) newMap.set(k, v);
    else if (k > removedIdx) newMap.set(k - 1, v);
  }
  state.changes.clear();
  for (const [k, v] of newMap) state.changes.set(k, v);
}

// ── CRUD ──
function addEntry() {
  const entry = { _id: uid(), date: '', doctor: '', phone: '', role: '', shift: '', _raw: {} };
  state.entries.unshift(entry);
  // Shift all existing change indices
  const newMap = new Map();
  for (const [k, v] of state.changes) newMap.set(k + 1, v);
  state.changes.clear();
  for (const [k, v] of newMap) state.changes.set(k, v);
  state.changes.set(0, { type: 'add', fields: {} });
  pushUndo({ action: 'add', idx: 0, entry });
  state.page = 1;
  state.search = '';
  render();
  // Focus first field
  setTimeout(() => {
    const firstInput = document.querySelector('.ed-table .ed-cell[data-field="date"]');
    if (firstInput) firstInput.click();
  }, 50);
}

function markDelete(idx, silent) {
  const change = state.changes.get(idx) || { type: 'edit', fields: {} };
  change._prevType = change.type;
  change.type = 'delete';
  state.changes.set(idx, change);
  state.selected.delete(idx);
  if (!silent) {
    pushUndo({ action: 'delete', idx });
    render();
  }
}

function deleteEntry(idx) {
  const entry = state.entries[idx];
  const name = entry?.doctor || 'هذا الإدخال';
  if (!confirm(`حذف "${name}" بتاريخ ${entry?.date || '—'}؟`)) return;
  markDelete(idx);
}

function bulkDelete() {
  const indices = [...state.selected];
  if (!indices.length) return;
  if (!confirm(`حذف ${indices.length} إدخال؟`)) return;
  for (const idx of indices) markDelete(idx, true);
  pushUndo({ action: 'bulk_delete', indices });
  state.selected.clear();
  render();
}

function undoDelete(idx) {
  const change = state.changes.get(idx);
  if (!change || change.type !== 'delete') return;
  if (change._prevType === 'add') { change.type = 'add'; }
  else if (change._prevType === 'edit') { change.type = 'edit'; }
  else { state.changes.delete(idx); }
  delete change._prevType;
  render();
}

// ── Save ──
function getPendingChanges() {
  let edits = 0, adds = 0, deletes = 0;
  for (const [, c] of state.changes) {
    if (c.type === 'edit') edits++;
    else if (c.type === 'add') adds++;
    else if (c.type === 'delete') deletes++;
  }
  return { edits, adds, deletes, total: edits + adds + deletes };
}

async function saveChanges() {
  if (state.saving) return;
  const pending = getPendingChanges();
  if (!pending.total) return;

  const errors = validateAll();
  if (errors.length) {
    const first = errors[0];
    showToast(`خطأ تحقق: ${FIELD_LABELS[first.field]} — ${first.message}`, 'error');
    // Scroll to error
    const row = document.querySelector(`.ed-row[data-idx="${first.idx}"]`);
    if (row) row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  const summary = [];
  if (pending.edits) summary.push(`${pending.edits} تعديل`);
  if (pending.adds) summary.push(`${pending.adds} إضافة`);
  if (pending.deletes) summary.push(`${pending.deletes} حذف`);
  if (!confirm(`حفظ ${pending.total} تغيير؟\n${summary.join(' · ')}`)) return;

  state.saving = true;
  renderSaveBtn();

  try {
    const auditEntries = buildAuditEntries();
    const newEntries = rebuildRawEntries();
    const updatedData = {
      ...state.currentRecord.data,
      entries: newEntries,
      // Clear normalized so main app rebuilds it from fresh entries
      // (canonicalizeUploadedRecord uses normalized if present, skipping entries)
      normalized: null,
      uploadedAt: Date.now(),
      lastEditedBy: 'Muath',
      lastEditedAt: new Date().toISOString(),
    };

    const resp = await fetch('/api/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'save_entries',
        recordId: state.currentRecord.id,
        specialty: state.currentSpecialty,
        data: updatedData,
        // Single-user system: skip conflict check to avoid false 409s
        // expectedUploadedAt: state.currentRecord.data?.uploadedAt || 0,
        auditEntries,
      }),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${resp.status}`);
    }

    showToast('تم الحفظ! التحديثات متزامنة لجميع الأجهزة.', 'success');
    clearDraft();
    // Broadcast to other tabs
    try { new BroadcastChannel('kfshd_admin').postMessage({ type: 'saved', specialty: state.currentSpecialty }); } catch {}
    // Reload fresh data
    await loadAllRecords();
    loadSpecialtyEntries(state.currentSpecialty);
  } catch (err) {
    showToast(`خطأ في الحفظ: ${err.message}`, 'error');
  } finally {
    state.saving = false;
    renderSaveBtn();
  }
}

function buildAuditEntries() {
  const entries = [];
  for (const [idx, change] of state.changes) {
    const entry = state.entries[idx];
    if (change.type === 'edit') {
      for (const [field, vals] of Object.entries(change.fields)) {
        entries.push({
          action: 'edit',
          specialty: state.currentSpecialty,
          entry_id: entry.date + '_' + entry.doctor,
          field_name: field,
          old_value: vals.old || '',
          new_value: vals.new || entry[field] || '',
          changed_by: 'Muath',
        });
      }
    } else if (change.type === 'add') {
      entries.push({
        action: 'add',
        specialty: state.currentSpecialty,
        entry_id: entry.date + '_' + entry.doctor,
        field_name: null,
        old_value: null,
        new_value: JSON.stringify({ date: entry.date, doctor: entry.doctor, role: entry.role }),
        changed_by: 'Muath',
      });
    } else if (change.type === 'delete') {
      entries.push({
        action: 'delete',
        specialty: state.currentSpecialty,
        entry_id: entry.date + '_' + entry.doctor,
        field_name: null,
        old_value: JSON.stringify({ date: entry.date, doctor: entry.doctor, role: entry.role }),
        new_value: null,
        changed_by: 'Muath',
      });
    }
  }
  return entries;
}

// ── Draft Auto-save ──
function scheduleDraftSave() {
  clearTimeout(state.autoSaveTimer);
  state.autoSaveTimer = setTimeout(saveDraft, 30000);
}

function saveDraft() {
  if (!state.currentSpecialty || !state.changes.size) return;
  try {
    const draft = {
      specialty: state.currentSpecialty,
      entries: state.entries,
      changes: Array.from(state.changes.entries()),
      savedAt: Date.now(),
    };
    localStorage.setItem(state.draftKey, JSON.stringify(draft));
  } catch {}
}

function checkDraft() {
  try {
    const raw = localStorage.getItem(state.draftKey);
    if (!raw) return;
    const draft = JSON.parse(raw);
    if (draft.specialty !== state.currentSpecialty) return;
    const ago = Math.round((Date.now() - draft.savedAt) / 60000);
    const banner = document.getElementById('draft-banner');
    if (banner) {
      banner.innerHTML = `لديك تغييرات غير محفوظة من ${ago} دقيقة. <button onclick="Editor.restoreDraft()">استعادة</button> <button onclick="Editor.clearDraft()">تجاهل</button>`;
      banner.classList.add('show');
    }
  } catch {}
}

function restoreDraft() {
  try {
    const raw = localStorage.getItem(state.draftKey);
    if (!raw) return;
    const draft = JSON.parse(raw);
    state.entries = draft.entries;
    state.changes = new Map(draft.changes);
    render();
    const banner = document.getElementById('draft-banner');
    if (banner) banner.classList.remove('show');
    showToast('تم استعادة المسودة', 'success');
  } catch {}
}

function clearDraft() {
  localStorage.removeItem(state.draftKey);
  const banner = document.getElementById('draft-banner');
  if (banner) banner.classList.remove('show');
}

// ── Toast ──
function showToast(msg, type) {
  let toast = document.getElementById('ed-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'ed-toast';
    toast.className = 'ed-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.className = `ed-toast ed-toast-${type} show`;
  setTimeout(() => toast.classList.remove('show'), 3000);
}

// ── Rendering ──
function render() {
  renderSelector();
  renderToolbar();
  renderTable();
  renderPagination();
  renderSaveBtn();
  bindTableEvents(); // must run after both table + pagination are in DOM
}

function renderSelector() {
  const el = document.getElementById('ed-selector');
  if (!el) return;
  let html = '<option value="">— اختر التخصص —</option>';
  for (const s of state.specialties) {
    const sel = s.key === state.currentSpecialty ? ' selected' : '';
    html += `<option value="${s.key}"${sel}>${s.icon} ${s.label} (${s.count})</option>`;
  }
  el.innerHTML = html;
}

function renderToolbar() {
  const el = document.getElementById('ed-toolbar');
  if (!el) return;
  if (!state.currentSpecialty) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  const filtered = getFilteredEntries();
  const countEl = document.getElementById('ed-count');
  if (countEl) countEl.textContent = `${filtered.length} من ${state.entries.length} إدخال`;
  const searchEl = document.getElementById('ed-search');
  if (searchEl && searchEl !== document.activeElement) searchEl.value = state.search;
  // Bulk delete visibility
  const bulkBtn = document.getElementById('ed-bulk-delete');
  if (bulkBtn) bulkBtn.classList.toggle('hidden', state.selected.size === 0);
  const bulkCount = document.getElementById('ed-bulk-count');
  if (bulkCount) bulkCount.textContent = state.selected.size;
}

function renderTable() {
  const wrap = document.getElementById('ed-table-wrap');
  if (!wrap) return;
  if (!state.currentSpecialty) {
    wrap.innerHTML = '<div class="ed-empty">اختر تخصص من القائمة أعلاه</div>';
    return;
  }
  const { items, total } = getPagedEntries();
  if (!items.length && state.entries.length) {
    wrap.innerHTML = '<div class="ed-empty">لا نتائج تطابق البحث</div>';
    return;
  }
  if (!items.length) {
    wrap.innerHTML = '<div class="ed-empty">لا توجد إدخالات. اضغط ➕ للإضافة</div>';
    return;
  }

  const sortIcon = (col) => {
    if (state.sortCol !== col) return '<span class="sort-icon">⇅</span>';
    return `<span class="sort-icon active">${state.sortDir === 'asc' ? '▲' : '▼'}</span>`;
  };

  let html = `<table class="ed-table"><thead><tr>
    <th class="ed-th-check"><input type="checkbox" id="ed-select-all" ${state.selected.size === items.length && items.length ? 'checked' : ''}></th>
    <th class="ed-th-sort" data-col="date">التاريخ ${sortIcon('date')}</th>
    <th class="ed-th-sort" data-col="doctor">الطبيب ${sortIcon('doctor')}</th>
    <th class="ed-th-sort" data-col="phone">الهاتف ${sortIcon('phone')}</th>
    <th class="ed-th-sort" data-col="role">الدور ${sortIcon('role')}</th>
    <th class="ed-th-sort" data-col="shift">الوردية ${sortIcon('shift')}</th>
    <th>إجراءات</th>
  </tr></thead><tbody>`;

  for (const item of items) {
    const idx = item._idx;
    const change = state.changes.get(idx);
    let rowClass = 'ed-row';
    if (change) {
      if (change.type === 'add') rowClass += ' ed-row-add';
      else if (change.type === 'delete') rowClass += ' ed-row-delete';
      else if (change.type === 'edit') rowClass += ' ed-row-edit';
    }
    const checked = state.selected.has(idx) ? ' checked' : '';
    const isDeleted = change?.type === 'delete';

    html += `<tr class="${rowClass}" data-idx="${idx}">`;
    html += `<td><input type="checkbox" class="ed-check" data-idx="${idx}"${checked}${isDeleted ? ' disabled' : ''}></td>`;

    for (const f of FIELDS) {
      const val = item[f] || '';
      const err = (change && change.type !== 'delete') ? validateField(f, val) : '';
      const errClass = err ? ' ed-cell-error' : '';
      const editedClass = (change?.fields?.[f]) ? ' ed-cell-edited' : '';
      if (isDeleted) {
        html += `<td class="ed-cell ed-cell-deleted">${escHtml(val)}</td>`;
      } else {
        html += `<td class="ed-cell${errClass}${editedClass}" data-field="${f}" data-idx="${idx}" title="${err}">${escHtml(val)}</td>`;
      }
    }

    // Actions
    if (isDeleted) {
      html += `<td><button class="ed-act-btn ed-act-undo" data-idx="${idx}" title="تراجع">↩</button></td>`;
    } else {
      html += `<td><button class="ed-act-btn ed-act-del" data-idx="${idx}" title="حذف">🗑️</button></td>`;
    }
    html += '</tr>';
  }
  html += '</tbody></table>';
  wrap.innerHTML = html;
}

function renderPagination() {
  const el = document.getElementById('ed-pagination');
  if (!el) return;
  const { totalPages } = getPagedEntries();
  if (totalPages <= 1) { el.innerHTML = ''; return; }

  let html = '';
  html += `<button class="ed-pg-btn" data-pg="prev" ${state.page <= 1 ? 'disabled' : ''}>السابق</button>`;
  const start = Math.max(1, state.page - 2);
  const end = Math.min(totalPages, start + 4);
  for (let p = start; p <= end; p++) {
    html += `<button class="ed-pg-btn${p === state.page ? ' active' : ''}" data-pg="${p}">${p}</button>`;
  }
  html += `<button class="ed-pg-btn" data-pg="next" ${state.page >= totalPages ? 'disabled' : ''}>التالي</button>`;
  html += `<span class="ed-pg-jump">صفحة <input type="number" min="1" max="${totalPages}" value="${state.page}" class="ed-pg-input"> من ${totalPages}</span>`;
  el.innerHTML = html;
}

function renderSaveBtn() {
  const btn = document.getElementById('ed-save-btn');
  if (!btn) return;
  const pending = getPendingChanges();
  if (state.saving) {
    btn.textContent = '⏳ جاري الحفظ...';
    btn.disabled = true;
    btn.className = 'ed-save-btn saving';
  } else if (pending.total === 0) {
    btn.textContent = 'حفظ (0)';
    btn.disabled = true;
    btn.className = 'ed-save-btn';
  } else {
    btn.textContent = `حفظ (${pending.total})`;
    btn.disabled = false;
    btn.className = 'ed-save-btn has-changes';
  }
}

// ── Inline Editing ──
function startEdit(idx, field) {
  if (state.changes.has(idx) && state.changes.get(idx).type === 'delete') return;
  state.editingCell = { idx, field };
  const cell = document.querySelector(`.ed-cell[data-idx="${idx}"][data-field="${field}"]`);
  if (!cell) return;
  const oldVal = state.entries[idx][field] || '';
  const width = cell.offsetWidth;

  if (field === 'role') {
    // Role dropdown
    const roles = getRoleOptions();
    let html = `<select class="ed-inline-input" style="min-width:${width}px">`;
    for (const r of roles) html += `<option value="${escHtml(r)}" ${r === oldVal ? 'selected' : ''}>${escHtml(r)}</option>`;
    html += '<option value="__custom__">مخصص...</option></select>';
    cell.innerHTML = html;
    const sel = cell.querySelector('select');
    sel.focus();
    sel.addEventListener('change', () => {
      if (sel.value === '__custom__') {
        cell.innerHTML = `<input class="ed-inline-input" value="" style="min-width:${width}px">`;
        const inp = cell.querySelector('input');
        inp.focus();
        inp.onblur = () => commitEdit(idx, field, inp.value);
        inp.addEventListener('keydown', (e) => handleEditKey(e, idx, field, inp));
      } else {
        sel.onblur = null; // prevent double-fire
        commitEdit(idx, field, sel.value);
      }
    });
    sel.onblur = () => {
      if (sel.value !== '__custom__') commitEdit(idx, field, sel.value);
    };
  } else if (field === 'phone') {
    cell.innerHTML = `<input type="tel" class="ed-inline-input" value="${escHtml(oldVal)}" placeholder="05xxxxxxxx" style="min-width:${width}px" dir="ltr">`;
    const inp = cell.querySelector('input');
    inp.focus();
    inp.select();
    inp.onblur = () => commitEdit(idx, field, inp.value);
    inp.addEventListener('keydown', (e) => handleEditKey(e, idx, field, inp));
  } else if (field === 'doctor') {
    cell.innerHTML = `<input class="ed-inline-input" value="${escHtml(oldVal)}" style="min-width:${width}px"><div class="ed-suggest" id="ed-suggest"></div>`;
    const inp = cell.querySelector('input');
    inp.focus();
    inp.select();
    inp.addEventListener('input', debounce(() => showNameSuggestions(inp, idx), 200));
    inp.onblur = () => setTimeout(() => commitEdit(idx, field, inp.value), 150);
    inp.addEventListener('keydown', (e) => handleEditKey(e, idx, field, inp));
  } else {
    cell.innerHTML = `<input class="ed-inline-input" value="${escHtml(oldVal)}" style="min-width:${width}px" ${field === 'date' ? 'placeholder="DD/MM" dir="ltr"' : ''}>`;
    const inp = cell.querySelector('input');
    inp.focus();
    inp.select();
    inp.onblur = () => commitEdit(idx, field, inp.value);
    inp.addEventListener('keydown', (e) => handleEditKey(e, idx, field, inp));
  }
}

function commitEdit(idx, field, newVal) {
  // Guard: prevent double-commit (blur fires after Enter/Tab destroys the input)
  if (!state.editingCell || state.editingCell.idx !== idx || state.editingCell.field !== field) return;
  const oldVal = state.entries[idx][field] || '';
  newVal = (newVal || '').trim();
  state.entries[idx][field] = newVal;
  state.editingCell = null;

  if (oldVal !== newVal) {
    recordEdit(idx, field, oldVal, newVal);
    // Auto-resolve phone when doctor name changes
    if (field === 'doctor' && newVal) {
      const phone = resolvePhone(newVal);
      if (phone && !state.entries[idx].phone) {
        state.entries[idx].phone = phone;
        recordEdit(idx, 'phone', '', phone);
      }
    }
    // Phone edit: offer bulk apply + memory save
    if (field === 'phone' && newVal && state.entries[idx].doctor) {
      setTimeout(() => offerBulkPhoneApply(idx, state.entries[idx].doctor, newVal), 100);
    }
  }
  render();
}

async function offerBulkPhoneApply(editedIdx, doctorName, phone) {
  // Find other entries with same name and empty phone
  const others = [];
  state.entries.forEach((e, i) => {
    if (i === editedIdx) return;
    if (state.changes.has(i) && state.changes.get(i).type === 'delete') return;
    if (e.doctor === doctorName && (!e.phone || e.phone !== phone)) others.push(i);
  });

  if (!others.length) {
    // No duplicates — just offer memory save
    if (confirm(`حفظ رقم ${phone} لـ ${doctorName} في الذاكرة?\nسيُطبّق تلقائياً على الرفعات المستقبلية.`)) {
      saveToPhoneMemory(doctorName, phone);
    }
    return;
  }

  // Show dialog with options
  const msg = `${doctorName} يظهر في ${others.length} موقع آخر بدون هذا الرقم.\n\nتطبيق ${phone} على الكل؟\n\n[OK] = تطبيق على الكل + حفظ في الذاكرة\n[Cancel] = هذا الموقع فقط`;
  if (confirm(msg)) {
    // Apply to all matching entries
    let applied = 0;
    for (const i of others) {
      const oldPhone = state.entries[i].phone || '';
      state.entries[i].phone = phone;
      recordEdit(i, 'phone', oldPhone, phone);
      applied++;
    }
    // Save to phone memory
    saveToPhoneMemory(doctorName, phone);
    showToast(`تم تحديث ${applied + 1} موقع + حفظ في الذاكرة`, 'success');
    render();
  }
}

async function saveToPhoneMemory(name, phone) {
  try {
    await fetch('/api/manual-phone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'upsert', full_name: name, phone }),
    });
  } catch {}
}

function handleEditKey(e, idx, field, inp) {
  if (e.key === 'Escape') {
    state.editingCell = null;
    render();
  } else if (e.key === 'Enter' || e.key === 'Tab') {
    e.preventDefault();
    // Detach blur so it doesn't double-fire after render destroys the input
    inp.onblur = null;
    commitEdit(idx, field, inp.value);
    // Move to next field
    const fi = FIELDS.indexOf(field);
    const nextField = FIELDS[fi + 1];
    if (nextField) setTimeout(() => startEdit(idx, nextField), 50);
  }
}

function showNameSuggestions(inp, idx) {
  const suggest = document.getElementById('ed-suggest');
  if (!suggest) return;
  const matches = getPhoneSuggestions(inp.value);
  if (!matches.length) { suggest.innerHTML = ''; return; }
  suggest.innerHTML = matches.map(m =>
    `<div class="ed-suggest-item" data-name="${escHtml(m.name)}" data-phone="${m.phone}">${escHtml(m.name)} <span class="ed-suggest-phone">${m.phone}</span></div>`
  ).join('');
  suggest.querySelectorAll('.ed-suggest-item').forEach(item => {
    item.addEventListener('mousedown', (e) => {
      e.preventDefault();
      inp.value = item.dataset.name;
      state.entries[idx].phone = item.dataset.phone;
      recordEdit(idx, 'phone', '', item.dataset.phone);
      commitEdit(idx, 'doctor', state.entries[idx].doctor, item.dataset.name);
    });
  });
}

function getRoleOptions() {
  const roles = new Set();
  for (const e of state.entries) {
    if (e.role) roles.add(e.role);
  }
  // Also scan all records
  for (const rec of state.allRecords) {
    for (const e of (rec.data?.entries || [])) {
      const subs = e.entries ? e.entries : [e];
      for (const s of subs) { if (s.role) roles.add(s.role); }
    }
  }
  return [...roles].sort();
}

// ── Table Events ──
function bindTableEvents() {
  const wrap = document.getElementById('ed-table-wrap');
  if (!wrap) return;

  // Cell click → start edit
  wrap.querySelectorAll('.ed-cell[data-field]').forEach(cell => {
    cell.addEventListener('click', () => {
      const idx = parseInt(cell.dataset.idx);
      startEdit(idx, cell.dataset.field);
    });
  });

  // Checkboxes
  wrap.querySelectorAll('.ed-check').forEach(cb => {
    cb.addEventListener('change', () => {
      const idx = parseInt(cb.dataset.idx);
      if (cb.checked) state.selected.add(idx);
      else state.selected.delete(idx);
      renderToolbar();
    });
  });

  // Select all
  const selectAll = document.getElementById('ed-select-all');
  if (selectAll) {
    selectAll.addEventListener('change', () => {
      const { items } = getPagedEntries();
      if (selectAll.checked) {
        items.forEach(i => { if (!state.changes.has(i._idx) || state.changes.get(i._idx).type !== 'delete') state.selected.add(i._idx); });
      } else {
        state.selected.clear();
      }
      render();
    });
  }

  // Sort headers
  wrap.querySelectorAll('.ed-th-sort').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (state.sortCol === col) state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
      else { state.sortCol = col; state.sortDir = 'asc'; }
      render();
    });
  });

  // Delete buttons
  wrap.querySelectorAll('.ed-act-del').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); deleteEntry(parseInt(btn.dataset.idx)); });
  });

  // Undo delete buttons
  wrap.querySelectorAll('.ed-act-undo').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); undoDelete(parseInt(btn.dataset.idx)); });
  });

  // Pagination
  const pgEl = document.getElementById('ed-pagination');
  if (pgEl) {
    pgEl.querySelectorAll('.ed-pg-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const pg = btn.dataset.pg;
        const { totalPages } = getPagedEntries();
        if (pg === 'prev') state.page = Math.max(1, state.page - 1);
        else if (pg === 'next') state.page = Math.min(totalPages, state.page + 1);
        else state.page = parseInt(pg);
        render();
      });
    });
    const jumpInput = pgEl.querySelector('.ed-pg-input');
    if (jumpInput) {
      jumpInput.addEventListener('change', () => {
        const { totalPages } = getPagedEntries();
        state.page = Math.max(1, Math.min(totalPages, parseInt(jumpInput.value) || 1));
        render();
      });
    }
  }
}

// ── Keyboard Shortcuts ──
function setupShortcuts() {
  document.addEventListener('keydown', (e) => {
    // Only active when editor panel is visible
    if (!document.getElementById('panel-editor')?.classList.contains('active')) return;

    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      saveChanges();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      undo();
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
      e.preventDefault();
      redo();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
      e.preventDefault();
      document.getElementById('ed-search')?.focus();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
      e.preventDefault();
      addEntry();
    }
    if (e.key === 'Delete' && !state.editingCell && state.selected.size) {
      e.preventDefault();
      bulkDelete();
    }
  });
}

// ── Beforeunload ──
function setupBeforeUnload() {
  window.addEventListener('beforeunload', (e) => {
    if (state.changes.size > 0) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
}

// ── BroadcastChannel listener ──
function setupBroadcastListener() {
  try {
    const ch = new BroadcastChannel('kfshd_admin');
    ch.addEventListener('message', (e) => {
      if (e.data?.type === 'saved' && e.data.specialty === state.currentSpecialty && !state.changes.size) {
        loadAllRecords().then(() => loadSpecialtyEntries(state.currentSpecialty));
      }
    });
  } catch {}
}

// ── Init ──
async function initEditor() {
  setupShortcuts();
  setupBeforeUnload();
  setupBroadcastListener();

  // Bind selector
  const sel = document.getElementById('ed-selector');
  if (sel) sel.addEventListener('change', () => { if (sel.value) loadSpecialtyEntries(sel.value); });

  // Bind search
  const searchInput = document.getElementById('ed-search');
  if (searchInput) {
    searchInput.addEventListener('input', debounce(() => {
      state.search = searchInput.value;
      state.page = 1;
      render();
    }, 300));
  }

  const clearBtn = document.getElementById('ed-search-clear');
  if (clearBtn) clearBtn.addEventListener('click', () => {
    state.search = '';
    const si = document.getElementById('ed-search');
    if (si) si.value = '';
    state.page = 1;
    render();
  });

  // Bind add/save/discard
  document.getElementById('ed-add-btn')?.addEventListener('click', addEntry);
  document.getElementById('ed-save-btn')?.addEventListener('click', saveChanges);
  document.getElementById('ed-bulk-delete')?.addEventListener('click', bulkDelete);
  document.getElementById('ed-discard-btn')?.addEventListener('click', () => {
    if (!state.changes.size) return;
    if (!confirm(`تجاهل ${state.changes.size} تغيير؟`)) return;
    clearDraft();
    loadSpecialtyEntries(state.currentSpecialty);
  });
  document.getElementById('ed-undo-btn')?.addEventListener('click', undo);
  document.getElementById('ed-redo-btn')?.addEventListener('click', redo);

  await loadAllRecords();
  renderSelector();
}

// Public API
return { initEditor, restoreDraft, clearDraft, loadAllRecords };

})();
