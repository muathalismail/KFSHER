module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.json({
    supabaseUrl: process.env.SUPABASE_URL || '',
    supabaseKey: process.env.SUPABASE_PUBLISHABLE_KEY || '',
  });
};
