-- Keep feed-advertised metadata separate from the favicon selected by discovery.
-- Existing values are the best available source until the next feed refresh records
-- the publisher's current advertised URL.
ALTER TABLE feeds ADD COLUMN feed_favicon_url TEXT;

UPDATE feeds
SET feed_favicon_url = favicon_url
WHERE favicon_url IS NOT NULL;
