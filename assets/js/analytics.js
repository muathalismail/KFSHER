// ═══════════════════════════════════════════════════════════════
// analytics.js — Privacy-safe click tracking (fire-and-forget)
// Only stores: specialty + timestamp. No PII.
// ═══════════════════════════════════════════════════════════════

(function () {
  const QUEUE_KEY = 'kfshd_click_queue';
  const FLUSH_SIZE = 3;
  const FLUSH_INTERVAL = 5 * 60 * 1000; // 5 minutes
  const MAX_RETRIES = 3;

  // Skip tracking on admin pages or if admin is authenticated
  function shouldSkip() {
    if (window.location.pathname.includes('admin')) return true;
    try { if (sessionStorage.getItem('kfshd_admin_session')) return true; } catch {}
    return false;
  }

  function getQueue() {
    try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); } catch { return []; }
  }

  function saveQueue(queue) {
    try { localStorage.setItem(QUEUE_KEY, JSON.stringify(queue)); } catch {}
  }

  async function flush(retries) {
    const queue = getQueue();
    if (!queue.length) return;

    const batch = queue.splice(0, 1000);
    saveQueue(queue);

    try {
      const resp = await fetch('/api/analytics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clicks: batch }),
      });
      if (!resp.ok && (retries || 0) < MAX_RETRIES) {
        // Put back and retry
        saveQueue([...batch, ...getQueue()]);
        setTimeout(() => flush((retries || 0) + 1), 3000);
      }
    } catch {
      if ((retries || 0) < MAX_RETRIES) {
        saveQueue([...batch, ...getQueue()]);
        setTimeout(() => flush((retries || 0) + 1), 5000);
      }
    }
  }

  function trackClick(specialty) {
    if (shouldSkip() || !specialty) return;
    const queue = getQueue();
    queue.push({ specialty, timestamp: Date.now() });
    saveQueue(queue);
    if (queue.length >= FLUSH_SIZE) flush();
  }

  // Periodic flush
  setInterval(() => { if (!shouldSkip()) flush(); }, FLUSH_INTERVAL);

  // Flush on page unload
  window.addEventListener('beforeunload', () => {
    if (shouldSkip()) return;
    const queue = getQueue();
    if (!queue.length) return;
    const batch = queue.splice(0, 1000);
    saveQueue(queue);
    try {
      navigator.sendBeacon('/api/analytics', new Blob([JSON.stringify({ clicks: batch })], { type: 'application/json' }));
    } catch {}
  });

  // Expose globally
  window.trackClick = trackClick;
})();
