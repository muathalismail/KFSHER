// ═══════════════════════════════════════════════════════════════
// admin/phones.js — Manual Phones Manager
// ═══════════════════════════════════════════════════════════════

const Phones = (function () {

let allPhones = [];
let filtered = [];
let searchQuery = '';

function escHtml(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'الآن';
  if (mins < 60) return `منذ ${mins} د`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `منذ ${hours} س`;
  return `منذ ${Math.floor(hours / 24)} يوم`;
}

async function fetchPhones() {
  const resp = await fetch(`/api/manual-phone?_t=${Date.now()}`);
  if (!resp.ok) throw new Error('Failed to fetch');
  return resp.json();
}

function applyFilter() {
  if (!searchQuery) { filtered = [...allPhones]; return; }
  const q = searchQuery.toLowerCase();
  filtered = allPhones.filter(p =>
    p.full_name.toLowerCase().includes(q) || p.phone.includes(q)
  );
}

function render() {
  const wrap = document.getElementById('phone-table-wrap');
  const countEl = document.getElementById('phone-count');
  if (!wrap) return;

  applyFilter();
  if (countEl) countEl.textContent = `${filtered.length} رقم`;

  if (!filtered.length) {
    wrap.innerHTML = '<div class="ed-empty">لا توجد أرقام يدوية. اضغط ➕ لإضافة.</div>';
    return;
  }

  let html = `<table class="ed-table"><thead><tr>
    <th>الاسم</th><th>الرقم</th><th>التخصص</th><th>آخر تحديث</th><th>إجراءات</th>
  </tr></thead><tbody>`;

  for (const p of filtered) {
    html += `<tr class="ed-row">
      <td style="font-weight:600">${escHtml(p.full_name)}</td>
      <td style="font-family:var(--mono);color:var(--accent);direction:ltr">${escHtml(p.phone)}</td>
      <td style="color:var(--muted);font-size:12px">${escHtml(p.specialty_hint || '—')}</td>
      <td style="color:var(--muted);font-size:11px">${timeAgo(p.updated_at)}</td>
      <td>
        <button class="ed-act-btn" onclick="Phones.editPhone(${p.id})" title="تعديل">✏️</button>
        <button class="ed-act-btn ed-act-del" onclick="Phones.deletePhone(${p.id},'${escHtml(p.full_name)}')" title="حذف">🗑️</button>
      </td>
    </tr>`;
  }
  html += '</tbody></table>';
  wrap.innerHTML = html;
}

async function addPhone() {
  const name = prompt('اسم الطبيب الكامل:');
  if (!name) return;
  const phone = prompt('رقم الهاتف (05xxxxxxxx):');
  if (!phone || !/^05\d{8}$/.test(phone.trim())) { alert('رقم غير صالح'); return; }
  const specialty = prompt('التخصص (اختياري):') || '';

  try {
    await fetch('/api/manual-phone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'upsert', full_name: name.trim(), phone: phone.trim(), specialty_hint: specialty }),
    });
    await reload();
  } catch {}
}

async function editPhone(id) {
  const p = allPhones.find(x => x.id === id);
  if (!p) return;
  const phone = prompt(`رقم جديد لـ ${p.full_name}:`, p.phone);
  if (!phone || phone === p.phone) return;
  if (!/^05\d{8}$/.test(phone.trim())) { alert('رقم غير صالح'); return; }

  try {
    await fetch('/api/manual-phone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'upsert', full_name: p.full_name, phone: phone.trim(), specialty_hint: p.specialty_hint }),
    });
    await reload();
  } catch {}
}

async function deletePhone(id, name) {
  if (!confirm(`حذف رقم ${name}?`)) return;
  try {
    await fetch('/api/manual-phone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete', id }),
    });
    await reload();
  } catch {}
}

function exportCSV() {
  if (!allPhones.length) return;
  const rows = [['Name', 'Phone', 'Specialty', 'Updated'].join(',')];
  for (const p of allPhones) {
    rows.push([`"${p.full_name}"`, p.phone, `"${p.specialty_hint || ''}"`, p.updated_at].join(','));
  }
  const blob = new Blob(['\uFEFF' + rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `manual_phones_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
}

async function reload() {
  try {
    allPhones = await fetchPhones();
    render();
  } catch (err) {
    const wrap = document.getElementById('phone-table-wrap');
    if (wrap) wrap.innerHTML = `<div class="error-msg">${err.message}</div>`;
  }
}

async function initPhones() {
  document.getElementById('phone-add-btn')?.addEventListener('click', addPhone);
  document.getElementById('phone-export-btn')?.addEventListener('click', exportCSV);
  const searchEl = document.getElementById('phone-search');
  if (searchEl) {
    searchEl.addEventListener('input', () => {
      searchQuery = searchEl.value;
      render();
    });
  }
  await reload();
}

return { initPhones, editPhone, deletePhone };

})();
