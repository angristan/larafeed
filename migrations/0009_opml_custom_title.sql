-- Preserve Larafeed's legacy customTitle attribute while an OPML item is
-- processed asynchronously. Existing items imported before this migration
-- have no custom title.
ALTER TABLE opml_import_items ADD COLUMN custom_title TEXT
    CHECK (custom_title IS NULL OR length(custom_title) <= 255);
