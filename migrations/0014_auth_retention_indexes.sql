-- Keep terminal authentication records bounded without scanning live rows.

CREATE INDEX sessions_retention_revoked
    ON sessions(revoked_at, id) WHERE revoked_at IS NOT NULL;

CREATE INDEX webauthn_challenges_retention_consumed
    ON webauthn_challenges(consumed_at, id) WHERE consumed_at IS NOT NULL;

CREATE INDEX webauthn_challenges_access_link
    ON webauthn_challenges(access_link_id, id)
    WHERE access_link_id IS NOT NULL;

CREATE INDEX user_access_links_retention_consumed
    ON user_access_links(consumed_at, id) WHERE consumed_at IS NOT NULL;

CREATE INDEX user_access_links_retention_revoked
    ON user_access_links(revoked_at, id) WHERE revoked_at IS NOT NULL;

CREATE INDEX security_events_retention
    ON security_events(created_at, id);
