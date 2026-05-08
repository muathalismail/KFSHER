CREATE TABLE IF NOT EXISTS visitor_log (
    id BIGSERIAL PRIMARY KEY,
    visited_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    user_agent TEXT,
    screen_width INTEGER,
    remembered BOOLEAN DEFAULT FALSE
);

CREATE INDEX idx_visitor_log_date ON visitor_log (visited_at DESC);

ALTER TABLE visitor_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public insert visitor_log" ON visitor_log FOR INSERT WITH CHECK (true);
CREATE POLICY "Public read visitor_log" ON visitor_log FOR SELECT USING (true);
