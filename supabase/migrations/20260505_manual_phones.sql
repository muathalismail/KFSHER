CREATE TABLE manual_phones (
    id BIGSERIAL PRIMARY KEY,
    full_name TEXT NOT NULL UNIQUE,
    phone TEXT NOT NULL,
    specialty_hint TEXT,
    notes TEXT,
    added_by TEXT DEFAULT 'Muath',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_manual_phones_name
    ON manual_phones(LOWER(full_name));

ALTER TABLE manual_phones ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public access" ON manual_phones
    FOR ALL USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION update_manual_phones_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_manual_phones_updated
    BEFORE UPDATE ON manual_phones
    FOR EACH ROW
    EXECUTE FUNCTION update_manual_phones_timestamp();
