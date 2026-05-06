// ═══════════════════════════════════════════════════════════════
// core/phone-resolver.js — Name matching and phone resolution
// ═══════════════════════════════════════════════════════════════
// Canonical functions for fuzzy name matching, canonical name
// normalization, and phone number resolution from contacts.
// No external dependencies.
//
// Match rules (priority order):
//   1. exact          — canonical names identical (distance 0)
//   2. prefix         — one name is prefix of other, diff ≤ 2 chars
//   3. levenshtein-1  — token distance = 1, HIGH confidence
//   4. levenshtein-2  — token distance = 2, MEDIUM confidence
//   5. initial-last   — "H. Barbari" pattern, initial + last name
//   6. none           — no match
// ═══════════════════════════════════════════════════════════════

function initials(name) {
  return name.replace(/^Dr\.?\s*/i,'').split(' ').filter(Boolean).slice(0,2).map(w=>w[0]).join('').toUpperCase() || '?';
}

// Damerau-Levenshtein distance (optimal string alignment).
// Counts transpositions as distance 1 — critical for Arabic
// transliteration variants like "suwakiet" ↔ "suwaiket".
function levenshtein(a='', b='') {
  a = a.toLowerCase(); b = b.toLowerCase();
  const m = a.length, n = b.length;
  const dp = Array.from({length: m + 1}, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i-1] === b[j-1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i-1][j] + 1,       // deletion
        dp[i][j-1] + 1,       // insertion
        dp[i-1][j-1] + cost   // substitution
      );
      // transposition: "ki" ↔ "ik" costs 1, not 2
      if (i > 1 && j > 1 && a[i-1] === b[j-2] && a[i-2] === b[j-1]) {
        dp[i][j] = Math.min(dp[i][j], dp[i-2][j-2] + 1);
      }
    }
  }
  return dp[m][n];
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
      if (token === 'al' || token === 'el') return '';
      if (/^(al|el)[a-z]{3,}$/.test(token)) return token.slice(2);
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

// ═══════════════════════════════════════════════════════════════
// resolvePhone — unified phone resolution with rule-based matching
// ═══════════════════════════════════════════════════════════════
// Returns: { phone, uncertain, matchedName, matchRule } | null

const _RULE_RANK = { 'exact': 0, 'prefix': 1, 'levenshtein-1': 2, 'levenshtein-2': 3 };

function _classifyTokenMatch(tTokens, cTokens) {
  const sig = tTokens.filter(t => t.length >= 3);
  if (!sig.length) return null;
  let worstRule = null;
  for (const tt of sig) {
    let bestForToken = null;
    for (const ct of cTokens) {
      if (ct.length < 3) continue;
      // Rule 1: exact token
      if (tt === ct) { bestForToken = 'exact'; break; }
      // Rule 2: prefix (one starts with the other, length diff ≤ 2)
      if ((ct.startsWith(tt) || tt.startsWith(ct)) && Math.abs(ct.length - tt.length) <= 2) {
        if (!bestForToken || _RULE_RANK[bestForToken] > _RULE_RANK['prefix']) bestForToken = 'prefix';
        continue;
      }
      // Rules 3-4: levenshtein distance
      // Lev-1: min 3 chars (covers Al-stripped names like "ali" vs "aly")
      // Lev-2: min 5 chars (stricter to avoid false positives on short tokens)
      if (tt.length >= 3 && ct.length >= 3) {
        const dist = levenshtein(tt, ct);
        if (dist === 1 && (!bestForToken || _RULE_RANK[bestForToken] > _RULE_RANK['levenshtein-1'])) {
          bestForToken = 'levenshtein-1';
        } else if (dist === 2 && tt.length >= 5 && ct.length >= 5 && (!bestForToken || _RULE_RANK[bestForToken] > _RULE_RANK['levenshtein-2'])) {
          bestForToken = 'levenshtein-2';
        }
      }
    }
    if (!bestForToken) return null; // unmatched significant token → no match
    if (!worstRule || _RULE_RANK[bestForToken] > _RULE_RANK[worstRule]) worstRule = bestForToken;
  }
  return worstRule;
}

function resolvePhone(dept, entry) {
  // ── Early return: entry already has phone — resolve full Dr. name ──
  if (entry.phone) {
    const c0 = dept.contacts || {};
    const refTokens = canonicalName(entry.name || '').split(' ').filter(t => t.length >= 3);
    let fullName = null;
    for (const [cn, cp] of Object.entries(c0)) {
      if (cp !== entry.phone || !/^Dr\.?\s/i.test(cn)) continue;
      if (refTokens.length) {
        const cnTokens = canonicalName(cn).split(' ').filter(t => t.length >= 3);
        if (!refTokens.some(t => cnTokens.some(ct => ct === t || (t.length >= 3 && ct.length >= 3 && levenshtein(t, ct) <= 2)))) continue;
      }
      if (cn.length > (fullName || '').length) fullName = cn;
    }
    return { phone: entry.phone, uncertain: !!entry.phoneUncertain, matchedName: fullName, matchRule: 'exact' };
  }

  // ── Server-extracted contacts (pdfplumber, all specialties) ──
  const sc = (typeof window !== 'undefined' && window._serverExtractedContacts) || {};
  const nameNorm = canonicalName(entry.name || '');
  for (const [scName, scPhone] of Object.entries(sc)) {
    if (scPhone && canonicalName(scName) === nameNorm) {
      return { phone: scPhone, uncertain: false, matchedName: scName, matchRule: 'exact' };
    }
  }
  const scTokens = nameNorm.split(' ').filter(t => t.length >= 3);
  if (scTokens.length && Object.keys(sc).length) {
    const scPrefix = Object.entries(sc).filter(([cn, ph]) => {
      if (!ph) return false;
      const cnToks = canonicalName(cn).split(' ').filter(t => t.length >= 3);
      return scTokens.some(tt => cnToks.some(ct =>
        (ct.startsWith(tt) || tt.startsWith(ct)) && Math.abs(ct.length - tt.length) <= 2
      ));
    });
    if (scPrefix.length === 1) {
      return { phone: scPrefix[0][1], uncertain: false, matchedName: scPrefix[0][0], matchRule: 'prefix' };
    }
  }

  // ── ROTAS contacts ──
  const c = dept.contacts || {};

  // Helper: find the best full "Dr. ..." name for a phone, requiring token overlap
  const _fullNameForPhone = (phone, refName) => {
    if (!phone) return null;
    const refTokens = canonicalName(refName || '').split(' ').filter(t => t.length >= 3);
    let best = null;
    for (const [cn, cp] of Object.entries(c)) {
      if (cp !== phone || !/^Dr\.?\s/i.test(cn)) continue;
      if (refTokens.length) {
        const cnTokens = canonicalName(cn).split(' ').filter(t => t.length >= 3);
        if (!refTokens.some(t => cnTokens.some(ct => ct === t || (t.length >= 3 && ct.length >= 3 && levenshtein(t, ct) <= 2)))) continue;
      }
      if (cn.length > (best || '').length) best = cn;
    }
    return best;
  };

  // Exact key match in contacts dict
  if (c[entry.name]) {
    return { phone: c[entry.name], uncertain: false, matchedName: _fullNameForPhone(c[entry.name], entry.name), matchRule: 'exact' };
  }

  for (const targetName of splitPossibleNames(entry.name)) {
    if (c[targetName]) {
      return { phone: c[targetName], uncertain: false, matchedName: _fullNameForPhone(c[targetName], targetName), matchRule: 'exact' };
    }

    const tNorm = canonicalName(targetName);
    const tTokens = tNorm.split(' ').filter(Boolean);

    // ── Rules 1-4: Token-level matching with Levenshtein distance ──
    // Collect matches per rule, deduplicated by phone number
    const ruleMatches = {
      'exact': new Map(),
      'prefix': new Map(),
      'levenshtein-1': new Map(),
      'levenshtein-2': new Map(),
    };

    for (const [cn, ph] of Object.entries(c)) {
      if (!ph) continue;
      const cNorm = canonicalName(cn);
      const cTokens = cNorm.split(' ').filter(Boolean);

      // Full canonical string exact match
      if (tNorm === cNorm) {
        if (!ruleMatches['exact'].has(ph)) ruleMatches['exact'].set(ph, cn);
        continue;
      }

      const rule = _classifyTokenMatch(tTokens, cTokens);
      if (rule && !ruleMatches[rule].has(ph)) {
        ruleMatches[rule].set(ph, cn);
      }
    }

    // Apply rules in priority order — uniqueness required (exactly 1 phone)
    const RULE_ORDER = [
      ['exact',         false],
      ['prefix',        false],
      ['levenshtein-1', false],
      ['levenshtein-2', true],
    ];
    for (const [rule, uncertain] of RULE_ORDER) {
      const matches = ruleMatches[rule];
      if (matches.size === 1) {
        const [[ph, cn]] = [...matches.entries()];
        return { phone: ph, uncertain, matchedName: _fullNameForPhone(ph, targetName) || cn, matchRule: rule };
      }
    }

    // ── Rule 4.5: Firstname + last-name initial ("Mohammed.K", "Sara.A") ──
    // When rules 1-4 are ambiguous (2+ matches), a single-letter token
    // can disambiguate by matching the start of a contact's last name
    // (after Al/El stripping via canonicalName).
    const lastNameInitial = tTokens.find(t => t.length === 1);
    const sigTokens = tTokens.filter(t => t.length >= 3);
    if (lastNameInitial && sigTokens.length >= 1) {
      // Find the best rule that had ambiguous (2+) results
      for (const [rule, uncertain] of RULE_ORDER) {
        const matches = ruleMatches[rule];
        if (matches.size < 2) continue;
        // Filter: keep only contacts whose (Al/El-stripped) last name starts with the initial
        const filtered = new Map();
        for (const [ph] of matches) {
          for (const [cn2, ph2] of Object.entries(c)) {
            if (ph2 !== ph) continue;
            const cTokens = canonicalName(cn2).split(' ').filter(Boolean);
            if (cTokens.length < 2) continue;
            if (cTokens[cTokens.length - 1].startsWith(lastNameInitial)) {
              if (!filtered.has(ph)) filtered.set(ph, cn2);
            }
          }
        }
        if (filtered.size === 1) {
          const [[ph, cn]] = [...filtered.entries()];
          return { phone: ph, uncertain, matchedName: _fullNameForPhone(ph, targetName) || cn, matchRule: rule };
        }
      }
    }

    // ── Rule 5: Initial + last name pattern ("H. Barbari", "Dr. A. Aldhakeel") ──
    const drStripped = targetName.replace(/^Dr\.?\s*/i, '').trim();
    const initialLastMatch = drStripped.match(/^([A-Za-z])[\.\s]+([A-Za-z]{3,})$/);
    if (initialLastMatch) {
      const initial = initialLastMatch[1].toLowerCase();
      const lastRaw = canonicalName(initialLastMatch[2]);

      const lastNameMatches = (cnLast) => {
        if (cnLast === lastRaw) return true;
        if ((cnLast.startsWith(lastRaw) || lastRaw.startsWith(cnLast)) && Math.abs(cnLast.length - lastRaw.length) <= 2) return true;
        if (lastRaw.length >= 4 && cnLast.length >= 4 && levenshtein(lastRaw, cnLast) <= 2) return true;
        return false;
      };

      const allLastHits = Object.entries(c).filter(([cn, ph]) => {
        if (!ph) return false;
        const cnTokens = canonicalName(cn).split(' ').filter(Boolean);
        if (cnTokens.length < 2) return false;
        return lastNameMatches(cnTokens[cnTokens.length - 1]);
      });

      // Deduplicate by phone
      const byPhone = new Map();
      for (const [cn, ph] of allLastHits) {
        if (!byPhone.has(ph)) byPhone.set(ph, cn);
      }

      if (byPhone.size === 1) {
        const [[ph, cn]] = [...byPhone.entries()];
        const hasInitialMatch = allLastHits.some(([cn2]) => {
          const cnFirst = canonicalName(cn2).split(' ').filter(Boolean)[0];
          return cnFirst && cnFirst.startsWith(initial);
        });
        return { phone: ph, uncertain: !hasInitialMatch, matchedName: _fullNameForPhone(ph, targetName) || cn, matchRule: 'initial-last' };
      }

      // Multiple phones: try to disambiguate by initial
      const initialFiltered = allLastHits.filter(([cn2]) => {
        const cnFirst = canonicalName(cn2).split(' ').filter(Boolean)[0];
        return cnFirst && cnFirst.startsWith(initial);
      });
      const byPhoneInit = new Map();
      for (const [cn, ph] of initialFiltered) {
        if (!byPhoneInit.has(ph)) byPhoneInit.set(ph, cn);
      }
      if (byPhoneInit.size === 1) {
        const [[ph, cn]] = [...byPhoneInit.entries()];
        return { phone: ph, uncertain: false, matchedName: _fullNameForPhone(ph, targetName) || cn, matchRule: 'initial-last' };
      }
    }
  }

  // Rule 6: no match
  return null;
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
      const prevLong = i > 0 && tokens[i - 1].length >= 3;
      const nextLong = i < tokens.length - 1 && tokens[i + 1].length >= 3;
      if (prevLong && nextLong) return false;
      if (i === 0 && nextLong && tokens.length === 2) return false;
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
