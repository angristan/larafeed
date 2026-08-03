ALTER TABLE feeds ADD COLUMN consecutive_not_found_failures INTEGER NOT NULL DEFAULT 0
    CHECK (consecutive_not_found_failures >= 0);
