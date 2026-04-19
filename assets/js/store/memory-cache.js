// ═══════════════════════════════════════════════════════════════
// store/memory-cache.js — In-memory cache for uploaded PDF records
// ═══════════════════════════════════════════════════════════════
// Runtime cache for O(1) lookups during search/display.
// Loaded from IndexedDB on startup, updated on upload.
// ═══════════════════════════════════════════════════════════════

// The canonical in-memory store for uploaded PDF records.
// Key: deptKey (string), Value: normalized record object.
// This is the FIRST place checked during search — if a record
// is here and publishable, it takes priority over built-in data.
const uploadedPdfRecords = new Map();
