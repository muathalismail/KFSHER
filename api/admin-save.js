module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;

  if (!url || !key) {
    return res.status(500).json({ error: 'Supabase not configured' });
  }

  const headers = {
    'Content-Type': 'application/json',
    'apikey': key,
    'Authorization': `Bearer ${key}`,
  };

  try {
    const { action } = req.body;

    // ── Save edited entries ──
    if (action === 'save_entries') {
      const { recordId, specialty, data, auditEntries } = req.body;
      if (!recordId || !specialty || !data) {
        return res.status(400).json({ error: 'Missing recordId, specialty, or data' });
      }

      // Check for conflict: get current record's uploadedAt
      if (req.body.expectedUploadedAt) {
        const checkResp = await fetch(
          `${url}/rest/v1/kfsher?id=eq.${recordId}&select=data`,
          { headers }
        );
        if (checkResp.ok) {
          const rows = await checkResp.json();
          if (rows.length && rows[0].data?.uploadedAt > req.body.expectedUploadedAt) {
            return res.status(409).json({
              error: 'conflict',
              message: 'Record was modified by another session',
              serverUploadedAt: rows[0].data.uploadedAt,
            });
          }
        }
      }

      // Update kfsher record
      const patchResp = await fetch(
        `${url}/rest/v1/kfsher?id=eq.${recordId}`,
        {
          method: 'PATCH',
          headers: { ...headers, 'Prefer': 'return=minimal' },
          body: JSON.stringify({ data }),
        }
      );

      if (!patchResp.ok) {
        const errText = await patchResp.text();
        return res.status(500).json({ error: `DB update failed: ${errText}` });
      }

      // Insert audit log entries
      if (auditEntries && auditEntries.length) {
        await fetch(
          `${url}/rest/v1/audit_log`,
          {
            method: 'POST',
            headers: { ...headers, 'Prefer': 'return=minimal' },
            body: JSON.stringify(auditEntries),
          }
        ).catch(err => console.error('[admin-save] Audit log insert error:', err.message));
      }

      return res.status(200).json({ ok: true });
    }

    // ── Fetch audit log ──
    if (action === 'fetch_audit') {
      const { specialty, limit, offset } = req.body;
      let endpoint = `${url}/rest/v1/audit_log?select=*&order=created_at.desc`;
      if (specialty) endpoint += `&specialty=eq.${encodeURIComponent(specialty)}`;
      endpoint += `&limit=${limit || 100}&offset=${offset || 0}`;

      const resp = await fetch(endpoint, { headers });
      if (!resp.ok) {
        return res.status(500).json({ error: await resp.text() });
      }
      return res.status(200).json(await resp.json());
    }

    return res.status(400).json({ error: `Unknown action: ${action}` });
  } catch (err) {
    console.error('[admin-save] Error:', err);
    return res.status(500).json({ error: err.message });
  }
};
