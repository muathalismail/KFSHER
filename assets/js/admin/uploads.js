// ═══════════════════════════════════════════════════════════════
// admin/uploads.js — Upload monitoring dashboard
// ═══════════════════════════════════════════════════════════════

const Uploads = (function () {

let logs = [];
let filters = { status: '', specialty: '' };
let page = 1;
const PAGE_SIZE = 30;

function escHtml(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const STATUS_ICONS = { success: '✅', partial: '⚠️', error: '❌', review: '⊘', processing: '⏳', pdf_only_no_parser: '📄' };
const STATUS_COLORS = { success: 'var(--success)', partial: 'var(--warn)', error: 'var(--critical)', review: 'var(--warn)', processing: 'var(--accent)', pdf_only_no_parser: '#60a5fa' };

async function fetchLogs() {
  let url = `/api/monitoring?action=list-logs&limit=${PAGE_SIZE}&offset=${(page - 1) * PAGE_SIZE}`;
  if (filters.status) url += `&status=${filters.status}`;
  if (filters.specialty) url += `&specialty=${filters.specialty}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error('Failed to fetch logs');
  return resp.json();
}

async function fetchStats() {
  const resp = await fetch('/api/monitoring?action=stats');
  if (!resp.ok) return null;
  return resp.json();
}

function renderStats(stats) {
  const el = document.getElementById('upload-stats');
  if (!el || !stats) return;
  const t = stats.today;
  el.innerHTML = `
    <div class="stat"><span class="stat-value">${t.total}</span><span class="stat-label">Today</span></div>
    <div class="stat"><span class="stat-value" style="color:var(--success)">${t.success}</span><span class="stat-label">Success</span></div>
    <div class="stat"><span class="stat-value" style="color:var(--warn)">${t.partial}</span><span class="stat-label">Partial</span></div>
    <div class="stat"><span class="stat-value" style="color:var(--critical)">${t.error}</span><span class="stat-label">Errors</span></div>
    <div class="stat"><span class="stat-value">${stats.week_success_rate}%</span><span class="stat-label">7d Rate</span></div>
  `;
}

function renderFilters() {
  const el = document.getElementById('upload-filters');
  if (!el) return;
  el.innerHTML = `
    <select id="upload-filter-status" class="audit-filter-select">
      <option value="">All Status</option>
      <option value="success">✅ Success</option>
      <option value="partial">⚠️ Partial</option>
      <option value="error">❌ Error</option>
      <option value="review">⊘ Review</option>
      <option value="pdf_only_no_parser">📄 PDF Only</option>
    </select>
    <button id="upload-refresh" class="refresh-btn" style="width:36px;height:36px;font-size:16px" title="Refresh">⟳</button>
  `;
  document.getElementById('upload-filter-status').value = filters.status;
  document.getElementById('upload-filter-status').addEventListener('change', (e) => {
    filters.status = e.target.value;
    page = 1;
    loadUploads();
  });
  document.getElementById('upload-refresh').addEventListener('click', loadUploads);
}

function renderLogs() {
  const el = document.getElementById('upload-list');
  if (!el) return;

  if (!logs.length) {
    el.innerHTML = '<div class="ed-empty">No upload logs yet.</div>';
    return;
  }

  let html = '';
  for (const log of logs) {
    const icon = STATUS_ICONS[log.status] || '•';
    const color = STATUS_COLORS[log.status] || 'var(--border)';
    const spec = log.detected_specialty || 'Unknown';
    const method = log.match_method ? ` (${log.match_method})` : '';
    const stage = log.detection_stage ? ` via ${log.detection_stage}` : '';

    html += `<div class="upload-card" style="border-right-color:${color}">
      <div class="upload-card-head">
        <span class="upload-card-icon">${icon}</span>
        <div class="upload-card-info">
          <div class="upload-card-filename">${escHtml(log.filename)}</div>
          <div class="upload-card-meta">${escHtml(spec)}${method}${stage} · ${log.entries_count || 0} entries</div>
        </div>
        <span class="upload-card-time">${timeAgo(log.created_at)}</span>
      </div>`;

    if (log.error_message) {
      html += `<div class="upload-card-error">${escHtml(log.error_message)}</div>`;
    }

    if (log.pipeline_trace) {
      html += `<details class="upload-card-trace"><summary>Pipeline Trace</summary><pre>${escHtml(JSON.stringify(log.pipeline_trace, null, 2))}</pre></details>`;
    }

    html += `<div class="upload-card-actions">`;
    if (log.pdf_url) html += `<a href="${escHtml(log.pdf_url)}" target="_blank" class="ed-action-btn">View PDF</a>`;
    html += `<button class="ed-action-btn upload-change-btn" data-id="${log.id}">Change</button>`;
    html += `<button class="ed-action-btn ed-act-del upload-delete-btn" data-id="${log.id}">Delete</button>`;
    html += `</div></div>`;
  }
  el.innerHTML = html;
}

async function deleteLog(id) {
  if (!confirm('Delete this upload log?')) return;
  try {
    await fetch('/api/monitoring?action=delete-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    await loadUploads();
  } catch {}
}

async function loadUploads() {
  try {
    const [logsData, stats] = await Promise.all([fetchLogs(), fetchStats()]);
    logs = logsData || [];
    renderStats(stats);
    renderLogs();
  } catch (err) {
    const el = document.getElementById('upload-list');
    if (el) el.innerHTML = `<div class="error-msg">${err.message}</div>`;
  }
}

async function initUploads() {
  renderFilters();
  await loadUploads();
  // Auto-refresh every 30s
  setInterval(loadUploads, 30000);
}

// ── Change Specialty modal ──
function showChangeSpecialtyModal(log) {
  const overlay = document.createElement('div');
  overlay.className = 'detect-modal-overlay';
  const uploadedAt = new Date(log.created_at).toLocaleString('en-GB', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
  const currentName = (window.SPECIALTY_DISPLAY_NAMES && window.SPECIALTY_DISPLAY_NAMES[log.detected_specialty]) || log.detected_specialty || 'Unknown';

  overlay.innerHTML = `<div class="detect-modal">
    <h3>Change Specialty</h3>
    <div style="font-size:12px;color:#6b7a96;margin-bottom:12px;line-height:1.6">
      Uploaded: <strong>${escHtml(uploadedAt)}</strong><br>Currently: <strong>${escHtml(currentName)}</strong>
    </div>
    <div class="detect-modal-preview">
      ${log.pdf_url ? `<iframe src="${escHtml(log.pdf_url)}#page=1" title="PDF preview"></iframe>` : '<p style="text-align:center;padding:40px;color:#6b7a96">PDF unavailable</p>'}
    </div>
    <p style="font-size:13px;margin-bottom:8px;color:#fff">Change to:</p>
    <input type="text" id="change-spec-input" placeholder="e.g. Cardiology, ENT..." autocomplete="off">
    <div id="change-suggestions" class="detect-suggestions" style="display:none"></div>
    <div id="change-preview" class="detect-preview"></div>
    <div class="detect-modal-actions">
      <button id="change-cancel" class="detect-cancel">Cancel</button>
      <div style="flex:1"></div>
      <button id="change-confirm" class="detect-confirm" disabled>Confirm Change</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);

  const inp = overlay.querySelector('#change-spec-input');
  const suggestions = overlay.querySelector('#change-suggestions');
  const preview = overlay.querySelector('#change-preview');
  const confirmBtn = overlay.querySelector('#change-confirm');
  let currentMatch = null;
  setTimeout(() => inp.focus(), 100);

  inp.addEventListener('input', () => {
    const val = inp.value.trim();
    if (val.length < 2) { suggestions.style.display = 'none'; preview.innerHTML = ''; confirmBtn.disabled = true; currentMatch = null; return; }
    if (typeof window.matchSpecialty !== 'function') return;
    const result = window.matchSpecialty(val);
    currentMatch = result;
    if (result.matched) {
      const name = (window.SPECIALTY_DISPLAY_NAMES && window.SPECIALTY_DISPLAY_NAMES[result.key]) || result.key;
      preview.innerHTML = `<span style="color:#22c55e">\u2713 Will be saved as: ${escHtml(name)}</span>`;
      confirmBtn.disabled = false;
    } else if (result.ambiguous) {
      preview.innerHTML = `<span style="color:#eab308">\u26A0 Multiple matches</span>`;
      confirmBtn.disabled = true;
    } else if (result.isNew) {
      preview.innerHTML = `<span style="color:#3b82f6">\u2713 Will add as new: ${escHtml(val)}</span>`;
      confirmBtn.disabled = false;
    } else { preview.innerHTML = ''; confirmBtn.disabled = true; }
    const matches = window.rankSpecialtySuggestions ? window.rankSpecialtySuggestions(val, 5) : [];
    if (!matches.length) { suggestions.style.display = 'none'; }
    else {
      suggestions.style.display = 'block';
      suggestions.innerHTML = matches.map(m => `<div class="suggest-item" data-name="${escHtml(m.name)}">${escHtml(m.name)}</div>`).join('');
      suggestions.querySelectorAll('.suggest-item').forEach(item => {
        item.addEventListener('click', () => { inp.value = item.dataset.name; suggestions.style.display = 'none'; inp.dispatchEvent(new Event('input')); inp.focus(); });
      });
    }
  });
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !confirmBtn.disabled) confirmBtn.click(); });
  overlay.querySelector('#change-cancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  confirmBtn.addEventListener('click', async () => {
    const val = inp.value.trim();
    if (!val) return;
    confirmBtn.disabled = true; confirmBtn.textContent = 'Saving...';
    try {
      const resp = await fetch('/api/monitoring?action=correct-specialty', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ log_id: log.id, new_specialty_input: val }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        preview.innerHTML = `<span style="color:#ef4444">Error: ${escHtml(err.error || 'failed')}</span>`;
        confirmBtn.disabled = false; confirmBtn.textContent = 'Confirm Change'; return;
      }
      overlay.remove();
      loadUploads();
    } catch { preview.innerHTML = `<span style="color:#ef4444">Network error</span>`; confirmBtn.disabled = false; confirmBtn.textContent = 'Confirm Change'; }
  });
}

// ── Smart Delete ──
async function confirmDeleteUpload(log) {
  const specialty = (window.SPECIALTY_DISPLAY_NAMES && window.SPECIALTY_DISPLAY_NAMES[log.detected_specialty]) || log.detected_specialty || 'Unknown';
  const isCustom = String(log.detected_specialty || '').startsWith('custom_');
  const willRemoveIcon = isCustom ? '\n• If this is the last upload for this specialty, the icon will be removed from the homepage' : '';
  if (!window.confirm(`Delete this upload?\n\nFile: ${log.filename}\nSpecialty: ${specialty}\n\nThis will remove:\n• The kfsher record\n• The upload log\n• The PDF file from storage${willRemoveIcon}\n\nThis cannot be undone.`)) return;
  try {
    const resp = await fetch('/api/monitoring?action=delete-upload', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ log_id: log.id }),
    });
    if (!resp.ok) { alert('Delete failed.'); return; }
    const data = await resp.json().catch(() => ({}));
    if (data.custom_specialty_removed) console.log('[DELETE] Custom specialty removed from homepage');
    loadUploads();
  } catch (err) { alert('Network error: ' + err.message); }
}

// ── Delegated click handlers for Change/Delete ──
document.addEventListener('click', (e) => {
  const changeBtn = e.target.closest('.upload-change-btn');
  if (changeBtn) { e.preventDefault(); const log = logs.find(l => String(l.id) === changeBtn.dataset.id); if (log) showChangeSpecialtyModal(log); return; }
  const delBtn = e.target.closest('.upload-delete-btn');
  if (delBtn) { e.preventDefault(); const log = logs.find(l => String(l.id) === delBtn.dataset.id); if (log) confirmDeleteUpload(log); return; }
});

return { initUploads, deleteLog };

})();
