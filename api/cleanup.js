// One-time cleanup: keep only the LATEST record per specialty, delete the rest.

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    return res.status(500).json({ error: 'Supabase not configured' });
  }

  try {
    // 1. Get all records
    const allResp = await fetch(
      `${url}/rest/v1/kfsher?select=id,specialty,created_at&order=created_at.desc`,
      { headers: { 'apikey': key, 'Authorization': `Bearer ${key}` } }
    );
    if (!allResp.ok) return res.status(500).json({ error: await allResp.text() });
    const all = await allResp.json();

    // 2. Find newest per specialty, mark the rest for deletion
    const newest = {};
    const toDelete = [];
    for (const record of all) {
      if (!newest[record.specialty]) {
        newest[record.specialty] = record;
      } else {
        toDelete.push(record);
      }
    }

    // 3. Delete old records
    let deleted = 0;
    for (const record of toDelete) {
      const delResp = await fetch(
        `${url}/rest/v1/kfsher?id=eq.${record.id}`,
        {
          method: 'DELETE',
          headers: {
            'apikey': key,
            'Authorization': `Bearer ${key}`,
          },
        }
      );
      if (delResp.ok) deleted++;
    }

    const kept = Object.entries(newest).map(([spec, r]) => ({
      specialty: spec,
      id: r.id,
      created_at: r.created_at,
    }));

    return res.status(200).json({
      total_before: all.length,
      deleted,
      kept: kept.length,
      records_kept: kept,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
