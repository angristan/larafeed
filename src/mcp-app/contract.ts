/**
 * Data the `show_entries` tool sends to the MCP App view as
 * `structuredContent`. Shared by the Worker and the view.
 */

export const SHOW_ENTRIES_TOOL = 'show_entries';
export const UPDATE_ENTRIES_TOOL = 'update_entries';
export const VIEW_URI = 'ui://larafeed/entries.html';

/** The arguments that produced a page, so the view can load the next one. */
export interface ShowEntriesRequest {
    readonly filter?: 'all' | 'unread' | 'read' | 'favorites';
    readonly feedId?: number;
    readonly categoryId?: number;
    readonly since?: string;
    readonly until?: string;
    readonly limit?: number;
    readonly entryIds?: readonly number[];
}

export interface ShowEntry {
    readonly id: number;
    readonly title: string;
    readonly url: string | null;
    readonly feed: string;
    readonly feedId: number;
    /** Absolute URL of a public favicon, or null for a letter avatar. */
    readonly faviconUrl: string | null;
    readonly faviconIsDark: boolean;
    /** Epoch milliseconds. */
    readonly publishedAt: number;
    readonly read: boolean;
    readonly starred: boolean;
    readonly excerpt: string;
}

export interface ShowEntriesData {
    readonly total: number;
    readonly nextCursor: string | null;
    readonly request: ShowEntriesRequest;
    readonly entries: readonly ShowEntry[];
}
