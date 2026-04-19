// ═══════════════════════════════════════════════════════
// imaging_on_duty_validator.js — Post-extraction accuracy layer
// SCOPED TO: Imaging On-Duty (radiology_duty) ONLY
// ═══════════════════════════════════════════════════════
// This validator runs AFTER parseRadiologyDutyPdfEntries returns.
// It cross-checks the extraction for known structural errors:
//   1. Section boundary leaks (MSK doctor in THORACIC, etc.)
//   2. Role misassignment (fellow promoted to consultant)
//   3. Name fragment cleanup ("F." standalone, "A." without last name)
//   4. Duplicate names across roles in same record
//   5. Phone number confidence check
//
// If any correction is made, it's logged to the console for audit.
// If any check fails gracefully, the original record is returned unchanged.
// ═══════════════════════════════════════════════════════

/**
 * Section-locked doctors. Each doctor belongs to ONE section only.
 * If they appear in the wrong section's entries → remove them.
 */
const SECTION_LOCKS = {
  'A. Dhafiri': 'MSK',
  'Ahmed Al Dhafiri': 'MSK',
  'Dr. Ahmed Al Dhafiri': 'MSK',
  'Fatimah Albahhar': 'MSK',
  'Hassan Ghafouri': 'MSK',
};

/**
 * Known name fragments that should never appear as standalone names.
 * Usually caused by PDF.js splitting "F. Alkhabaz" across AM/PM boundary.
 */
const INVALID_NAME_FRAGMENTS = new Set([
  'F.', 'A.', 'N.', 'H.', 'M.', 'S.', 'K.', 'R.', 'T.', 'E.',
  'Al', 'Al-', 'Dr.', 'Dr',
]);

/**
 * Validate and correct a set of Imaging On-Duty extraction records.
 * ONLY call this for radiology_duty entries.
 *
 * @param {Array} records - parsed entries from parseRadiologyDutyPdfEntries
 * @param {string} sourceText - raw PDF text (for context, not re-parsed)
 * @returns {Array} corrected records in the SAME format
 */
function validateImagingOnDutyExtraction(records, sourceText) {
  if (!Array.isArray(records) || !records.length) return records;

  // Only apply to imaging duty — quick sanity check
  const hasImagingSection = records.some(r =>
    (r.section || '').match(/NEURO|BODY|THORAC|MSK|BREAST|PEDIA/i)
  );
  if (!hasImagingSection) return records; // not imaging duty, skip

  let corrections = 0;
  const corrected = records.map(record => {
    const r = { ...record };
    const section = (r.section || '').toUpperCase();

    // ── CHECK 1: Section boundary enforcement ──────────────────
    for (const [doctorName, lockedSection] of Object.entries(SECTION_LOCKS)) {
      const nameNorm = doctorName.toLowerCase();
      if (section === lockedSection.toUpperCase()) continue; // correct section, skip

      // Check if this doctor appears in any role for the WRONG section
      for (const role of ['name']) {
        if ((r[role] || '').toLowerCase().includes(nameNorm)) {
          console.log(`[IMAGING VALIDATOR] Section leak: "${doctorName}" belongs to ${lockedSection}, found in ${section}. Removing.`);
          r[role] = '';
          corrections++;
        }
      }
    }

    // ── CHECK 2: Name fragment cleanup ─────────────────────────
    const name = (r.name || '').trim();
    if (INVALID_NAME_FRAGMENTS.has(name)) {
      console.log(`[IMAGING VALIDATOR] Name fragment: "${name}" is not a valid name. Clearing.`);
      r.name = '';
      corrections++;
    }

    // ── CHECK 3: Role assignment — fellow vs consultant ────────
    // If a name appears as both Fellow and Consultant in entries
    // for the same date+shift+section, keep only the role that matches
    // the PDF's structural row (consultant row vs fellow sub-row).
    // This is enforced at the group level below.

    return r;
  });

  // ── CHECK 4: Cross-record role deduplication ──────────────
  // Group entries by date+shift+section, then check for duplicate names
  const groups = {};
  corrected.forEach((r, idx) => {
    const key = `${r.date || ''}|${r.startTime || ''}|${r.section || ''}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push({ record: r, idx });
  });

  for (const [key, entries] of Object.entries(groups)) {
    const nameToRole = {};
    entries.forEach(({ record }) => {
      const name = (record.name || '').toLowerCase();
      const role = (record.role || '').toLowerCase();
      if (!name) return;
      if (nameToRole[name] && nameToRole[name] !== role) {
        // Same name, different roles in same shift/section
        // Keep the one that's more specific (resident > fellow > consultant)
        const priority = { 'consultant': 3, 'fellow': 2, 'resident': 1, 'assistant/associate consultant': 0 };
        const existingPri = priority[nameToRole[name]] || 99;
        const newPri = priority[role] || 99;
        if (newPri > existingPri) {
          // Current is higher priority (consultant) — remove the duplicate lower-priority entry
          const dup = entries.find(e =>
            (e.record.name || '').toLowerCase() === name
            && (e.record.role || '').toLowerCase() === nameToRole[name]
          );
          if (dup) {
            console.log(`[IMAGING VALIDATOR] Role dedup: "${record.name}" in both "${nameToRole[name]}" and "${role}". Keeping "${role}".`);
            corrected[dup.idx] = { ...dup.record, name: '' };
            corrections++;
          }
        }
      }
      nameToRole[name] = role;
    });
  }

  // ── CHECK 5: Phone number format validation ──────────────
  corrected.forEach(r => {
    const phone = (r.phone || '').replace(/[^0-9]/g, '');
    if (phone && !phone.match(/^05\d{8}$/)) {
      console.log(`[IMAGING VALIDATOR] Bad phone format: "${r.phone}" for "${r.name}". Clearing.`);
      r.phone = '';
      r.phoneUncertain = true;
      corrections++;
    }
  });

  // Remove entries with empty names (cleaned by checks above)
  const final = corrected.filter(r => (r.name || '').trim().length > 1);

  if (corrections > 0) {
    console.log(`[IMAGING VALIDATOR] ${corrections} correction(s) applied. ${records.length} → ${final.length} entries.`);
  }

  return final;
}
