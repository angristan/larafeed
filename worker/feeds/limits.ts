export const MAX_FEED_RESPONSE_BYTES = 10 * 1024 * 1024;

// DTDs and custom entities are rejected before XML parsing. The shortest
// supported built-in or numeric reference is four bytes, so a bounded feed
// cannot contain more entity expansions than one quarter of its byte size.
export const MAX_XML_ENTITY_EXPANSIONS = Math.floor(
    MAX_FEED_RESPONSE_BYTES / 4,
);
