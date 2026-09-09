CREATE TABLE IF NOT EXISTS dream_symbol_links (
  id TEXT PRIMARY KEY,
  dream_id TEXT NOT NULL REFERENCES dream_submissions(id) ON DELETE CASCADE,
  symbol_text TEXT NOT NULL,
  post_slug TEXT NOT NULL,
  post_title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (dream_id, post_slug)
);

CREATE INDEX IF NOT EXISTS idx_dream_symbol_links_dream_id
  ON dream_symbol_links (dream_id);
