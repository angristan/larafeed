-- MCP access is opt-in per user. A non-null value records when the user turned
-- it on. While it is NULL, MCP clients cannot complete authorization and every
-- MCP access token the user holds is rejected, even before it expires.
ALTER TABLE users ADD COLUMN mcp_enabled_at INTEGER
    CHECK (mcp_enabled_at IS NULL OR mcp_enabled_at >= 0);
