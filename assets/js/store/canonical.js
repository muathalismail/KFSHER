// ═══════════════════════════════════════════════════════════════
// store/canonical.js — Canonical data source resolution
// ═══════════════════════════════════════════════════════════════
// Unified API for resolving the active data source for a specialty.
// Priority: uploaded (if published) → builtin (ROTAS) → null
// Depends on: store/memory-cache.js (uploadedPdfRecords)
//             store/indexeddb.js (getPdfRecord)
//             data/rotas.js (ROTAS)
// ═══════════════════════════════════════════════════════════════

/**
 * Source priority rules — strict, no silent cross-specialty fallback.
 *
 * getCanonicalSource(deptKey):
 *   1. uploaded[deptKey] → if exists AND published AND active
 *   2. builtin[deptKey]  → ROTAS[deptKey].schedule
 *   3. null              → "No schedule available"
 *
 * Medicine subspecialties (endocrinology, dermatology, etc.) may
 * fall back to 'medicine' umbrella PDF — this is the ONLY allowed
 * cross-specialty fallback, and it's explicit.
 */

const ALLOWED_FALLBACK_SOURCES = {
  endocrinology: 'medicine',
  dermatology: 'medicine',
  rheumatology: 'medicine',
  gastroenterology: 'medicine',
  pulmonary: 'medicine',
  infectious: 'medicine',
};

/**
 * Get the canonical uploaded record for a department.
 * Returns { record, source: 'uploaded' } or null.
 */
function getCanonicalUploadedRecord(deptKey) {
  const now = new Date();
  // Direct match
  const direct = uploadedPdfRecords.get(deptKey) || null;
  if (direct && isPublishableUploadRecord(direct) && direct.parsedActive && direct.isActive !== false && isRecordCurrentMonth(direct, now)) {
    return { record: direct, source: 'uploaded', via: deptKey };
  }
  // Allowed fallback (medicine subspecialties only)
  const fallbackKey = ALLOWED_FALLBACK_SOURCES[deptKey];
  if (fallbackKey) {
    const fallback = uploadedPdfRecords.get(fallbackKey) || null;
    if (fallback && isPublishableUploadRecord(fallback) && fallback.parsedActive && fallback.isActive !== false && isRecordCurrentMonth(fallback, now)) {
      return { record: fallback, source: 'uploaded-fallback', via: fallbackKey };
    }
  }
  return null;
}

/**
 * Get the canonical schedule entries for a department and date.
 * Returns { entries, source } where source is 'uploaded' | 'builtin' | null.
 */
function getCanonicalSchedule(deptKey, dateKey) {
  // 1. Uploaded data (highest priority)
  const uploaded = getCanonicalUploadedRecord(deptKey);
  if (uploaded) {
    const record = uploaded.record;
    const entries = Array.isArray(record.entries) ? record.entries : [];
    const dated = entries.filter(e => !e.date || e.date === dateKey || e.date === 'dynamic-weekday');
    return {
      entries: dated.length ? dated : entries.filter(e => !e.date),
      source: uploaded.source,
      via: uploaded.via,
      record,
    };
  }
  // 2. Built-in data
  const dept = ROTAS[deptKey];
  if (dept && dept.schedule && dept.schedule[dateKey]) {
    return {
      entries: dept.schedule[dateKey],
      source: 'builtin',
      via: deptKey,
      record: null,
    };
  }
  // 3. No data
  return { entries: [], source: null, via: null, record: null };
}

/**
 * Get the data source label for debugging/display.
 */
function getCanonicalSourceLabel(deptKey) {
  const uploaded = getCanonicalUploadedRecord(deptKey);
  if (uploaded) {
    return uploaded.source === 'uploaded-fallback'
      ? `Uploaded (via ${uploaded.via})`
      : 'Uploaded PDF';
  }
  const dept = ROTAS[deptKey];
  if (dept && dept.schedule) return 'Built-in Schedule';
  return 'No Data';
}
