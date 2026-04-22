// ═══════════════════════════════════════════════════════════════
// resolver/shift-filter.js — Unified shift-based entry filtering
// ═══════════════════════════════════════════════════════════════
// Single entry point for filtering schedule entries by current time.
// Replaces the fragmented approach of isExplicitDayEntry,
// isExplicitOnCallEntry, filterActiveEntries, isEntryActive, etc.
// Depends on: core/time.js (isWorkHours, isWeekend, timeRangeActive,
//             isShiftWindowActive, parseTimeToMinutes)
//             core/entry-model.js (roleText, isNoteEntry, isNoCoverageEntry,
//             isLikelyClinicalRole)
//             core/lanes.js (getLanesForDept, matchEntryToLane)
// ═══════════════════════════════════════════════════════════════

/**
 * Infer a ShiftWindow from an entry's metadata.
 * Uses explicit times if available, falls back to role-based heuristics.
 */
function inferShiftWindow(entry, deptKey) {
  // 1. Explicit startTime/endTime on entry
  const start = String(entry.startTime || '').trim();
  const end = String(entry.endTime || '').trim();
  if (start && end) {
    const startMin = parseTimeToMinutes(start);
    const endMin = parseTimeToMinutes(end);
    if (!Number.isNaN(startMin) && !Number.isNaN(endMin)) {
      let type = 'on-call';
      if (startMin === endMin || entry.shiftType === '24h') type = '24h';
      else if (startMin >= 7*60 && endMin <= 17*60 && endMin > startMin) type = 'day';
      else type = 'night';
      return { start, end, type: entry.shiftType || type };
    }
  }

  // 2. Explicit shiftType
  if (entry.shiftType === '24h') return { start: '07:30', end: '07:30', type: '24h' };
  if (entry.shiftType === 'day') return { start: '07:30', end: '16:30', type: 'day' };
  if (entry.shiftType === 'night' || entry.shiftType === 'on-call') return { start: '16:30', end: '07:30', type: 'night' };

  // 3. Lane-based default shift
  const lanes = getLanesForDept(deptKey);
  if (lanes) {
    const laneId = matchEntryToLane(entry, lanes);
    if (laneId) {
      const lane = lanes.find(l => l.id === laneId);
      if (lane && lane.shift) return { ...lane.shift };
    }
  }

  // 4. Role-based heuristics (backwards compatible with isExplicitDayEntry/isExplicitOnCallEntry)
  const r = roleText(entry);
  if (r.includes('24h')) return { start: '07:30', end: '07:30', type: '24h' };
  if (/\b(day|duty|coverage|er\/consult|inpatient|outpatient|clinic)\b/.test(r) && !r.includes('after')) {
    return { start: '07:30', end: '16:30', type: 'day' };
  }
  if (r.includes('on-call') || r.includes('oncall') || r.includes('after') || r.includes('night')) {
    return { start: '16:30', end: '07:30', type: 'night' };
  }

  // 5. No signal — return null (caller decides)
  return null;
}

/**
 * Determine if a single entry is active right now.
 * Uses ShiftWindow-based activation.
 */
function isEntryActiveNow(entry, now, deptKey) {
  if (!entry) return false;
  const sw = inferShiftWindow(entry, deptKey);
  if (!sw) return false;
  return isShiftWindowActive(sw, now);
}

/**
 * Filter entries to only those active at the given time.
 * Lane-aware: uses lane definitions for better classification when available.
 *
 * This is the unified replacement for filterActiveEntries.
 * The old function is still available in entry-model.js for backward compatibility
 * during the transition.
 */
function filterActiveEntriesV2(entries, now, deptKey) {
  if (!entries || !entries.length) return [];

  const usable = entries.filter(entry => !isNoteEntry(entry));
  if (!usable.length) return [];

  // No-coverage entries pass through
  const noCoverage = usable.filter(isNoCoverageEntry);
  if (noCoverage.length) return noCoverage;

  // Try ShiftWindow-based filtering, counting entries with determinable windows
  const active = [];
  let determinedCount = 0;

  for (const entry of usable) {
    const sw = inferShiftWindow(entry, deptKey);
    if (sw) {
      determinedCount++;
      if (isShiftWindowActive(sw, now)) active.push(entry);
    }
  }

  if (active.length) return active;

  // If every entry had a determinable shift window but none are active now,
  // nothing is on-call at this time — return empty rather than falling back
  // to the legacy filter which would return ALL consultant-role entries.
  if (determinedCount === usable.length) return [];

  // Fallback: only when some/all entries lack inferable shift windows
  return filterActiveEntries(usable, now);
}
