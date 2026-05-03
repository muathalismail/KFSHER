// ═══════════════════════════════════════════════════════════════
// admin/auth.js — Single-user authentication (SHA-256 + sessionStorage)
// ═══════════════════════════════════════════════════════════════

const AUTH = {
  username: 'Muath',
  hash: '40510175845988f13f6162ed8526f0b09f73384467fa855e1e79b44a56562a58',
  sessionKey: 'kfshd_admin_session',
  ttl: 4 * 60 * 60 * 1000, // 4 hours
};

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function authenticate(username, password) {
  if (username !== AUTH.username) return false;
  const hashed = await sha256(password);
  return hashed === AUTH.hash;
}

function saveSession() {
  sessionStorage.setItem(AUTH.sessionKey, JSON.stringify({
    user: AUTH.username,
    expires: Date.now() + AUTH.ttl,
  }));
}

function getSession() {
  try {
    const raw = sessionStorage.getItem(AUTH.sessionKey);
    if (!raw) return null;
    const session = JSON.parse(raw);
    if (session.expires < Date.now()) {
      sessionStorage.removeItem(AUTH.sessionKey);
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

function clearSession() {
  sessionStorage.removeItem(AUTH.sessionKey);
}

function isAuthenticated() {
  return !!getSession();
}
