-- Fever clients send MD5(username:app-token) as their API key. Store only a
-- one-way SHA-256 verifier of that legacy value, never the app token or MD5.
ALTER TABLE app_tokens ADD COLUMN fever_verifier_hash BLOB
    CHECK (fever_verifier_hash IS NULL OR length(fever_verifier_hash) = 32);

CREATE UNIQUE INDEX app_tokens_fever_verifier_unique
    ON app_tokens(fever_verifier_hash)
    WHERE fever_verifier_hash IS NOT NULL;
