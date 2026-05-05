const base64 = require('buffer').Buffer;
const MONITORING_ENABLED = process.env.ENABLE_UPLOAD_MONITORING === 'true';
let _matcherLoaded = false;
let matchSpecialty = null;
function ensureMatcher() {
  if (_matcherLoaded) return;
  _matcherLoaded = true;
  try {
    const m = require('../assets/js/data/specialty-aliases.js');
    matchSpecialty = m.matchSpecialty;
  } catch { matchSpecialty = null; }
}

module.exports = async function handler(req, res) {
  ensureMatcher();
  const action = req.query.action || (req.method === 'GET' ? 'list-logs' : '');

  // Health check — always responds (even when disabled)
  if (action === 'health-check') {
    return res.status(MONITORING_ENABLED ? 200 : 503).json({ enabled: MONITORING_ENABLED });
  }

  if (!MONITORING_ENABLED) {
    return res.status(503).json({ error: 'monitoring_disabled' });
  }

  try {
    switch (action) {
      case 'save-log':            return handleSaveLog(req, res);
      case 'update-log':          return handleUpdateLog(req, res);
      case 'finalize-upload':     return handleFinalizeUpload(req, res);
      case 'custom-specialties':  return handleListCustomSpecialties(req, res);
      case 'list-logs':           return handleListLogs(req, res);
      case 'get-log':             return handleGetLog(req, res);
      case 'delete-log':          return handleDeleteLog(req, res);
      case 'stats':               return handleStats(req, res);
      case 'detect-header':       return handleDetectHeader(req, res);
      case 'save-cancelled-pdf':  return handleSaveCancelledPdf(req, res);
      case 'correct-specialty':  return handleCorrectSpecialty(req, res);
      case 'delete-upload':      return handleDeleteUpload(req, res);
      default: return res.status(400).json({ error: `Unknown action: ${action}` });
    }
  } catch (err) {
    console.error('[monitoring] Error:', err);
    return res.status(500).json({ error: err.message });
  }
};

// ── Supabase helpers ──
function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('Supabase not configured');
  return { url, key, headers: { 'Content-Type': 'application/json', 'apikey': key, 'Authorization': `Bearer ${key}` } };
}

// ── Save initial upload log ──
async function handleSaveLog(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });
  const { url, headers } = getSupabase();
  const { filename, file_size_bytes, pdf_storage_path, pdf_url, detection_stage, detected_specialty, manual_override_input, match_method, status } = req.body;

  const resp = await fetch(`${url}/rest/v1/upload_logs`, {
    method: 'POST',
    headers: { ...headers, 'Prefer': 'return=representation' },
    body: JSON.stringify({
      filename: filename || 'unknown.pdf',
      file_size_bytes: file_size_bytes || 0,
      pdf_storage_path: pdf_storage_path || null,
      pdf_url: pdf_url || null,
      detection_stage: detection_stage || null,
      detected_specialty: detected_specialty || null,
      manual_override_input: manual_override_input || null,
      match_method: match_method || null,
      status: status || 'processing',
    }),
  });
  if (!resp.ok) return res.status(500).json({ error: await resp.text() });
  const rows = await resp.json();
  return res.status(200).json(rows[0] || { ok: true });
}

// ── Update existing log (conditional spread — never overwrites pdf_url with null) ──
async function handleUpdateLog(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });
  const { url, headers } = getSupabase();
  const { log_id } = req.body;
  if (!log_id) return res.status(400).json({ error: 'Missing log_id' });

  const patchBody = {
    ...(req.body.status !== undefined ? { status: req.body.status } : {}),
    ...(req.body.entries_count !== undefined ? { entries_count: req.body.entries_count } : {}),
    ...(req.body.detected_specialty ? { detected_specialty: req.body.detected_specialty } : {}),
    ...(req.body.match_method ? { match_method: req.body.match_method } : {}),
    ...(req.body.error_code ? { error_code: req.body.error_code } : {}),
    ...(req.body.error_message ? { error_message: req.body.error_message } : {}),
    ...(req.body.pipeline_trace ? { pipeline_trace: req.body.pipeline_trace } : {}),
    ...(req.body.pdf_storage_path ? { pdf_storage_path: req.body.pdf_storage_path } : {}),
    ...(req.body.pdf_url ? { pdf_url: req.body.pdf_url } : {}),
  };

  const resp = await fetch(`${url}/rest/v1/upload_logs?id=eq.${log_id}`, {
    method: 'PATCH',
    headers: { ...headers, 'Prefer': 'return=minimal' },
    body: JSON.stringify(patchBody),
  });
  if (!resp.ok) return res.status(500).json({ error: await resp.text() });
  return res.status(200).json({ ok: true });
}

// ── Save cancelled PDF to Storage only (no kfsher row) ──
async function handleSaveCancelledPdf(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });
  const { pdf_base64, pdf_name } = req.body || {};
  if (!pdf_base64 || !pdf_name) return res.status(400).json({ error: 'Missing pdf_base64 or pdf_name' });

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return res.status(500).json({ error: 'no supabase config' });

  try {
    const safeName = pdf_name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `cancelled/${Date.now()}_${safeName}`;
    const buf = base64.from(pdf_base64, 'base64');

    const upResp = await fetch(`${url}/storage/v1/object/rota-pdfs/${path}`, {
      method: 'POST',
      headers: { 'apikey': key, 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/pdf', 'x-upsert': 'false' },
      body: buf,
    });

    if (!upResp.ok) return res.status(500).json({ error: 'storage upload failed', detail: await upResp.text() });

    const pdf_url = `${url}/storage/v1/object/public/rota-pdfs/${path}`;
    return res.status(200).json({ ok: true, path, pdf_url });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

// ── Finalize upload (after manual specialty selection) ──
async function handleFinalizeUpload(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });
  const { url, headers } = getSupabase();
  const { log_id, specialty_input, action: userAction } = req.body;

  if (userAction === 'cancel') {
    await fetch(`${url}/rest/v1/upload_logs?id=eq.${log_id}`, {
      method: 'PATCH',
      headers: { ...headers, 'Prefer': 'return=minimal' },
      body: JSON.stringify({ status: 'review' }),
    }).catch(() => {});
    return res.status(200).json({ ok: true, status: 'review' });
  }

  // Run smart matching server-side
  const matchResult = _smartMatch(specialty_input || '');

  if (matchResult.ambiguous) {
    return res.status(200).json({ ambiguous: true, candidates: matchResult.candidates });
  }

  if (matchResult.isNew) {
    // Create custom specialty
    const customKey = 'custom_' + (matchResult.customName || specialty_input || 'unknown')
      .toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '').slice(0, 50);

    await fetch(`${url}/rest/v1/custom_specialties`, {
      method: 'POST',
      headers: { ...headers, 'Prefer': 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({
        key: customKey,
        display_name: specialty_input || matchResult.customName || 'Unknown',
        last_upload_at: new Date().toISOString(),
      }),
    }).catch(() => {});

    await fetch(`${url}/rest/v1/upload_logs?id=eq.${log_id}`, {
      method: 'PATCH',
      headers: { ...headers, 'Prefer': 'return=minimal' },
      body: JSON.stringify({
        detected_specialty: customKey,
        manual_override_input: specialty_input,
        match_method: 'custom_new',
        is_custom_specialty: true,
        status: 'pdf_only_no_parser',
      }),
    }).catch(() => {});

    return res.status(200).json({ ok: true, key: customKey, isCustom: true });
  }

  // Matched — update log
  await fetch(`${url}/rest/v1/upload_logs?id=eq.${log_id}`, {
    method: 'PATCH',
    headers: { ...headers, 'Prefer': 'return=minimal' },
    body: JSON.stringify({
      detected_specialty: matchResult.key,
      manual_override_input: specialty_input,
      match_method: matchResult.method,
      detection_stage: 'manual',
    }),
  }).catch(() => {});

  return res.status(200).json({ ok: true, key: matchResult.key, method: matchResult.method });
}

// ── Detect specialty from header text (Claude API) ──
// DEPRECATED (P1B): Client no longer calls this. Confirm/Edit modal replaced header detection.
async function handleDetectHeader(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });
  const { header_text } = req.body || {};
  if (!header_text || typeof header_text !== 'string' || header_text.length < 5) {
    return res.status(200).json({ specialty: null, confidence: 'low' });
  }
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(200).json({ specialty: null, confidence: 'low' });

    const apiResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 100,
        messages: [{ role: 'user', content: `You are analyzing the header of a hospital on-call schedule PDF.\nExtract ONLY the specialty/department name from this header text.\nReturn strict JSON: {"specialty": "<name>", "confidence": "high"|"medium"|"low"}\nIf no specialty is identifiable, return {"specialty": null, "confidence": "low"}.\n\nHeader text:\n${header_text.slice(0, 800)}` }],
      }),
    });
    if (!apiResp.ok) return res.status(200).json({ specialty: null, confidence: 'low' });
    const data = await apiResp.json();
    const text = (data?.content?.[0]?.text || '').trim().replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(text);
    if (parsed?.specialty) {
      const matched = _smartMatch(parsed.specialty);
      if (matched.matched) return res.status(200).json({ specialty: matched.key, confidence: parsed.confidence || 'medium', raw: parsed.specialty });
    }
    return res.status(200).json({ specialty: null, confidence: 'low', raw: parsed?.specialty });
  } catch (err) {
    return res.status(200).json({ specialty: null, confidence: 'low', error: err.message });
  }
}

// ── List custom specialties (public) ──
async function handleListCustomSpecialties(req, res) {
  const { url, headers } = getSupabase();
  const resp = await fetch(`${url}/rest/v1/custom_specialties?select=*&order=last_upload_at.desc&limit=50`, { headers });
  if (!resp.ok) return res.status(200).json([]);
  res.setHeader('Cache-Control', 'public, max-age=60');
  return res.status(200).json(await resp.json());
}

// ── List upload logs (admin) ──
async function handleListLogs(req, res) {
  const { url, headers } = getSupabase();
  const { status, specialty, limit, offset } = req.query;
  let endpoint = `${url}/rest/v1/upload_logs?select=*&order=created_at.desc`;
  if (status) endpoint += `&status=eq.${encodeURIComponent(status)}`;
  if (specialty) endpoint += `&detected_specialty=eq.${encodeURIComponent(specialty)}`;
  endpoint += `&limit=${limit || 50}&offset=${offset || 0}`;

  const resp = await fetch(endpoint, { headers });
  if (!resp.ok) return res.status(500).json({ error: await resp.text() });
  return res.status(200).json(await resp.json());
}

// ── Get single log ──
async function handleGetLog(req, res) {
  const { url, headers } = getSupabase();
  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'Missing id' });
  const resp = await fetch(`${url}/rest/v1/upload_logs?id=eq.${id}&limit=1`, { headers });
  if (!resp.ok) return res.status(500).json({ error: await resp.text() });
  const rows = await resp.json();
  return res.status(200).json(rows[0] || null);
}

// ── Delete log ──
async function handleDeleteLog(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });
  const { url, headers } = getSupabase();
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: 'Missing id' });
  await fetch(`${url}/rest/v1/upload_logs?id=eq.${id}`, { method: 'DELETE', headers });
  return res.status(200).json({ ok: true });
}

// ── Upload stats ──
async function handleStats(req, res) {
  const { url, headers } = getSupabase();
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [todayResp, weekResp] = await Promise.all([
    fetch(`${url}/rest/v1/upload_logs?select=status&created_at=gte.${todayStart.toISOString()}&limit=500`, { headers }),
    fetch(`${url}/rest/v1/upload_logs?select=status&created_at=gte.${weekAgo.toISOString()}&limit=2000`, { headers }),
  ]);

  const todayRows = todayResp.ok ? await todayResp.json() : [];
  const weekRows = weekResp.ok ? await weekResp.json() : [];

  const count = (rows, s) => rows.filter(r => r.status === s).length;
  return res.status(200).json({
    today: { total: todayRows.length, success: count(todayRows, 'success'), partial: count(todayRows, 'partial'), error: count(todayRows, 'error') },
    week_success_rate: weekRows.length ? Math.round((count(weekRows, 'success') / weekRows.length) * 100) : 100,
  });
}

// ═══════════════════════════════════════════════════════════════
// Internal helpers
// ═══════════════════════════════════════════════════════════════

// ── Smart Matching (server-side — uses shared module or inline fallback) ──
// NOTE: old detectSpecialtyFromHeader removed — header text now extracted client-side
//       and sent as plain text to handleDetectHeader above.

// ── Smart Matching (server-side mirror of client) ──
function _smartMatch(input) {
  // Use shared matcher if loaded, else inline fallback
  if (matchSpecialty) return matchSpecialty(input);
  if (!input || !input.trim()) return { matched: false, isNew: false };
  const norm = input.toLowerCase().replace(/[^a-z0-9\u0600-\u06FF\s-]/g, '').replace(/\s+/g, ' ').trim();
  if (!norm) return { matched: false, isNew: false };

  const ALIASES = {
    medicine_on_call: ['medicine on call','medicine on-call','internal medicine on call','im on call'],
    hospitalist: ['hospitalist','hospitalists','hospital medicine'],
    surgery: ['surgery','general surgery','gen surg'],
    pediatrics: ['pediatrics','peds','pediatric','general pediatrics'],
    ent: ['ent','otolaryngology','ear nose throat'],
    orthopedics: ['orthopedics','orthopaedics','ortho','orthopedic surgery'],
    radiology_oncall: ['radiology on-call','radiology oncall','imaging on-call','imaging oncall'],
    radiology_duty: ['radiology duty','imaging on-duty','imaging duty'],
    palliative: ['palliative','palliative care','palliative medicine'],
    neurology: ['neurology','neuro','adult neurology'],
    neurosurgery: ['neurosurgery','neuro surgery','neurosurgical'],
    spine: ['spine','spine surgery','spinal surgery'],
    gynecology: ['gynecology','gyn','obgyn','ob-gyn','obstetrics gynecology'],
    critical_care: ['icu','critical care','intensive care','ccu'],
    picu: ['picu','pediatric icu','pediatric intensive care'],
    anesthesia: ['anesthesia','anaesthesia','anesthesiology'],
    psychiatry: ['psychiatry','psych','mental health'],
    pediatric_neurology: ['pediatric neurology','ped neuro','pnd','child neurology'],
    pediatric_cardiology: ['pediatric cardiology','ped cardio','child cardiology'],
    pediatric_heme_onc: ['pediatric heme-onc','ped heme onc','pediatric hematology oncology'],
    neuro_ir: ['neuro ir','neurointerventional'],
    urology: ['urology','uro'],
    ophthalmology: ['ophthalmology','eye','ophth'],
    oncology: ['oncology','adult oncology','medical oncology'],
    hematology: ['hematology-oncology','heme-onco','heme onc','adult hematology'],
    radonc: ['rad-onc','radiation oncology','radonc'],
    nephrology: ['nephrology','nephro','kidney'],
    kptx: ['kidney transplant','kidney-tx','kptx'],
    liver: ['liver transplant','liver-tx'],
    adult_cardiology: ['cardiology','adult cardiology','cardio'],
    medicine: ['medicine','internal medicine','im'],
    dental: ['dental','dentistry'],
    clinical_lab: ['clinical lab','lab','pathology'],
    physical_medicine_rehabilitation: ['pmr','physical medicine','rehabilitation','rehab'],
    endocrinology: ['endocrinology','endo'],
    dermatology: ['dermatology','derm'],
    rheumatology: ['rheumatology','rheum'],
    gastroenterology: ['gastroenterology','gi','gastro'],
    pulmonary: ['pulmonary','pulmonology','chest','respiratory'],
    infectious: ['infectious disease','infectious','infection'],
  };

  // Exact alias match
  for (const [key, aliases] of Object.entries(ALIASES)) {
    if (norm === key.replace(/_/g, ' ')) return { matched: true, key, method: 'exact' };
    for (const alias of aliases) {
      if (norm === alias) return { matched: true, key, method: 'alias' };
    }
  }

  // Fuzzy with adult-default
  const inputWords = norm.split(/\s+/);
  const hasPedHint = inputWords.some(w => ['ped','pediatric','peds','child','infant'].includes(w));
  const candidates = [];
  for (const [key, aliases] of Object.entries(ALIASES)) {
    if (!hasPedHint && (key.startsWith('pediatric_') || key === 'picu')) continue;
    for (const alias of [key.replace(/_/g, ' '), ...aliases]) {
      const aw = alias.split(/\s+/);
      if (inputWords.every(iw => aw.some(a => a.includes(iw) || iw.includes(a)))) {
        candidates.push({ key, matchLength: aw.length });
        break;
      }
    }
  }

  if (!candidates.length) return { matched: false, isNew: true, customName: input.trim() };
  if (candidates.length === 1) return { matched: true, key: candidates[0].key, method: 'fuzzy' };

  const maxLen = Math.max(...candidates.map(c => c.matchLength));
  const winners = candidates.filter(c => c.matchLength === maxLen);
  if (winners.length === 1) return { matched: true, key: winners[0].key, method: 'fuzzy' };

  return { matched: false, ambiguous: true, candidates: winners.map(w => w.key) };
}

// ── Correct specialty (Move + Replace, safe) ──
async function handleCorrectSpecialty(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });
  const { log_id, new_specialty_input } = req.body || {};
  if (!log_id || !new_specialty_input) return res.status(400).json({ error: 'Missing log_id or new_specialty_input' });

  ensureMatcher();
  const matchResult = matchSpecialty ? matchSpecialty(new_specialty_input) : { matched: false };
  let newKey, isCustom = false;
  if (matchResult.matched) { newKey = matchResult.key; }
  else if (matchResult.isNew) {
    newKey = 'custom_' + new_specialty_input.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
    isCustom = true;
    await upsertCustomSpecialty(newKey, new_specialty_input);
  } else if (matchResult.ambiguous) {
    return res.status(400).json({ error: 'ambiguous', candidates: matchResult.candidates });
  } else { return res.status(400).json({ error: 'no_match' }); }

  const { url, headers } = getSupabase();
  const logResp = await fetch(`${url}/rest/v1/upload_logs?id=eq.${log_id}&select=*`, { headers });
  const logRows = await logResp.json();
  const logRow = Array.isArray(logRows) ? logRows[0] : null;
  if (!logRow) return res.status(404).json({ error: 'log not found' });

  const oldKey = logRow.detected_specialty;
  if (oldKey === newKey) return res.status(200).json({ ok: true, unchanged: true });

  let kfRow = null;
  if (logRow.pdf_url) {
    const r = await fetch(`${url}/rest/v1/kfsher?pdf_url=eq.${encodeURIComponent(logRow.pdf_url)}&select=*`, { headers });
    const rows = await r.json();
    kfRow = Array.isArray(rows) ? rows[0] : null;
  }

  let movedRow = false;
  if (kfRow) {
    await fetch(`${url}/rest/v1/kfsher?specialty=eq.${newKey}&id=neq.${kfRow.id}`, { method: 'DELETE', headers: { ...headers, 'Prefer': 'return=minimal' } }).catch(() => {});
    const patchResp = await fetch(`${url}/rest/v1/kfsher?id=eq.${kfRow.id}`, { method: 'PATCH', headers: { ...headers, 'Prefer': 'return=minimal' }, body: JSON.stringify({ specialty: newKey }) });
    movedRow = patchResp.ok;
  }

  await fetch(`${url}/rest/v1/upload_logs?id=eq.${log_id}`, { method: 'PATCH', headers: { ...headers, 'Prefer': 'return=minimal' }, body: JSON.stringify({ original_specialty: logRow.original_specialty || oldKey, corrected_specialty: newKey, corrected_at: new Date().toISOString(), detected_specialty: newKey, is_custom_specialty: isCustom }) });

  try { await fetch(`${url}/rest/v1/audit_log`, { method: 'POST', headers: { ...headers, 'Prefer': 'return=minimal' }, body: JSON.stringify({ action: 'specialty_corrected', specialty: newKey, entry_id: kfRow ? String(kfRow.id) : `log_${log_id}`, old_value: oldKey, new_value: newKey }) }); } catch {}

  return res.status(200).json({ ok: true, new_key: newKey, isCustom, moved_kfsher_row: movedRow });
}

// ── Delete upload (with smart custom cleanup) ──
async function handleDeleteUpload(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });
  const { log_id } = req.body || {};
  if (!log_id) return res.status(400).json({ error: 'Missing log_id' });

  const { url, headers } = getSupabase();
  const logResp = await fetch(`${url}/rest/v1/upload_logs?id=eq.${log_id}&select=*`, { headers });
  const logRows = await logResp.json();
  const logRow = Array.isArray(logRows) ? logRows[0] : null;
  if (!logRow) return res.status(404).json({ error: 'log not found' });

  const specialtyKey = logRow.detected_specialty;

  let kfsherDeleted = false;
  if (logRow.pdf_url) {
    const r = await fetch(`${url}/rest/v1/kfsher?pdf_url=eq.${encodeURIComponent(logRow.pdf_url)}`, { method: 'DELETE', headers: { ...headers, 'Prefer': 'return=minimal' } }).catch(() => null);
    kfsherDeleted = !!(r && r.ok);
  }

  let storageDeleted = false;
  if (logRow.pdf_storage_path) {
    const r = await fetch(`${url}/storage/v1/object/rota-pdfs/${logRow.pdf_storage_path}`, { method: 'DELETE', headers }).catch(() => null);
    storageDeleted = !!(r && r.ok);
  }

  let isLastUpload = false;
  if (specialtyKey) {
    const remResp = await fetch(`${url}/rest/v1/upload_logs?detected_specialty=eq.${specialtyKey}&id=neq.${log_id}&select=id&limit=1`, { headers });
    const remaining = await remResp.json();
    isLastUpload = Array.isArray(remaining) && remaining.length === 0;
  }

  let customSpecialtyRemoved = false;
  if (isLastUpload && specialtyKey && specialtyKey.startsWith('custom_')) {
    const r = await fetch(`${url}/rest/v1/custom_specialties?key=eq.${specialtyKey}`, { method: 'DELETE', headers: { ...headers, 'Prefer': 'return=minimal' } }).catch(() => null);
    customSpecialtyRemoved = !!(r && r.ok);
  }

  const logDelResp = await fetch(`${url}/rest/v1/upload_logs?id=eq.${log_id}`, { method: 'DELETE', headers: { ...headers, 'Prefer': 'return=minimal' } });

  try { await fetch(`${url}/rest/v1/audit_log`, { method: 'POST', headers: { ...headers, 'Prefer': 'return=minimal' }, body: JSON.stringify({ action: customSpecialtyRemoved ? 'upload_and_specialty_deleted' : 'upload_deleted', specialty: specialtyKey, entry_id: `log_${log_id}`, old_value: logRow.filename, new_value: 'DELETED' }) }); } catch {}

  return res.status(200).json({ ok: true, kfsher_deleted: kfsherDeleted, storage_deleted: storageDeleted, log_deleted: logDelResp.ok, custom_specialty_removed: customSpecialtyRemoved, was_last_upload: isLastUpload });
}

// ── Helper: upsert custom specialty ──
async function upsertCustomSpecialty(key, displayName) {
  const { url, headers } = getSupabase();
  const r = await fetch(`${url}/rest/v1/custom_specialties?key=eq.${key}&select=id`, { headers });
  const existing = await r.json();
  if (Array.isArray(existing) && existing.length > 0) return;
  await fetch(`${url}/rest/v1/custom_specialties`, { method: 'POST', headers: { ...headers, 'Prefer': 'return=minimal' }, body: JSON.stringify({ key, display_name: displayName }) }).catch(() => {});
}
