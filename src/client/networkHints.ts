/**
 * `navigator.connection` is Chromium-only and missing from the DOM types, so
 * read it through a narrow shape instead of widening the global Navigator.
 */
interface NetworkInformation {
    saveData?: boolean;
}

function readConnection(): NetworkInformation | undefined {
    if (typeof navigator === 'undefined') {
        return undefined;
    }

    return (navigator as Navigator & { connection?: NetworkInformation })
        .connection;
}

/**
 * Data Saver asks the browser to avoid speculative traffic. Prefetching the
 * next entry would spend the user's data on a request they may never open.
 */
export function shouldPrefetchEntryDetails(): boolean {
    return readConnection()?.saveData !== true;
}
