// Merged: config.js (GET ?action=config) + records.js (GET default) + admin-save.js (POST)
module.exports = async function handler(req, res) {

  // ── GET routes ──
  if (req.method === 'GET') {
    const action = req.query.action;

    // GET ?action=config → return Supabase config
    if (action === 'config') {
      res.setHeader('Cache-Control', 'public, max-age=3600');
      return res.json({
        supabaseUrl: process.env.SUPABASE_URL || '',
        supabaseKey: process.env.SUPABASE_PUBLISHABLE_KEY || '',
      });
    }

    // GET (default) → return kfsher records
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) return res.status(500).json({ error: 'Supabase not configured' });

    try {
      let endpoint = `${url}/rest/v1/kfsher?select=*&order=created_at.desc`;
      if (req.query.specialty) {
        endpoint += `&specialty=eq.${encodeURIComponent(req.query.specialty)}`;
      }

      const dbResp = await fetch(endpoint, {
        headers: { 'apikey': key, 'Authorization': `Bearer ${key}` },
      });

      if (!dbResp.ok) return res.status(500).json({ error: await dbResp.text() });

      const data = await dbResp.json();
      res.setHeader('Cache-Control', 'public, max-age=30, s-maxage=30');
      return res.status(200).json(data || []);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── POST routes ──
  if (req.method === 'POST') {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY;
    if (!url || !key) return res.status(500).json({ error: 'Supabase not configured' });

    const headers = {
      'Content-Type': 'application/json',
      'apikey': key,
      'Authorization': `Bearer ${key}`,
    };

    try {
      const { action } = req.body;

      // Save edited entries
      if (action === 'save_entries') {
        const { recordId, specialty, data, auditEntries } = req.body;
        if (!recordId || !specialty || !data) {
          return res.status(400).json({ error: 'Missing recordId, specialty, or data' });
        }

        const patchResp = await fetch(
          `${url}/rest/v1/kfsher?id=eq.${recordId}`,
          {
            method: 'PATCH',
            headers: { ...headers, 'Prefer': 'return=minimal' },
            body: JSON.stringify({ data }),
          }
        );

        if (!patchResp.ok) {
          return res.status(500).json({ error: `DB update failed: ${await patchResp.text()}` });
        }

        if (auditEntries && auditEntries.length) {
          await fetch(`${url}/rest/v1/audit_log`, {
            method: 'POST',
            headers: { ...headers, 'Prefer': 'return=minimal' },
            body: JSON.stringify(auditEntries),
          }).catch(err => console.error('[admin] Audit log insert error:', err.message));
        }

        return res.status(200).json({ ok: true });
      }

      // Fetch audit log
      if (action === 'fetch_audit') {
        const { specialty, limit, offset } = req.body;
        let endpoint = `${url}/rest/v1/audit_log?select=*&order=created_at.desc`;
        if (specialty) endpoint += `&specialty=eq.${encodeURIComponent(specialty)}`;
        endpoint += `&limit=${limit || 100}&offset=${offset || 0}`;

        const resp = await fetch(endpoint, { headers });
        if (!resp.ok) return res.status(500).json({ error: await resp.text() });
        return res.status(200).json(await resp.json());
      }

      return res.status(400).json({ error: `Unknown action: ${action}` });
    } catch (err) {
      console.error('[admin] Error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
