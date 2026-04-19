// Vercel serverless function: secure write to Supabase
// Client sends extracted rota data → this function writes using SERVICE_KEY
// Client never sees the service key.

const { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !serviceKey) {
    return res.status(500).json({ error: 'Supabase not configured' });
  }

  const supabase = createClient(url, serviceKey);

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
        console.error('Storage upload error:', uploadErr);
      } else {
        const { data: urlData } = supabase.storage
          .from('rota-pdfs')
          .getPublicUrl(path);
        pdf_url = urlData?.publicUrl || null;
      }
    }

    // Upsert rota record
    const { data: result, error } = await supabase
      .from('rota_records')
      .upsert({
        specialty,
        date: date || new Date().toISOString().slice(0, 10),
        data,
        source: source || 'upload',
        pdf_url,
      }, {
        onConflict: 'specialty,date',
      });

    if (error) {
      console.error('DB upsert error:', error);
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({ ok: true, pdf_url });
  } catch (err) {
    console.error('Upload handler error:', err);
    return res.status(500).json({ error: err.message });
  }
};
