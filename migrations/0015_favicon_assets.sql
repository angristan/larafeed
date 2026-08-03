-- Store normalized favicon PNGs by content hash. Public delivery uses immutable URLs,
-- while D1 remains the durable source when an edge-cache entry is cold or evicted.
CREATE TABLE favicon_assets (
    hash TEXT PRIMARY KEY
        CHECK (
            length(hash) = 64
            AND hash = lower(hash)
            AND hash NOT GLOB '*[^0-9a-f]*'
        ),
    png BLOB NOT NULL CHECK (length(png) BETWEEN 1 AND 65536),
    created_at INTEGER NOT NULL CHECK (created_at >= 0)
) STRICT;

CREATE INDEX idx_favicon_assets_created_at
    ON favicon_assets (created_at, hash);

ALTER TABLE feeds ADD COLUMN favicon_asset_hash TEXT
    CHECK (
        favicon_asset_hash IS NULL OR (
            length(favicon_asset_hash) = 64
            AND favicon_asset_hash = lower(favicon_asset_hash)
            AND favicon_asset_hash NOT GLOB '*[^0-9a-f]*'
        )
    );

CREATE INDEX idx_feeds_favicon_asset_hash
    ON feeds (favicon_asset_hash)
    WHERE favicon_asset_hash IS NOT NULL;

-- Force a bounded Cron/refresh backfill instead of waiting up to 30 days.
UPDATE feeds
SET favicon_updated_at = NULL
WHERE favicon_url IS NOT NULL;
