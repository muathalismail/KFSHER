// ═══════════════════════════════════════════════════════════════
// store/supabase-sync.js — Sync layer between IndexedDB and Supabase
// ═══════════════════════════════════════════════════════════════
// Adds cloud persistence on top of IndexedDB.
// IndexedDB remains the primary local cache.
// Supabase is the authoritative cloud store.
//
// Write path: save to IndexedDB → POST to /api/upload (async, non-blocking)
// Read path:  on startup, fetch /api/records → merge into IndexedDB
// Fallback:   if Supabase unavailable, IndexedDB works standalone
// ═══════════════════════════════════════════════════════════════

let _supabaseSyncEnabled = true;

/**
 * Upload a record to Supabase via the serverless API.
 * Non-blocking — failures are logged but don't break the app.
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

    // Include PDF as base64 if available and small enough (<5MB)
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
    console.log('[SUPABASE SYNC] Record synced:', body.specialty, result.pdf_url ? '(with PDF)' : '');
    return result;
  } catch (err) {
    console.warn('[SUPABASE SYNC] Upload error (offline?):', err.message);
    return null;
  }
}

/**
 * Fetch all records from Supabase and merge into IndexedDB.
 * Called once on startup. Non-blocking.
 */
async function pullFromSupabase() {
  if (!_supabaseSyncEnabled) return;
  try {
    const resp = await fetch('/api/records');
    if (!resp.ok) {
      console.warn('[SUPABASE SYNC] Pull failed:', resp.status);
      return;
    }

    const records = await resp.json();
    if (!Array.isArray(records) || !records.length) {
      console.log('[SUPABASE SYNC] No cloud records found');
      return;
    }

    let merged = 0;
    for (const cloudRecord of records) {
      const deptKey = cloudRecord.specialty;
      if (!deptKey || !cloudRecord.data) continue;

      // Check if local already has a newer version
      const local = await getPdfRecord(deptKey).catch(() => null);
      const localTime = local?.uploadedAt || 0;
      const cloudTime = cloudRecord.data?.uploadedAt || new Date(cloudRecord.created_at).getTime() || 0;

      if (cloudTime > localTime) {
        // Cloud is newer — merge into IndexedDB
        const record = {
          ...cloudRecord.data,
          deptKey,
          _cloudSync: true,
          _cloudPdfUrl: cloudRecord.pdf_url || null,
        };
        await savePdfRecord(record).catch(err => {
          console.warn('[SUPABASE SYNC] Local save failed:', deptKey, err);
        });
        merged++;
      }
    }

    if (merged > 0) {
      console.log(`[SUPABASE SYNC] Pulled ${merged} record(s) from cloud`);
    }
  } catch (err) {
    console.warn('[SUPABASE SYNC] Pull error (offline?):', err.message);
  }
}

/**
 * Migrate all IndexedDB records to Supabase.
 * Called by the hidden migration button.
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
