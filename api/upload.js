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
    const { specialty, date, data, pdf_base64, pdf_name } = req.body;

    if (!specialty || !data) {
      return res.status(400).json({ error: 'Missing specialty or data' });
    }

    // Upload PDF to storage if provided
    let pdf_url = null;
    if (pdf_base64 && pdf_name) {
      const buffer = Buffer.from(pdf_base64, 'base64');
      const safeName = pdf_name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const path = `${specialty}/${Date.now()}_${safeName}`;

      const storageResp = await fetch(
        `${url}/storage/v1/object/rota-pdfs/${path}`,
        {
          method: 'POST',
          headers: {
            'apikey': key,
            'Authorization': `Bearer ${key}`,
            'Content-Type': 'application/pdf',
            'x-upsert': 'true',
          },
          body: buffer,
        }
      );

      if (storageResp.ok) {
        pdf_url = `${url}/storage/v1/object/public/rota-pdfs/${path}`;
        console.log('[upload] PDF stored:', pdf_url);
      } else {
        const errText = await storageResp.text();
        console.error('[upload] Storage error:', storageResp.status, errText);
      }
    }

    // Insert rota record
    const dbResp = await fetch(
      `${url}/rest/v1/kfsher`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': key,
          'Authorization': `Bearer ${key}`,
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify({
          specialty,
          date: date || new Date().toISOString().slice(0, 10),
          data,
          pdf_url,
        }),
      }
    );

    if (!dbResp.ok) {
      const errText = await dbResp.text();
      console.error('[upload] DB error:', dbResp.status, errText);
      return res.status(500).json({ error: errText });
    }

    return res.status(200).json({ ok: true, pdf_url });
  } catch (err) {
    console.error('[upload] Handler error:', err);
    return res.status(500).json({ error: err.message });
  }
};
