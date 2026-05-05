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

const STATUS_ICONS = { success: '✅', partial: '⚠️', error: '❌', cancelled: '⊘', processing: '⏳', pdf_only_no_parser: '📄' };
const STATUS_COLORS = { success: 'var(--success)', partial: 'var(--warn)', error: 'var(--critical)', cancelled: 'var(--muted)', processing: 'var(--accent)', pdf_only_no_parser: '#60a5fa' };

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
      <option value="cancelled">⊘ Cancelled</option>
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
    html += `<button class="ed-action-btn ed-act-del" onclick="Uploads.deleteLog(${log.id})">Delete</button>`;
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

return { initUploads, deleteLog };

})();
