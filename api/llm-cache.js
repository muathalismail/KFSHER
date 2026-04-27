const { CACHE_CONFIG } = require('./cache-config');

// Validation: SHA-256 hash must be exactly 64 hex characters
function isValidHash(hash) {
  return typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash);
}

function isValidSpecialty(specialty) {
  return typeof specialty === 'string' && CACHE_CONFIG.VALID_SPECIALTIES.includes(specialty);
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  const anonKey = process.env.SUPABASE_PUBLISHABLE_KEY;

  if (!url) {
    return res.status(500).json({ error: 'Supabase not configured' });
  }

  // ── GET: lookup cached result ──
  if (req.method === 'GET') {
    const { hash, specialty } = req.query;

    if (!isValidHash(hash)) {
      return res.status(400).json({ error: 'Invalid hash (expected 64 hex chars)' });
    }
    if (!isValidSpecialty(specialty)) {
      return res.status(400).json({ error: 'Invalid specialty' });
    }

    try {
      const version = CACHE_CONFIG.VERSION;
      const endpoint = `${url}/rest/v1/verification_cache?select=result,created_at`
        + `&file_hash=eq.${encodeURIComponent(hash)}`
        + `&specialty=eq.${encodeURIComponent(specialty)}`
        + `&cache_version=eq.${encodeURIComponent(version)}`
        + `&expires_at=gt.${new Date().toISOString()}`
        + `&limit=1`;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), CACHE_CONFIG.TIMEOUT_MS);

      const dbResp = await fetch(endpoint, {
        headers: {
          'apikey': anonKey || serviceKey,
          'Authorization': `Bearer ${anonKey || serviceKey}`,
        },
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!dbResp.ok) {
        console.warn('[llm-cache] GET error:', dbResp.status);
        return res.status(200).json({ cached: null });
      }

      const rows = await dbResp.json();
      if (rows && rows.length > 0) {
        console.log(`[llm-cache] HIT: ${specialty} ${hash.slice(0, 12)}...`);
        return res.status(200).json({ cached: rows[0].result, created_at: rows[0].created_at });
      }

      console.log(`[llm-cache] MISS: ${specialty} ${hash.slice(0, 12)}...`);
      return res.status(200).json({ cached: null });

    } catch (err) {
      console.warn('[llm-cache] GET failed:', err.message);
      return res.status(200).json({ cached: null }); // fail open
    }
  }

  // ── POST: save result to cache ──
  if (req.method === 'POST') {
    if (!serviceKey) {
      return res.status(500).json({ error: 'Service key not configured' });
    }

    const { hash, specialty, result } = req.body || {};

    if (!isValidHash(hash)) {
      return res.status(400).json({ error: 'Invalid hash (expected 64 hex chars)' });
    }
    if (!isValidSpecialty(specialty)) {
      return res.status(400).json({ error: 'Invalid specialty' });
    }
    if (!result || typeof result !== 'object') {
      return res.status(400).json({ error: 'Invalid result (expected JSON object/array)' });
    }

    try {
      const version = CACHE_CONFIG.VERSION;
      const expires = new Date(Date.now() + CACHE_CONFIG.TTL_DAYS * 86400000).toISOString();

      const dbResp = await fetch(`${url}/rest/v1/verification_cache`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': serviceKey,
          'Authorization': `Bearer ${serviceKey}`,
          'Prefer': 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify({
          file_hash: hash,
          specialty,
          cache_version: version,
          result,
          created_at: new Date().toISOString(),
          expires_at: expires,
        }),
      });

      if (!dbResp.ok) {
        const errText = await dbResp.text();
        console.warn('[llm-cache] POST error:', dbResp.status, errText);
        return res.status(200).json({ saved: false }); // fail open
      }

      console.log(`[llm-cache] SAVED: ${specialty} ${hash.slice(0, 12)}...`);
      return res.status(200).json({ saved: true });

    } catch (err) {
      console.warn('[llm-cache] POST failed:', err.message);
      return res.status(200).json({ saved: false }); // fail open
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
