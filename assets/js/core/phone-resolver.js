// ═══════════════════════════════════════════════════════════════
// core/phone-resolver.js — Name matching and phone resolution
// ═══════════════════════════════════════════════════════════════
// Canonical functions for fuzzy name matching, canonical name
// normalization, and phone number resolution from contacts.
// No external dependencies.
// ═══════════════════════════════════════════════════════════════

function initials(name) {
  return name.replace(/^Dr\.?\s*/i,'').split(' ').filter(Boolean).slice(0,2).map(w=>w[0]).join('').toUpperCase() || '?';
}

function levenshtein(a='', b='') {
  a = a.toLowerCase(); b = b.toLowerCase();
  const dp = Array.from({length: b.length + 1}, () => Array(a.length + 1).fill(0));
  for (let i = 0; i <= b.length; i++) dp[i][0] = i;
  for (let j = 0; j <= a.length; j++) dp[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      dp[i][j] = b[i-1] === a[j-1] ? dp[i-1][j-1] : Math.min(dp[i-1][j-1] + 1, dp[i][j-1] + 1, dp[i-1][j] + 1);
    }
  }
  return dp[b.length][a.length];
}

function canonicalName(s='') {
  return s.toLowerCase()
    .replace(/^dr\.?\s*/i,' ')
    .replace(/\([^)]*\)/g,' ')
    .replace(/\bdr\b/g,' ')
    .replace(/[^a-z0-9\u0600-\u06FF]+/g,' ')
    .replace(/\s+/g,' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map(token => {
      if (token === 'al') return '';
      if (/^al[a-z]{3,}$/.test(token)) return token.slice(2);
      return token;
    })
    .filter(Boolean)
    .join(' ');
}

function splitPossibleNames(name='') {
  const withoutRoleNotes = name.replace(/\([^)]*\)/g, ' ');
  const slashParts = withoutRoleNotes.split(/\s*\/\s*/).filter(Boolean);
  const parts = slashParts.length ? slashParts : [withoutRoleNotes];
  return parts.map(part => part.trim()).filter(Boolean);
}

function scoreNameMatch(target, candidate) {
  const targetNorm = canonicalName(target);
  const candNorm = canonicalName(candidate);
  if (!targetNorm || !candNorm) return null;
  if (targetNorm === candNorm) return { score: 100, uncertain: false };

  const targetTokens = targetNorm.split(' ').filter(Boolean);
  const candTokens = candNorm.split(' ').filter(Boolean);
  const overlap = targetTokens.filter(t => candTokens.includes(t)).length;
  const initialMatches = targetTokens.filter((token, i) => token.length === 1 && candTokens[i] && candTokens[i].startsWith(token)).length;
  const sharedPrefix = !!(targetTokens[0] && candTokens[0] === targetTokens[0]);
  const sharedLast = !!(targetTokens[targetTokens.length-1] && candTokens[candTokens.length-1] === targetTokens[targetTokens.length-1]);
  const dist = levenshtein(targetNorm, candNorm);
  const maxLen = Math.max(targetNorm.length, candNorm.length);
  const closeSpelling = maxLen >= 6 && dist <= Math.max(1, Math.floor(maxLen * 0.18));
  const tokenNearMiss = targetTokens.some(t => candTokens.some(c => Math.max(t.length, c.length) >= 5 && levenshtein(t, c) <= 1));
  const accepted = overlap >= 2 || initialMatches >= 1 || (overlap >= 1 && (sharedPrefix || sharedLast || tokenNearMiss)) || closeSpelling;
  if (!accepted) return null;

  const score = overlap * 16 + initialMatches * 10 + (sharedPrefix ? 5 : 0) + (sharedLast ? 8 : 0) + (tokenNearMiss ? 4 : 0) - dist;
  const uncertain = !(overlap >= 2 && dist <= 2) && !(sharedPrefix && sharedLast && dist <= 3) && initialMatches < 2;
  return { score, uncertain };
}

function resolvePhone(dept, entry) {
  if (entry.phone) return { phone: entry.phone, uncertain: !!entry.phoneUncertain };
  // Check server-extracted contacts first (pdfplumber, all specialties)
  const sc = (typeof window !== 'undefined' && window._serverExtractedContacts) || {};
  const nameNorm = canonicalName(entry.name || '');
  for (const [scName, scPhone] of Object.entries(sc)) {
    if (scPhone && canonicalName(scName) === nameNorm) return { phone: scPhone, uncertain: false };
  }
  // Server contacts: prefix match with uniqueness
  const scTokens = nameNorm.split(' ').filter(t => t.length >= 3);
  if (scTokens.length && Object.keys(sc).length) {
    const scPrefix = Object.entries(sc).filter(([cn, ph]) => {
      if (!ph) return false;
      const cnToks = canonicalName(cn).split(' ').filter(t => t.length >= 3);
      return scTokens.some(tt => cnToks.some(ct =>
        (ct.startsWith(tt) || tt.startsWith(ct)) && Math.abs(ct.length - tt.length) <= 2
      ));
    });
    if (scPrefix.length === 1) return { phone: scPrefix[0][1], uncertain: false };
  }
  const c = dept.contacts || {};
  if (c[entry.name]) return { phone: c[entry.name], uncertain: false };
  let best = null;
  for (const targetName of splitPossibleNames(entry.name)) {
    if (c[targetName]) return { phone: c[targetName], uncertain: false };

    // First-name unique match: if exactly ONE contact starts with this name → high confidence
    const targetFirst = canonicalName(targetName).split(' ')[0];
    if (targetFirst && targetFirst.length >= 3) {
      const firstNameMatches = Object.entries(c).filter(([cn, ph]) =>
        ph && canonicalName(cn).split(' ')[0] === targetFirst
      );
      if (firstNameMatches.length === 1) {
        return { phone: firstNameMatches[0][1], uncertain: false };
      }
    }

    // Prefix + fuzzy match: "Khalifa"→"Khalifah", "Bachar"→"Bashar"
    // A token matches if: prefix (≤2 char diff) OR levenshtein ≤2 for tokens ≥4 chars
    const targetTokens = canonicalName(targetName).split(' ').filter(t => t.length >= 3);
    if (targetTokens.length) {
      const fuzzyTokenMatch = (tt, ct) => {
        if ((ct.startsWith(tt) || tt.startsWith(ct)) && Math.abs(ct.length - tt.length) <= 2) return true;
        if (tt.length >= 4 && ct.length >= 4 && levenshtein(tt, ct) <= 2) return true;
        return false;
      };
      const prefixMatches = Object.entries(c).filter(([cn, ph]) => {
        if (!ph) return false;
        const cnTokens = canonicalName(cn).split(' ').filter(t => t.length >= 3);
        return targetTokens.some(tt => cnTokens.some(ct => fuzzyTokenMatch(tt, ct)));
      });
      if (prefixMatches.length === 1) {
        return { phone: prefixMatches[0][1], uncertain: false };
      }
    }

    for (const [contactName, phone] of Object.entries(c)) {
      if (!phone) continue;
      const match = scoreNameMatch(targetName, contactName);
      if (!match) continue;
      if (!best || match.score > best.score) best = { ...match, phone };
    }
  }
  if (!best) return null;
  return { phone: best.phone, uncertain: best.uncertain };
}

function parseRoleMeta(role='') {
  const r = role.toLowerCase();
  const time = role.match(/(\d{1,2})(?::(\d{2}))?\s*(?:–|-|to)\s*(\d{1,2})(?::(\d{2}))?/);
  let shiftType = 'on-call';
  if (r.includes('day') || r.includes('07:30') || r.includes('16:30')) shiftType = 'day';
  if (r.includes('night') || r.includes('after') || r.includes('evening')) shiftType = 'night';
  if (r.includes('24h')) shiftType = '24h';
  return {
    shiftType,
    startTime: time ? `${time[1].padStart(2,'0')}:${time[2] || '00'}` : '',
    endTime: time ? `${time[3].padStart(2,'0')}:${time[4] || '00'}` : '',
  };
}

function isNameUncertain(name='') {
  const parts = splitPossibleNames(name);
  return parts.length > 1 || parts.some(part => {
    const tokens = canonicalName(part).split(' ').filter(Boolean);
    return tokens.some((token, i) => {
      if (token.length !== 1) return false;
      // A single letter flanked by two longer words is a middle initial (e.g. "Khalid B. Akkari").
      // Middle initials are not ambiguous — don't flag them.
      const prevLong = i > 0 && tokens[i - 1].length >= 3;
      const nextLong = i < tokens.length - 1 && tokens[i + 1].length >= 3;
      if (prevLong && nextLong) return false;
      return true;
    });
  });
}

// ═══════════════════════════════════════════════════════════════
// Text normalization utilities (used by parsers and app logic)
// ═══════════════════════════════════════════════════════════════

function normalizeText(s='') {
  return s.toLowerCase().replace(/[^a-z0-9؀-ۿ]+/g,' ').replace(/\s+/g,' ').trim();
}

function cleanPhone(phone='') {
  return phone.replace(/[^\d+]/g, '');
}

function normalizeUploadedRole(role='') {
  return role
    .replace(/\bTAAM\b/gi, '')
    .replace(/\bTAA?M\b/gi, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+[-–]\s*$/g, '')
    .trim();
}

function normalizeUploadedSpecialtyLabel(label='') {
  return label
    .replace(/\bTAAM\b/gi, '')
    .replace(/\b(on[\s-]?call|duty|rota|schedule|department)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}
