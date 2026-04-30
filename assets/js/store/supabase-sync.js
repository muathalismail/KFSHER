// ═══════════════════════════════════════════════════════════════
// store/supabase-sync.js — Sync layer between IndexedDB and Supabase
// ═══════════════════════════════════════════════════════════════
// Write path: save to IndexedDB → POST to /api/upload (async)
// Read path:  on startup, fetch from Supabase directly → merge into IndexedDB
// Fallback:   if Supabase unavailable, IndexedDB + ROTAS work standalone
// ═══════════════════════════════════════════════════════════════

let _supabaseSyncEnabled = true;
let _supabaseConfig = null;

/**
 * Fetch Supabase config from server (URL + publishable key).
 * Cached after first call.
 */
async function _getSupabaseConfig() {
  if (_supabaseConfig) return _supabaseConfig;
  try {
    const resp = await fetch('/api/config');
    if (!resp.ok) return null;
    const cfg = await resp.json();
    if (cfg.supabaseUrl && cfg.supabaseKey) {
      _supabaseConfig = cfg;
      return cfg;
    }
  } catch (err) {
    console.warn('[SUPABASE] Config fetch failed:', err.message);
  }
  return null;
}

/**
 * Upload a record to Supabase via the serverless API.
 */
async function syncRecordToSupabase(record, pdfFile) {
  if (!_supabaseSyncEnabled) return null;
  try {
    const body = {
      specialty: record.deptKey || record.specialty || '',
      date: record.dateRange || new Date().toISOString().slice(0, 10),
      data: {
        deptKey: record.deptKey,
        entries: record.entries || [],
        normalized: record.normalized || null,
        parsedActive: record.parsedActive,
        name: record.name || '',
        uploadedAt: record.uploadedAt || Date.now(),
      },
    };

    if (pdfFile && pdfFile.size < 5 * 1024 * 1024) {
      const buffer = await pdfFile.arrayBuffer();
      body.pdf_base64 = btoa(
        new Uint8Array(buffer).reduce((s, b) => s + String.fromCharCode(b), '')
      );
      body.pdf_name = pdfFile.name || 'rota.pdf';
    }

    const resp = await fetch('/api/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      console.warn('[SUPABASE SYNC] Upload failed:', err.error || resp.status);
      return null;
    }

    const result = await resp.json();
    console.log('[SUPABASE SYNC] Record synced:', body.specialty);
    return result;
  } catch (err) {
    console.warn('[SUPABASE SYNC] Upload error:', err.message);
    return null;
  }
}

/**
 * Pull records from Supabase and merge into IndexedDB.
 * Uses publishable key directly from /api/config (safe for reads).
 */
async function pullFromSupabase() {
  if (!_supabaseSyncEnabled) return;

  const cfg = await _getSupabaseConfig();
  if (!cfg) {
    console.warn('[SUPABASE SYNC] No config — skipping pull');
    return;
  }

  try {
    // Query Supabase REST API directly from client (publishable key is read-only with RLS)
    const resp = await fetch(
      `${cfg.supabaseUrl}/rest/v1/kfsher?select=*&order=created_at.desc`,
      {
        headers: {
          'apikey': cfg.supabaseKey,
          'Authorization': `Bearer ${cfg.supabaseKey}`,
        },
      }
    );

    if (!resp.ok) {
      console.warn('[SUPABASE SYNC] Pull failed:', resp.status, await resp.text());
      return;
    }

    const records = await resp.json();
    if (!Array.isArray(records) || !records.length) {
      console.log('[SUPABASE SYNC] No cloud records found');
      return;
    }

    console.log(`[SUPABASE SYNC] Found ${records.length} cloud record(s)`);

    // Find the record with the HIGHEST uploadedAt per specialty
    // (not created_at — sync-backs create newer rows for older data)
    const bestPerSpecialty = {};
    for (const cloudRecord of records) {
      const deptKey = cloudRecord.specialty;
      if (!deptKey || !cloudRecord.data) continue;
      const uploadedAt = cloudRecord.data?.uploadedAt || new Date(cloudRecord.created_at).getTime() || 0;
      if (!bestPerSpecialty[deptKey] || uploadedAt > bestPerSpecialty[deptKey].uploadedAt) {
        bestPerSpecialty[deptKey] = { cloudRecord, uploadedAt };
      }
    }

    let merged = 0;
    for (const [deptKey, { cloudRecord, uploadedAt: cloudTime }] of Object.entries(bestPerSpecialty)) {
      const local = await getPdfRecord(deptKey).catch(() => null);
      const localTime = local?.uploadedAt || 0;

      if (cloudTime > localTime) {
        const record = {
          ...cloudRecord.data,
          deptKey,
          _cloudSync: true,
          _cloudPdfUrl: cloudRecord.pdf_url || null,
        };
        // Sprint 2 (H4): validate before activating — don't blindly trust cloud parsedActive
        record.parsedActive = !!(cloudRecord.data.parsedActive !== false
          && typeof isPublishableUploadRecord === 'function'
          && isPublishableUploadRecord(record));
        await savePdfRecord(record).catch(err => {
          console.warn('[SUPABASE SYNC] Local save failed:', deptKey, err);
        });
        if (typeof cacheUploadedRecord === 'function') {
          cacheUploadedRecord(record);
        }
        merged++;
      }
    }

    if (merged > 0) {
      console.log(`[SUPABASE SYNC] Pulled ${merged} record(s) from cloud`);
    }
  } catch (err) {
    console.warn('[SUPABASE SYNC] Pull error:', err.message);
  }
}

/**
 * Migrate all IndexedDB records to Supabase.
 */
async function migrateAllToSupabase(statusEl) {
  const records = await getAllPdfRecords().catch(() => []);
  if (!records.length) {
    if (statusEl) statusEl.textContent = 'No records to migrate.';
    return;
  }

  let done = 0;
  for (const record of records) {
    if (statusEl) statusEl.textContent = `Migrating ${done + 1} of ${records.length}...`;
    await syncRecordToSupabase(record, null);
    done++;
  }

  if (statusEl) statusEl.textContent = `Complete: ${done} record(s) migrated to Supabase.`;
  console.log(`[SUPABASE SYNC] Migration complete: ${done} records`);
}
