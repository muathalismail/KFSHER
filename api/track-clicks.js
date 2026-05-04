module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return res.status(200).json({ ok: true }); // silent fail

  try {
    const { clicks } = req.body;
    if (!Array.isArray(clicks) || !clicks.length) {
      return res.status(200).json({ ok: true });
    }

    // Rate limit: max 1000 per request
    const batch = clicks.slice(0, 1000).map(c => ({
      specialty: String(c.specialty || '').slice(0, 100),
      clicked_at: c.timestamp ? new Date(c.timestamp).toISOString() : new Date().toISOString(),
    }));

    await fetch(`${url}/rest/v1/specialty_clicks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': key,
        'Authorization': `Bearer ${key}`,
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify(batch),
    });

    return res.status(200).json({ ok: true });
  } catch {
    return res.status(200).json({ ok: true }); // silent fail
  }
};
