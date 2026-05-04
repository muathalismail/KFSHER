CREATE TABLE specialty_clicks (
    id BIGSERIAL PRIMARY KEY,
    specialty TEXT NOT NULL,
    clicked_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    date_only DATE GENERATED ALWAYS AS (clicked_at::date) STORED
);

CREATE INDEX idx_clicks_specialty_date
    ON specialty_clicks(specialty, date_only);

CREATE INDEX idx_clicks_recent
    ON specialty_clicks(clicked_at DESC);

ALTER TABLE specialty_clicks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public insert" ON specialty_clicks
    FOR INSERT WITH CHECK (true);
CREATE POLICY "Public read" ON specialty_clicks
    FOR SELECT USING (true);
