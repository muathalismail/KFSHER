const { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;

  console.log('[upload] ENV check: SUPABASE_URL=' + (url ? 'SET' : 'MISSING') +
    ', SUPABASE_SERVICE_KEY=' + (serviceKey ? 'SET (' + serviceKey.length + ' chars)' : 'MISSING'));

  if (!url || !serviceKey) {
    return res.status(500).json({ error: 'Supabase not configured' });
  }

  const supabase = createClient(url, serviceKey, {
    db: { schema: 'public' },
  });

  try {
    const { specialty, date, data, source, pdf_base64, pdf_name } = req.body;

    if (!specialty || !data) {
      return res.status(400).json({ error: 'Missing specialty or data' });
    }

    // Upload PDF to storage if provided
    let pdf_url = null;
    if (pdf_base64 && pdf_name) {
      const buffer = Buffer.from(pdf_base64, 'base64');
      const path = `${specialty}/${Date.now()}_${pdf_name}`;
      const { error: uploadErr } = await supabase.storage
        .from('rota-pdfs')
        .upload(path, buffer, {
          contentType: 'application/pdf',
          upsert: true,
        });
      if (uploadErr) {
        console.error('[upload] Storage error:', uploadErr);
      } else {
        const { data: urlData } = supabase.storage
          .from('rota-pdfs')
          .getPublicUrl(path);
        pdf_url = urlData?.publicUrl || null;
      }
    }

    // Insert rota record (use insert instead of upsert to avoid unique constraint issues)
    const { data: result, error } = await supabase
      .from('rota_records')
      .insert({
        specialty,
        date: date || new Date().toISOString().slice(0, 10),
        data,
        source: source || 'upload',
        pdf_url,
      });

    if (error) {
      console.error('[upload] DB insert error:', error);
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({ ok: true, pdf_url });
  } catch (err) {
    console.error('[upload] Handler error:', err);
    return res.status(500).json({ error: err.message });
  }
};
