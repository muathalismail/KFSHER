// Vercel serverless function: read rota records from Supabase
// Uses publishable key (safe for reads with RLS enabled)

const { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    return res.status(500).json({ error: 'Supabase not configured' });
  }

  const supabase = createClient(url, key);

  try {
    const specialty = req.query.specialty || null;
    let query = supabase.from('rota_records').select('*');
    if (specialty) {
      query = query.eq('specialty', specialty);
    }
    query = query.order('created_at', { ascending: false });

    const { data, error } = await query;
    if (error) {
      return res.status(500).json({ error: error.message });
    }

    // Cache for 5 minutes
    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.status(200).json(data || []);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
