// admin/visitors.js — Visitor log viewer
const Visitors = (function () {

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
  const d = new Date(iso);
  if (isNaN(d)) return '—';
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

async function loadVisitors() {
  const list = document.getElementById('visitors-list');
  const stats = document.getElementById('visitors-stats');
  try {
    const cfgResp = await fetch('/api/admin?action=config');
    const cfg = await cfgResp.json();
    if (!cfg.supabaseUrl || !cfg.supabaseKey) { list.innerHTML = '<div class="ed-empty">Supabase not configured</div>'; return; }

    const resp = await fetch(cfg.supabaseUrl + '/rest/v1/visitor_log?select=*&order=visited_at.desc&limit=200', {
      headers: { 'apikey': cfg.supabaseKey, 'Authorization': 'Bearer ' + cfg.supabaseKey },
    });
    if (!resp.ok) { list.innerHTML = '<div class="error-msg">Failed to load</div>'; return; }
    const rows = await resp.json();

    // Stats
    const today = new Date(); today.setHours(0,0,0,0);
    const todayCount = rows.filter(r => new Date(r.visited_at) >= today).length;
    const remCount = rows.filter(r => r.remembered).length;
    stats.innerHTML = `Today: <strong>${todayCount}</strong> visits · Total: <strong>${rows.length}</strong> (last 200) · Remembered: <strong>${remCount}</strong>`;

    if (!rows.length) { list.innerHTML = '<div class="ed-empty">No visitors yet</div>'; return; }

    let html = '<table class="ed-table"><thead><tr><th>Time</th><th>Ago</th><th>Device</th><th>Screen</th><th>Remembered</th></tr></thead><tbody>';
    for (const r of rows) {
      const isToday = new Date(r.visited_at) >= today;
      html += `<tr class="ed-row" style="${isToday ? 'background:rgba(0,229,160,0.04)' : ''}">
        <td style="font-family:var(--mono);font-size:12px">${formatTime(r.visited_at)}</td>
        <td style="font-size:12px;color:var(--muted)">${timeAgo(r.visited_at)}</td>
        <td style="font-size:12px">${escHtml(parseUA(r.user_agent))}</td>
        <td style="font-family:var(--mono);font-size:12px;color:var(--muted)">${r.screen_width || '—'}px</td>
        <td style="font-size:12px">${r.remembered ? '✅' : '—'}</td>
      </tr>`;
    }
    html += '</tbody></table>';
    list.innerHTML = html;
  } catch (err) {
    list.innerHTML = '<div class="error-msg">' + escHtml(err.message) + '</div>';
  }
}

async function initVisitors() {
  await loadVisitors();
  document.getElementById('visitors-refresh')?.addEventListener('click', loadVisitors);
}

return { initVisitors };
})();
