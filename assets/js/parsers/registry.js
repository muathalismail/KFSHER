// ═══════════════════════════════════════════════════════════════
// parsers/registry.js — Parser dispatch registry
// ═══════════════════════════════════════════════════════════════
// Maps deptKey → parser strategy. Used by parseUploadedPdf to
// dispatch to the correct specialty parser without an if/else chain.
// Each strategy returns { entries, parserMode, meta }.
// Depends on: parsers/generic.js, parsers/*.js (specialty parsers)
// ═══════════════════════════════════════════════════════════════

/**
 * Wraps a specialized parser with the common template-detection pattern:
 *   - If _templateDetected, use specialized output only.
 *   - Otherwise, merge with generic fallbacks.
 */
function templateFallbackStrategy(specializedParseFn, opts={}) {
  const { extraFallbacks = [], templatePrefix = '' } = opts;
  return function(text, deptKey) {
    const specialized = specializedParseFn(text, deptKey);
    if (specialized._templateDetected && specialized.length) {
      const entries = dedupeParsedEntries([...specialized]);
      return {
        entries,
        parserMode: 'specialized',
        meta: {
          templateDetected: true,
          templateName: specialized._templateName || `${templatePrefix || deptKey}-monthly-uploaded`,
          coreSectionsFound: specialized._coreSectionsFound || [],
        },
      };
    }
    // Fallback: merge specialized + extra + generic
    const fallbackEntries = [];
    for (const fallbackFn of extraFallbacks) {
      fallbackEntries.push(...fallbackFn(text, deptKey));
    }
    const genericParsed = parseGenericPdfEntries(text, deptKey);
    const entries = dedupeParsedEntries([...specialized, ...fallbackEntries, ...genericParsed]);
    return {
      entries,
      parserMode: 'generic-fallback',
      meta: { templateDetected: false },
    };
  };
}

/**
 * Registry of deptKey → parser strategy function.
 * Each function signature: (text, deptKey) → { entries, parserMode, meta }
 */
const PARSER_REGISTRY = {};

// ── Direct specialized parsers (no generic fallback) ──────────

PARSER_REGISTRY['anesthesia'] = function(text, deptKey) {
  return {
    entries: parseAnesthesiaPdfEntries(text, deptKey),
    parserMode: 'specialized',
    meta: { templateDetected: false },
  };
};

PARSER_REGISTRY['radiology_duty'] = function(text, deptKey) {
  const raw = parseRadiologyDutyPdfEntries(text, deptKey);
  // Imaging On-Duty accuracy layer — scoped to radiology_duty ONLY
  const entries = (typeof validateImagingOnDutyExtraction === 'function')
    ? validateImagingOnDutyExtraction(raw, text)
    : raw;
  return {
    entries,
    parserMode: 'specialized',
    meta: { templateDetected: false },
  };
};

PARSER_REGISTRY['radiology_oncall'] = function(text, deptKey) {
  return {
    entries: parseRadiologyOnCallPdfEntries(text, deptKey),
    parserMode: 'specialized',
    meta: { templateDetected: true },
  };
};

PARSER_REGISTRY['medicine_on_call'] = function(text, deptKey) {
  return {
    entries: parseMedicineOnCallPdfEntries(text, deptKey),
    parserMode: 'specialized',
    meta: { templateDetected: false },
  };
};

PARSER_REGISTRY['medicine'] = function(text, deptKey) {
  return {
    entries: parseMedicinePdfEntries(text, deptKey),
    parserMode: 'specialized',
    meta: { templateDetected: false },
  };
};

// ── Merge-with-generic parsers ────────────────────────────────

PARSER_REGISTRY['ophthalmology'] = function(text, deptKey) {
  const seqParsed = parseDaySequence(text, deptKey); // auto-detects month/year
  const genericParsed = parseGenericPdfEntries(text, deptKey);
  return {
    entries: dedupeParsedEntries([...seqParsed, ...genericParsed]),
    parserMode: 'generic',
    meta: { templateDetected: false },
  };
};

PARSER_REGISTRY['nephrology'] = function(text, deptKey) {
  const inlineParsed = parseSingleLineDateSplit(text, deptKey);
  const genericParsed = parseGenericPdfEntries(text, deptKey);
  return {
    entries: dedupeParsedEntries([...inlineParsed, ...genericParsed]),
    parserMode: 'generic',
    meta: { templateDetected: false },
  };
};

PARSER_REGISTRY['orthopedics'] = function(text, deptKey) {
  const orthoParsed = parseOrthopedicsPdfEntries(text, deptKey);
  if (orthoParsed._templateDetected && orthoParsed.length) {
    return {
      entries: dedupeParsedEntries([...orthoParsed]),
      parserMode: 'specialized',
      meta: { templateDetected: true, templateName: orthoParsed._templateName || 'orthopedics-monthly-uploaded' },
    };
  }
  // Template not detected — store without activating
  return {
    entries: [],
    parserMode: 'generic-fallback',
    meta: { templateDetected: false },
  };
};

PARSER_REGISTRY['gynecology'] = templateFallbackStrategy(parseGynecologyPdfEntries, {
  templatePrefix: 'gynecology',
});

// ── Template-detection parsers (specialized or fallback) ──────

PARSER_REGISTRY['liver'] = templateFallbackStrategy(parseLiverPdfEntries, {
  templatePrefix: 'liver',
  extraFallbacks: [parseSingleLineDateSplit],
});

PARSER_REGISTRY['kptx'] = templateFallbackStrategy(parseKptxPdfEntries, {
  templatePrefix: 'kptx',
  extraFallbacks: [parseSingleLineDateSplit],
});

PARSER_REGISTRY['spine'] = templateFallbackStrategy(parseSpinePdfEntries, {
  templatePrefix: 'spine',
  extraFallbacks: [parseSingleLineDateSplit],
});

PARSER_REGISTRY['neurosurgery'] = templateFallbackStrategy(parseNeurosurgeryPdfEntries, {
  templatePrefix: 'neurosurgery',
  extraFallbacks: [parseSingleLineDateSplit, (text, dk) => parseDaySequence(text, dk)],
});

PARSER_REGISTRY['surgery'] = templateFallbackStrategy(parseSurgeryPdfEntries, {
  templatePrefix: 'surgery',
  extraFallbacks: [(text, dk) => parseDaySequence(text, dk)],
});

PARSER_REGISTRY['hospitalist'] = templateFallbackStrategy(parseHospitalistPdfEntries, {
  templatePrefix: 'hospitalist',
});

PARSER_REGISTRY['neurology'] = templateFallbackStrategy(parseNeurologyPdfEntries, {
  templatePrefix: 'neurology',
  extraFallbacks: [(text, dk) => parseDaySequence(text, dk)],
});

PARSER_REGISTRY['pediatrics'] = templateFallbackStrategy(parsePediatricsPdfEntries, {
  templatePrefix: 'pediatrics',
});

PARSER_REGISTRY['hematology'] = templateFallbackStrategy(parseHematologyPdfEntries, {
  templatePrefix: 'hematology',
});

PARSER_REGISTRY['palliative'] = function(text, deptKey) {
  const parsed = parsePalliativePdfEntries(text, deptKey);
  if (parsed._templateDetected && parsed.length) {
    return {
      entries: dedupeParsedEntries([...parsed]),
      parserMode: 'specialized',
      meta: { templateDetected: true, templateName: parsed._templateName || 'palliative-monthly-uploaded' },
    };
  }
  // No server data → return empty, do NOT merge with generic (corrupts with header text)
  return { entries: [], parserMode: 'generic-fallback', meta: { templateDetected: false } };
};

PARSER_REGISTRY['ent'] = templateFallbackStrategy(parseEntPdfEntries, {
  templatePrefix: 'ent',
});

PARSER_REGISTRY['picu'] = function(text, deptKey) {
  const picuParsed = parsePicuPdfEntries(text, deptKey);
  if (picuParsed._templateDetected) {
    const entries = dedupeParsedEntries([...picuParsed]);
    return {
      entries,
      parserMode: 'specialized',
      meta: {
        templateDetected: true,
        templateName: picuParsed._templateName || 'picu-monthly-uploaded',
        coreSectionsFound: picuParsed._coreSectionsFound || [],
      },
    };
  }
  const genericParsed = parseGenericPdfEntries(text, deptKey);
  return {
    entries: dedupeParsedEntries([...picuParsed, ...genericParsed]),
    parserMode: 'generic-fallback',
    meta: { templateDetected: false },
  };
};

// ── Lookup function ───────────────────────────────────────────

/**
 * Returns the parser strategy for a given deptKey.
 * Falls through medicine subspecialties to the medicine parser.
 * Falls through anesthesia-like filenames.
 * Returns null for unknown specialties (caller should use generic).
 */
function getParserForDept(deptKey, fileName) {
  if (PARSER_REGISTRY[deptKey]) return PARSER_REGISTRY[deptKey];
  if (typeof isMedicineSubspecialty === 'function' && isMedicineSubspecialty(deptKey)) {
    return PARSER_REGISTRY['medicine'];
  }
  if (deptKey === 'anesthesia' || (typeof isAnesthesiaLike === 'function' && isAnesthesiaLike(fileName || ''))) {
    return PARSER_REGISTRY['anesthesia'];
  }
  return null;
}
