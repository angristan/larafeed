CREATE TABLE entry_id_sequence (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    next_id INTEGER NOT NULL CHECK (next_id BETWEEN 1 AND 9007199254740991)
) STRICT;

INSERT INTO entry_id_sequence (singleton, next_id)
SELECT 1, COALESCE(MAX(id), 0) + 1 FROM entries;

CREATE TRIGGER entries_advance_id_sequence
AFTER INSERT ON entries
WHEN NEW.id >= (
    SELECT next_id FROM entry_id_sequence WHERE singleton = 1
)
BEGIN
    UPDATE entry_id_sequence
    SET next_id = NEW.id + 1
    WHERE singleton = 1;
END;
