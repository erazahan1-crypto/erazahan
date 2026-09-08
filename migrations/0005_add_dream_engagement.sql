CREATE TABLE IF NOT EXISTS dream_reactions (
  id TEXT PRIMARY KEY,
  dream_id TEXT NOT NULL REFERENCES dream_submissions(id) ON DELETE CASCADE,
  reaction_type TEXT NOT NULL
    CHECK (reaction_type IN ('helpful', 'interesting', 'not_helpful')),
  visitor_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (dream_id, reaction_type, visitor_key)
);

CREATE INDEX IF NOT EXISTS idx_dream_reactions_dream_type
  ON dream_reactions (dream_id, reaction_type);

CREATE TABLE IF NOT EXISTS dream_comments (
  id TEXT PRIMARY KEY,
  dream_id TEXT NOT NULL REFERENCES dream_submissions(id) ON DELETE CASCADE,
  name TEXT,
  comment_text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_dream_comments_dream_created
  ON dream_comments (dream_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_dream_comments_status_created
  ON dream_comments (status, created_at DESC);
