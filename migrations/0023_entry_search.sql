-- Full-text search over entry titles, authors, and article text.
--
-- The scheduled indexer fills `entry_search` from application code, because
-- the body is plain text extracted from stored HTML, which SQL cannot do.
-- Row IDs are entry IDs. The table keeps its own copy of the text so that
-- snippet() can show matches; the corpus is small (tens of MB).
CREATE VIRTUAL TABLE entry_search USING fts5(
    title,
    author,
    body,
    tokenize = 'unicode61 remove_diacritics 2'
);

-- When the indexer last indexed this entry, copied from `updated_at`. Feed
-- refreshes bump `updated_at` whenever the title, author, or content
-- changes, so `search_indexed_at < updated_at` means the index is stale.
-- NULL means never indexed, which is every existing and every new entry.
ALTER TABLE entries ADD COLUMN search_indexed_at INTEGER
    CHECK (search_indexed_at IS NULL OR search_indexed_at >= 0);

-- Keeps the indexer's "what is pending" query proportional to the backlog.
CREATE INDEX entries_search_pending ON entries(id)
    WHERE search_indexed_at IS NULL OR search_indexed_at < updated_at;
