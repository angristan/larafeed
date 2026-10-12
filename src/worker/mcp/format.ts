/*
 * Compact text for tool results. Models read the text; repeating JSON keys on
 * every entry roughly doubles the tokens of a page. Clients that want typed
 * data get the full JSON as `structuredContent`.
 *
 *   7912 entries · next cursor 1791582000000:8710
 *   8710 · 2026-10-12 14:03 · Phoronix · Linus uses Claude Code [starred]
 *     Linus drafted an assoc-array rewrite and…
 */

/** `2026-10-12 14:03`, in UTC. */
export const shortDate = (timestamp: number | null): string =>
    timestamp === null
        ? 'never'
        : new Date(timestamp).toISOString().slice(0, 16).replace('T', ' ');

const flags = (entry: {
    readonly read: boolean;
    readonly starred: boolean;
    readonly archived?: boolean;
}): string => {
    const set = [
        ...(entry.read ? ['read'] : []),
        ...(entry.starred ? ['starred'] : []),
        ...(entry.archived ? ['archived'] : []),
    ];
    return set.length === 0 ? '' : ` [${set.join(', ')}]`;
};

/** One line per entry, plus an indented excerpt or snippet when present. */
export const entryLine = (
    entry: {
        readonly id: number;
        readonly publishedAt: number;
        readonly feed: string;
        readonly title: string;
        readonly read: boolean;
        readonly starred: boolean;
        readonly archived?: boolean;
    },
    detail?: string,
): string => {
    const line = `${entry.id} · ${shortDate(entry.publishedAt)} · ${entry.feed} · ${entry.title || '(untitled)'}${flags(entry)}`;
    const text = detail?.replace(/\s+/gu, ' ').trim() ?? '';
    return text.length > 0 ? `${line}\n  ${text}` : line;
};

export const lines = (...parts: readonly (string | false | null)[]): string =>
    parts.filter((part): part is string => typeof part === 'string').join('\n');
