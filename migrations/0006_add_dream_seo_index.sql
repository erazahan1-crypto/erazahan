ALTER TABLE dream_submissions ADD COLUMN seo_index INTEGER NOT NULL DEFAULT 0 CHECK (seo_index IN (0, 1));
