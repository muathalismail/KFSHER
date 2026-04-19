// ═══════════════════════════════════════════════════════════════
// store/indexeddb.js — IndexedDB persistence for PDF records
// ═══════════════════════════════════════════════════════════════
// Low-level storage: open, save, get, getAll.
// No app-level dependencies.
// ═══════════════════════════════════════════════════════════════

const DB_NAME = 'oncallLookupDB';
const DB_STORE = 'pdfs';
let pdfDbPromise = null;

function openPdfDb() {
  if (pdfDbPromise) return pdfDbPromise;
  pdfDbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE, { keyPath: 'deptKey' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return pdfDbPromise;
}

async function savePdfRecord(record) {
  const db = await openPdfDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getAllPdfRecords() {
  const db = await openPdfDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readonly');
    const req = tx.objectStore(DB_STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function getPdfRecord(deptKey) {
  const db = await openPdfDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readonly');
    const req = tx.objectStore(DB_STORE).get(deptKey);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}
