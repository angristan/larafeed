-- Keep sanitized SVGs separate from legacy normalized PNGs. Older Worker
-- versions safely treat these hashes as missing instead of parsing SVG as PNG.
CREATE TABLE favicon_svg_assets (
    hash TEXT PRIMARY KEY
        CHECK (
            length(hash) = 64
            AND hash = lower(hash)
            AND hash NOT GLOB '*[^0-9a-f]*'
        ),
    svg BLOB NOT NULL CHECK (length(svg) BETWEEN 1 AND 65536),
    created_at INTEGER NOT NULL CHECK (created_at >= 0)
) STRICT;

CREATE INDEX idx_favicon_svg_assets_created_at
    ON favicon_svg_assets (created_at, hash);
