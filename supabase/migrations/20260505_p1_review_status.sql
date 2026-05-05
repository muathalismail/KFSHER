-- ============================================================
-- P1A: Add correction tracking columns + rename cancelled → review
-- ============================================================

-- Add tracking columns (idempotent — safe to re-run)
ALTER TABLE upload_logs
  ADD COLUMN IF NOT EXISTS original_specialty TEXT,
  ADD COLUMN IF NOT EXISTS corrected_specialty TEXT,
  ADD COLUMN IF NOT EXISTS corrected_at TIMESTAMPTZ;

-- Rename existing 'cancelled' status values to 'review'
UPDATE upload_logs
SET status = 'review'
WHERE status = 'cancelled';

-- Verification queries (run manually after migration):
-- SELECT COUNT(*) FROM upload_logs WHERE status = 'cancelled';  -- should be 0
-- SELECT COUNT(*) FROM upload_logs WHERE status = 'review';     -- should be ≥ previous cancelled count
