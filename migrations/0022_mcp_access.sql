-- MCP access is opt-in per user. A non-null value records when the user turned
-- it on. While it is NULL, MCP clients cannot complete authorization and every
-- MCP access token the user holds is rejected, even before it expires.
ALTER TABLE users ADD COLUMN mcp_enabled_at INTEGER
    CHECK (mcp_enabled_at IS NULL OR mcp_enabled_at >= 0);

-- One row per MCP authorization. Every token carries its connection ID in its
-- encrypted props, and every MCP request checks the row is still active. D1 is
-- the source of truth for revocation: the OAuth library's KV records can be
-- rewritten by a refresh that races a revocation, and turning MCP off must
-- revoke any number of grants in one statement.
CREATE TABLE mcp_connections (
    id INTEGER PRIMARY KEY CHECK (id BETWEEN 1 AND 9007199254740991),
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    client_id TEXT NOT NULL CHECK (length(client_id) BETWEEN 1 AND 512),
    created_at INTEGER NOT NULL CHECK (created_at >= 0),
    revoked_at INTEGER CHECK (revoked_at IS NULL OR revoked_at >= created_at)
) STRICT;

CREATE INDEX mcp_connections_active
    ON mcp_connections(user_id) WHERE revoked_at IS NULL;
