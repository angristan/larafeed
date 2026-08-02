export function buildAddFeedBookmarklet(origin: string): string {
    const parsedOrigin = new URL(origin);
    if (
        (parsedOrigin.protocol !== 'https:' &&
            parsedOrigin.protocol !== 'http:') ||
        parsedOrigin.origin !== origin
    ) {
        throw new TypeError('Bookmarklet origin must be an HTTP origin.');
    }
    const destination = new URL('/feeds?addFeedUrl=', parsedOrigin).href;
    return `javascript:location.href=${JSON.stringify(destination)}+encodeURIComponent(location.href)`;
}
