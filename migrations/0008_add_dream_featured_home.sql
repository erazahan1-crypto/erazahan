ALTER TABLE dream_submissions
  ADD COLUMN featured_home INTEGER NOT NULL DEFAULT 0
  CHECK (featured_home IN (0, 1));

CREATE INDEX IF NOT EXISTS idx_dream_submissions_featured_home
  ON dream_submissions (featured_home, status, answered_at DESC);
