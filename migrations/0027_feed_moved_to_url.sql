-- A feed URL that answers 404 or 410 may have moved. Refresh then looks for
-- another feed on the feed's site and stores it here, so subscribers can
-- switch. A successful refresh clears it.
ALTER TABLE feeds ADD COLUMN moved_to_url TEXT
    CHECK (moved_to_url IS NULL OR length(moved_to_url) BETWEEN 1 AND 2048);
