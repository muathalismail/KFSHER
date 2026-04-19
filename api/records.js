module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) {
    return res.status(500).json({ error: 'Supabase not configured' });
  }

  try {
    let endpoint = `${url}/rest/v1/rota_records?select=*&order=created_at.desc`;
    if (req.query.specialty) {
      endpoint += `&specialty=eq.${encodeURIComponent(req.query.specialty)}`;
    }

    const dbResp = await fetch(endpoint, {
      headers: {
        'apikey': key,
        'Authorization': `Bearer ${key}`,
      },
    });

    if (!dbResp.ok) {
      const errText = await dbResp.text();
      return res.status(500).json({ error: errText });
    }

    const data = await dbResp.json();
    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.status(200).json(data || []);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
