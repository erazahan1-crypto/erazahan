CREATE TABLE IF NOT EXISTS dream_submissions (
  id TEXT PRIMARY KEY,
  name TEXT,
  email TEXT NOT NULL,
  dream_text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'answered', 'rejected')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_dream_submissions_status_created
  ON dream_submissions (status, created_at DESC);
