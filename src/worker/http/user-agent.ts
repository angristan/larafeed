/**
 * Sent on every outbound fetch: feeds, discovery pages, full articles,
 * images, and favicons. The `Mozilla/5.0 (compatible; …)` form is common
 * among crawlers, so servers that only accept browser-like agents still
 * answer, and the product and its source stay identifiable.
 */
export const LARAFEED_USER_AGENT =
    'Mozilla/5.0 (compatible; Larafeed/1.0; +https://github.com/angristan/larafeed)';
