-- =========================================
-- Upload monitoring + custom specialties
-- =========================================

CREATE TABLE IF NOT EXISTS upload_logs (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  filename TEXT NOT NULL,
  file_size_bytes BIGINT,
  pdf_storage_path TEXT,
  pdf_url TEXT,
  detection_stage TEXT,
  detected_specialty TEXT,
  manual_override_input TEXT,
  match_method TEXT,
  status TEXT NOT NULL,
  entries_count INTEGER DEFAULT 0,
  error_code TEXT,
  error_message TEXT,
  pipeline_trace JSONB,
  is_custom_specialty BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_upload_logs_created ON upload_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_upload_logs_status ON upload_logs (status);
CREATE INDEX IF NOT EXISTS idx_upload_logs_specialty ON upload_logs (detected_specialty);

ALTER TABLE upload_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read upload_logs" ON upload_logs FOR SELECT USING (true);
CREATE POLICY "Public insert upload_logs" ON upload_logs FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update upload_logs" ON upload_logs FOR UPDATE USING (true);
CREATE POLICY "Public delete upload_logs" ON upload_logs FOR DELETE USING (true);

CREATE TABLE IF NOT EXISTS custom_specialties (
  id BIGSERIAL PRIMARY KEY,
  key TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  upload_count INTEGER DEFAULT 1,
  last_upload_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_custom_specialties_key ON custom_specialties (key);

ALTER TABLE custom_specialties ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public access custom_specialties" ON custom_specialties
    FOR ALL USING (true) WITH CHECK (true);
