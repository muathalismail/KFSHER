module.exports = async function handler(req, res) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return res.status(500).json({ error: 'Supabase not configured' });

  const headers = {
    'Content-Type': 'application/json',
    'apikey': key,
    'Authorization': `Bearer ${key}`,
  };

  // GET: list all manual phones
  if (req.method === 'GET') {
    try {
      const resp = await fetch(
        `${url}/rest/v1/manual_phones?select=*&order=updated_at.desc&limit=500`,
        { headers }
      );
      if (!resp.ok) return res.status(500).json({ error: await resp.text() });
      res.setHeader('Cache-Control', 'public, max-age=30');
      return res.status(200).json(await resp.json());
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === 'POST') {
    const { action } = req.body;

    // Upsert a manual phone
    if (action === 'upsert') {
      const { full_name, phone, specialty_hint, notes } = req.body;
      if (!full_name || !phone) return res.status(400).json({ error: 'Missing name or phone' });

      try {
        const resp = await fetch(
          `${url}/rest/v1/manual_phones`,
          {
            method: 'POST',
            headers: { ...headers, 'Prefer': 'resolution=merge-duplicates,return=representation' },
            body: JSON.stringify({
              full_name: full_name.trim(),
              phone: phone.trim(),
              specialty_hint: specialty_hint || null,
              notes: notes || null,
            }),
          }
        );
        if (!resp.ok) return res.status(500).json({ error: await resp.text() });
        return res.status(200).json(await resp.json());
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }

    // Bulk lookup: given names, return matching phones
    if (action === 'lookup') {
      const { names } = req.body;
      if (!Array.isArray(names) || !names.length) return res.status(200).json({});

      try {
        const resp = await fetch(
          `${url}/rest/v1/manual_phones?select=full_name,phone&limit=500`,
          { headers }
        );
        if (!resp.ok) return res.status(200).json({});
        const rows = await resp.json();

        // Build lookup map with canonical matching
        const normalize = s => s.toLowerCase().replace(/^dr\.?\s*/i, '').replace(/[^a-z0-9\u0600-\u06FF]+/g, ' ').trim();
        const dbMap = {};
        for (const r of rows) {
          dbMap[normalize(r.full_name)] = r.phone;
          dbMap[r.full_name.toLowerCase().trim()] = r.phone;
        }

        const result = {};
        for (const name of names) {
          const found = dbMap[normalize(name)] || dbMap[name.toLowerCase().trim()];
          if (found) result[name] = found;
        }
        return res.status(200).json(result);
      } catch {
        return res.status(200).json({});
      }
    }

    // Delete
    if (action === 'delete') {
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: 'Missing id' });
      try {
        await fetch(`${url}/rest/v1/manual_phones?id=eq.${id}`, {
          method: 'DELETE',
          headers,
        });
        return res.status(200).json({ ok: true });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }

    return res.status(400).json({ error: 'Unknown action' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
