-- Coordinate paid summary generation across Worker isolates.
CREATE TABLE entry_summary_generation_leases (
    entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    content_hash BLOB NOT NULL CHECK (length(content_hash) = 32),
    model TEXT NOT NULL CHECK (length(trim(model)) > 0),
    prompt_version TEXT NOT NULL CHECK (length(trim(prompt_version)) > 0),
    lease_token INTEGER NOT NULL CHECK (lease_token BETWEEN 1 AND 9007199254740991),
    lease_expires_at INTEGER NOT NULL CHECK (lease_expires_at >= 0),
    created_at INTEGER NOT NULL CHECK (created_at >= 0),
    updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
    PRIMARY KEY (entry_id, content_hash, model, prompt_version)
) STRICT, WITHOUT ROWID;
