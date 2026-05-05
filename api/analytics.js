// Merged: click-stats.js (GET) + track-clicks.js (POST)
module.exports = async function handler(req, res) {
  // GET: return aggregated click stats
  if (req.method === 'GET') {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) return res.status(200).json([]);

    try {
      const range = req.query.range || '7d';
      let since;
      const now = new Date();
      switch (range) {
        case 'today': since = new Date(now.getFullYear(), now.getMonth(), now.getDate()); break;
        case '24h': since = new Date(now.getTime() - 24 * 60 * 60 * 1000); break;
        case '7d': since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); break;
        case '30d': since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); break;
        case 'all': since = new Date('2020-01-01'); break;
        default: since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      }

      const endpoint = `${url}/rest/v1/specialty_clicks?select=specialty&clicked_at=gte.${since.toISOString()}&order=clicked_at.desc&limit=10000`;
      const resp = await fetch(endpoint, {
        headers: { 'apikey': key, 'Authorization': `Bearer ${key}` },
      });

      if (!resp.ok) return res.status(200).json([]);

      const rows = await resp.json();
      const counts = {};
      for (const r of rows) counts[r.specialty] = (counts[r.specialty] || 0) + 1;

      const sorted = Object.entries(counts)
        .map(([specialty, count]) => ({ specialty, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

      res.setHeader('Cache-Control', 'public, max-age=60');
      return res.status(200).json(sorted);
    } catch {
      return res.status(200).json([]);
    }
  }

  // POST: insert click events
  if (req.method === 'POST') {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY;
    if (!url || !key) return res.status(200).json({ ok: true });

    try {
      const { clicks } = req.body;
      if (!Array.isArray(clicks) || !clicks.length) {
        return res.status(200).json({ ok: true });
      }

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
      return res.status(200).json({ ok: true });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
