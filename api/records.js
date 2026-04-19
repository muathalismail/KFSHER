const { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;

  console.log('[records] ENV check: SUPABASE_URL=' + (url ? 'SET' : 'MISSING') +
    ', SUPABASE_PUBLISHABLE_KEY=' + (key ? 'SET' : 'MISSING'));

  if (!url || !key) {
    return res.status(500).json({ error: 'Supabase not configured' });
  }

  const supabase = createClient(url, key, {
    db: { schema: 'public' },
  });

  try {
    const specialty = req.query.specialty || null;
    let query = supabase.from('rota_records').select('*');
    if (specialty) {
      query = query.eq('specialty', specialty);
    }
    query = query.order('created_at', { ascending: false });

    const { data, error } = await query;
    if (error) {
      console.error('[records] DB error:', error);
      return res.status(500).json({ error: error.message });
    }

    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.status(200).json(data || []);
  } catch (err) {
    console.error('[records] Handler error:', err);
    return res.status(500).json({ error: err.message });
  }
};
