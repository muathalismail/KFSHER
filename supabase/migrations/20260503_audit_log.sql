CREATE TABLE IF NOT EXISTS audit_log (
    id BIGSERIAL PRIMARY KEY,
    action TEXT NOT NULL,
    specialty TEXT NOT NULL,
    entry_id TEXT,
    field_name TEXT,
    old_value TEXT,
    new_value TEXT,
    changed_by TEXT DEFAULT 'Muath',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_audit_log_specialty
    ON audit_log(specialty, created_at DESC);

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read" ON audit_log FOR SELECT USING (true);
CREATE POLICY "Public insert" ON audit_log FOR INSERT WITH CHECK (true);
