// admin/visitors.js — Visitor log + User management
const Visitors = (function () {

let _cfg = null;
function escHtml(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
function parseUA(ua) {
  if (!ua) return 'Unknown';
  if (/iPhone/i.test(ua)) return '📱 iPhone';
  if (/iPad/i.test(ua)) return '📱 iPad';
  if (/Android/i.test(ua)) return '📱 Android';
  if (/Mac/i.test(ua)) return '💻 Mac';
  if (/Windows/i.test(ua)) return '💻 Windows';
  return '🖥️ Other';
}
function formatTime(iso) {
  const d = new Date(iso); if (isNaN(d)) return '—';
  return d.toLocaleString('en-GB', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit', second:'2-digit' });
}
function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  return Math.floor(hrs / 24) + 'd ago';
}

async function getCfg() {
  if (_cfg) return _cfg;
  const r = await fetch('/api/admin?action=config');
  _cfg = await r.json();
  return _cfg;
}

// ── Users section ──
async function loadUsers() {
  const el = document.getElementById('users-list');
  if (!el) return;
  try {
    const cfg = await getCfg();
    const resp = await fetch(cfg.supabaseUrl + '/rest/v1/site_users?select=*&order=created_at.desc', {
      headers: { 'apikey': cfg.supabaseKey, 'Authorization': 'Bearer ' + cfg.supabaseKey },
    });
    const users = await resp.json();
    if (!users || !users.length) { el.innerHTML = '<div class="ed-empty">No users</div>'; return; }

    const pending = users.filter(u => !u.is_approved);
    let html = '';
    if (pending.length) {
      html += '<div style="font-size:13px;font-weight:600;color:var(--warn);margin-bottom:8px">⏳ Pending Approval (' + pending.length + ')</div>';
    }
    html += '<table class="ed-table"><thead><tr><th>Username</th><th>Password</th><th>Email</th><th>Created</th><th>Status</th><th>Actions</th></tr></thead><tbody>';
    for (const u of users) {
      const statusBadge = !u.is_approved ? '<span style="color:var(--warn)">⏳ Pending</span>'
        : u.is_active ? '<span style="color:var(--success)">✅ Active</span>'
        : '<span style="color:var(--muted)">❌ Disabled</span>';
      html += '<tr class="ed-row">';
      html += '<td style="font-weight:600">' + escHtml(u.username) + '</td>';
      html += '<td style="font-family:var(--mono);font-size:12px;color:var(--muted)">' + escHtml(u.password) + '</td>';
      html += '<td style="font-size:12px;color:var(--muted)">' + escHtml(u.email) + '</td>';
      html += '<td style="font-size:11px;color:var(--muted)">' + timeAgo(u.created_at) + '</td>';
      html += '<td>' + statusBadge + '</td>';
      html += '<td>';
      if (!u.is_approved) {
        html += '<button class="ed-action-btn" style="color:var(--success)" onclick="Visitors.approveUser(' + u.id + ')">Approve</button> ';
      }
      if (u.is_active && u.is_approved) {
        html += '<button class="ed-action-btn" style="color:var(--muted)" onclick="Visitors.toggleUser(' + u.id + ',false)">Disable</button>';
      } else if (!u.is_active && u.is_approved) {
        html += '<button class="ed-action-btn" style="color:var(--success)" onclick="Visitors.toggleUser(' + u.id + ',true)">Enable</button>';
      }
      if (!u.is_approved) {
        html += '<button class="ed-action-btn ed-act-del" onclick="Visitors.deleteUser(' + u.id + ')">Reject</button>';
      }
      html += '</td></tr>';
    }
    html += '</tbody></table>';
    el.innerHTML = html;
  } catch (err) { el.innerHTML = '<div class="error-msg">' + escHtml(err.message) + '</div>'; }
}

async function approveUser(id) {
  const cfg = await getCfg();
  await fetch(cfg.supabaseUrl + '/rest/v1/site_users?id=eq.' + id, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', 'apikey': cfg.supabaseKey, 'Authorization': 'Bearer ' + cfg.supabaseKey, 'Prefer': 'return=minimal' },
    body: JSON.stringify({ is_approved: true }),
  });
  loadUsers();
}

async function toggleUser(id, active) {
  const cfg = await getCfg();
  await fetch(cfg.supabaseUrl + '/rest/v1/site_users?id=eq.' + id, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', 'apikey': cfg.supabaseKey, 'Authorization': 'Bearer ' + cfg.supabaseKey, 'Prefer': 'return=minimal' },
    body: JSON.stringify({ is_active: active }),
  });
  loadUsers();
}

async function deleteUser(id) {
  if (!confirm('Reject and delete this user?')) return;
  const cfg = await getCfg();
  await fetch(cfg.supabaseUrl + '/rest/v1/site_users?id=eq.' + id, {
    method: 'DELETE', headers: { 'apikey': cfg.supabaseKey, 'Authorization': 'Bearer ' + cfg.supabaseKey },
  });
  loadUsers();
}

// ── Visitors section ──
async function loadVisitors() {
  const list = document.getElementById('visitors-list');
  const stats = document.getElementById('visitors-stats');
  try {
    const cfg = await getCfg();
    const resp = await fetch(cfg.supabaseUrl + '/rest/v1/visitor_log?select=*&order=visited_at.desc&limit=200', {
      headers: { 'apikey': cfg.supabaseKey, 'Authorization': 'Bearer ' + cfg.supabaseKey },
    });
    const rows = await resp.json();

    const today = new Date(); today.setHours(0,0,0,0);
    const todayCount = rows.filter(r => new Date(r.visited_at) >= today).length;
    stats.innerHTML = 'Today: <strong>' + todayCount + '</strong> visits · Total: <strong>' + rows.length + '</strong> (last 200)';

    if (!rows.length) { list.innerHTML = '<div class="ed-empty">No visitors yet</div>'; return; }

    let html = '<table class="ed-table"><thead><tr><th>User</th><th>Time</th><th>Ago</th><th>Device</th><th>Screen</th></tr></thead><tbody>';
    for (const r of rows) {
      const isToday = new Date(r.visited_at) >= today;
      html += '<tr class="ed-row" style="' + (isToday ? 'background:rgba(0,229,160,0.04)' : '') + '">';
      html += '<td style="font-weight:600;font-size:13px">' + escHtml(r.username || '—') + '</td>';
      html += '<td style="font-family:var(--mono);font-size:12px">' + formatTime(r.visited_at) + '</td>';
      html += '<td style="font-size:12px;color:var(--muted)">' + timeAgo(r.visited_at) + '</td>';
      html += '<td style="font-size:12px">' + escHtml(parseUA(r.user_agent)) + '</td>';
      html += '<td style="font-family:var(--mono);font-size:12px;color:var(--muted)">' + (r.screen_width || '—') + 'px</td>';
      html += '</tr>';
    }
    html += '</tbody></table>';
    list.innerHTML = html;
  } catch (err) { list.innerHTML = '<div class="error-msg">' + escHtml(err.message) + '</div>'; }
}

async function initVisitors() {
  await loadUsers();
  await loadVisitors();
  document.getElementById('visitors-refresh')?.addEventListener('click', function() { loadUsers(); loadVisitors(); });
}

return { initVisitors, approveUser, toggleUser, deleteUser };
})();
