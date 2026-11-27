-- Gone feeds are still refreshed, once a day at most, so the cron scans
-- every feed in next-attempt order instead of only feeds that are not gone.
DROP INDEX feeds_due_refresh;
CREATE INDEX feeds_due_refresh ON feeds(next_refresh_at, id);
