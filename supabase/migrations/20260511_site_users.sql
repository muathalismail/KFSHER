CREATE TABLE IF NOT EXISTS site_users (
    id BIGSERIAL PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    email TEXT NOT NULL,
    is_approved BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_site_users_username ON site_users (LOWER(username));

ALTER TABLE site_users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public insert site_users" ON site_users FOR INSERT WITH CHECK (true);
CREATE POLICY "Public read site_users" ON site_users FOR SELECT USING (true);
CREATE POLICY "Public update site_users" ON site_users FOR UPDATE USING (true);

-- Seed existing hardcoded users
INSERT INTO site_users (username, password, email, is_approved, is_active)
VALUES ('x', 'x', 'admin@kfsher.com', true, true),
       ('a', 'a', 'admin@kfsher.com', true, true)
ON CONFLICT (username) DO NOTHING;

-- Add username column to visitor_log
ALTER TABLE visitor_log ADD COLUMN IF NOT EXISTS username TEXT;
