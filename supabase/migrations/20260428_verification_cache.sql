-- Verification Cache: stores Claude API results keyed by file hash + specialty.
-- Same file uploaded again → return cached result → skip Claude API call.
-- TTL: 30 days. cache_version allows forced invalidation via config change.

CREATE TABLE IF NOT EXISTS verification_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_hash text NOT NULL,
  specialty text NOT NULL,
  cache_version text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz DEFAULT now(),
  expires_at timestamptz DEFAULT (now() + interval '30 days'),
  CONSTRAINT unique_cache_entry UNIQUE(file_hash, specialty, cache_version)
);

-- Fast lookup by hash + specialty + version, only non-expired rows
CREATE INDEX IF NOT EXISTS idx_cache_lookup
ON verification_cache(file_hash, specialty, cache_version)
WHERE expires_at > now();

-- For cleanup jobs: find expired rows
CREATE INDEX IF NOT EXISTS idx_cache_expiry
ON verification_cache(expires_at);

-- RLS: read open (same as kfsher), write restricted to service key
ALTER TABLE verification_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_select" ON verification_cache
  FOR SELECT USING (true);

-- No INSERT/UPDATE/DELETE policies for anon role.
-- Writes go through serverless function using SUPABASE_SERVICE_KEY
-- which bypasses RLS entirely (service_role).

-- ROLLBACK: DROP TABLE IF EXISTS verification_cache;
