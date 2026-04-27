// Verification cache configuration.
// Bump VERSION to force re-verification of all cached files.
const CACHE_CONFIG = {
  VERSION: 'v1.0',
  TTL_DAYS: 30,
  TIMEOUT_MS: 2000,
  ENABLED_SPECIALTIES: ['medicine_on_call'],
  VALID_SPECIALTIES: [
    'medicine_on_call', 'surgery', 'pediatrics', 'radiology_oncall',
    'hospitalist', 'ent', 'orthopedics', 'spine', 'neurosurgery',
  ],
};

module.exports = { CACHE_CONFIG };
