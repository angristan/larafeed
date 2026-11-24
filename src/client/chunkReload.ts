const RELOAD_KEY = 'larafeed-chunk-reload-at';
const MIN_INTERVAL_MS = 10_000;

type ReloadTarget = Pick<Window, 'addEventListener' | 'location'>;
type ReloadStorage = Pick<Storage, 'getItem' | 'setItem'>;

/**
 * Reload the page once when a lazily imported chunk fails to load, which
 * happens when a deploy replaces the hashed asset files while a tab is open.
 *
 * A second failure inside the interval is left to the route error page: the
 * handler only prevents Vite's default rejection when it reloads, so the
 * router still sees the failure and can report it instead of a reload loop.
 */
export function installChunkReload(
    target: ReloadTarget = window,
    storage: ReloadStorage = sessionStorage,
    now: () => number = Date.now,
): void {
    target.addEventListener('vite:preloadError', (event) => {
        const timestamp = now();
        const lastReloadAt = storage.getItem(RELOAD_KEY);

        if (
            lastReloadAt !== null &&
            timestamp - Number(lastReloadAt) < MIN_INTERVAL_MS
        ) {
            return;
        }

        event.preventDefault();
        storage.setItem(RELOAD_KEY, String(timestamp));
        target.location.reload();
    });
}
