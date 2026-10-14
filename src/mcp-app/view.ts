import {
    App,
    applyDocumentTheme,
    applyHostStyleVariables,
} from '@modelcontextprotocol/ext-apps';

import {
    SHOW_ENTRIES_TOOL,
    type ShowEntriesData,
    type ShowEntry,
    UPDATE_ENTRIES_TOOL,
} from './contract';

/*
 * The Larafeed entry card, rendered by MCP hosts in a sandboxed iframe.
 *
 * It shows the `show_entries` result and acts through the host: star and
 * read toggles call `update_entries`, "Load more" calls `show_entries` with
 * the next cursor, and "Summarize" sends a chat message. Feed text is only
 * ever set with textContent, never parsed as HTML.
 */

const app = new App({ name: 'Larafeed', version: '1.0.0' });

// The Worker types in this project redeclare `Element.append` for
// HTMLRewriter, hiding the DOM version, so add children through Node.
const add = (parent: Node, ...children: Node[]): void => {
    for (const child of children) parent.appendChild(child);
};

const $ = <T extends HTMLElement>(id: string): T =>
    document.getElementById(id) as T;
const list = $<HTMLUListElement>('entries');
const count = $<HTMLSpanElement>('count');
const summarize = $<HTMLButtonElement>('summarize');
const more = $<HTMLButtonElement>('more');
const empty = $<HTMLDivElement>('empty');
const notice = $<HTMLDivElement>('notice');

let data: ShowEntriesData | null = null;
const entries: ShowEntry[] = [];
const selected = new Set<number>();

const ICONS = {
    star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/></svg>',
    starOn: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.7 2.7L16 9.8"/></svg>',
} as const;

const locale = (): string | undefined => app.getHostContext()?.locale;

const relativeDate = (timestamp: number): string => {
    const minutes = Math.round((timestamp - Date.now()) / 60_000);
    const format = new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' });
    if (Math.abs(minutes) < 60) return format.format(minutes, 'minute');
    const hours = Math.round(minutes / 60);
    if (Math.abs(hours) < 24) return format.format(hours, 'hour');
    const days = Math.round(hours / 24);
    if (Math.abs(days) < 7) return format.format(days, 'day');
    return new Date(timestamp).toLocaleDateString(locale(), {
        day: 'numeric',
        month: 'short',
    });
};

/** A stable color per feed for letter avatars. */
const feedColor = (name: string): string => {
    let hash = 0;
    for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    return `hsl(${hash % 360} 45% 45%)`;
};

const showNotice = (message: string): void => {
    notice.textContent = message;
};

const toolError = (result: {
    readonly isError?: boolean;
    readonly content?: readonly {
        readonly type: string;
        readonly text?: string;
    }[];
}): string | null => {
    if (result.isError !== true) return null;
    const text = result.content?.find((block) => block.type === 'text')?.text;
    return text ?? 'Larafeed could not do that.';
};

const iconFor = (entry: ShowEntry): HTMLElement => {
    const icon = document.createElement('span');
    icon.className = 'icon';
    if (entry.faviconUrl !== null) {
        const image = document.createElement('img');
        image.src = entry.faviconUrl;
        image.alt = '';
        if (entry.faviconIsDark) image.className = 'dark';
        // Fall back to the letter if the image is blocked or missing.
        image.addEventListener('error', () => {
            image.remove();
            icon.style.background = feedColor(entry.feed);
            icon.textContent = entry.feed.slice(0, 1).toUpperCase();
        });
        add(icon, image);
    } else {
        icon.style.background = feedColor(entry.feed);
        icon.textContent = entry.feed.slice(0, 1).toUpperCase();
    }
    return icon;
};

const actionButton = (
    label: string,
    className: string,
    svg: string,
    onClick: () => void,
): HTMLButtonElement => {
    const button = document.createElement('button');
    button.className = className;
    button.title = label;
    button.setAttribute('aria-label', label);
    button.innerHTML = svg; // Static, trusted markup.
    button.addEventListener('click', onClick);
    return button;
};

/** Applies a change optimistically and reverts it if Larafeed refuses. */
const update = async (
    entry: ShowEntry,
    change: { readonly read?: boolean; readonly starred?: boolean },
): Promise<void> => {
    const index = entries.findIndex((candidate) => candidate.id === entry.id);
    if (index === -1) return;
    const previous = entries[index] as ShowEntry;
    entries[index] = { ...previous, ...change };
    render();
    try {
        const result = await app.callServerTool({
            name: UPDATE_ENTRIES_TOOL,
            arguments: { entryIds: [entry.id], ...change },
        });
        const error = toolError(result);
        if (error !== null) throw new Error(error);
        showNotice('');
    } catch (error) {
        entries[index] = previous;
        render();
        showNotice(
            error instanceof Error && error.message.length > 0
                ? error.message
                : 'Larafeed could not save that change.',
        );
    }
};

const open = (entry: ShowEntry): void => {
    if (entry.url === null || !/^https?:\/\//iu.test(entry.url)) return;
    void app.openLink({ url: entry.url });
    // Opening an article reads it, as in the Larafeed web app.
    if (!entry.read) void update(entry, { read: true });
};

const row = (entry: ShowEntry): HTMLLIElement => {
    const item = document.createElement('li');
    if (entry.read) item.className = 'read';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = selected.has(entry.id);
    checkbox.setAttribute('aria-label', `Select ${entry.title}`);
    checkbox.addEventListener('change', () => {
        if (checkbox.checked) selected.add(entry.id);
        else selected.delete(entry.id);
        renderHeader();
    });

    const body = document.createElement('div');
    body.className = 'body';
    const title = document.createElement('button');
    title.className = 'title';
    title.textContent = entry.title || '(untitled)';
    title.addEventListener('click', () => open(entry));
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = `${entry.feed} · ${relativeDate(entry.publishedAt)}`;
    add(body, title, meta);
    if (entry.excerpt.length > 0) {
        const excerpt = document.createElement('div');
        excerpt.className = 'excerpt';
        excerpt.textContent = entry.excerpt;
        add(body, excerpt);
    }

    const actions = document.createElement('div');
    actions.className = 'actions';
    add(
        actions,
        actionButton(
            entry.starred ? 'Unstar' : 'Star',
            `star${entry.starred ? ' on' : ''}`,
            entry.starred ? ICONS.starOn : ICONS.star,
            () => void update(entry, { starred: !entry.starred }),
        ),
        actionButton(
            entry.read ? 'Mark unread' : 'Mark read',
            `done${entry.read ? ' on' : ''}`,
            ICONS.check,
            () => void update(entry, { read: !entry.read }),
        ),
    );

    add(item, checkbox, iconFor(entry), body, actions);
    return item;
};

const renderHeader = (): void => {
    const unread = entries.filter((entry) => !entry.read).length;
    count.textContent =
        data === null
            ? ''
            : `${entries.length} of ${data.total} · ${unread} unread`;
    summarize.hidden = selected.size === 0;
    summarize.textContent = `Summarize ${selected.size}`;
};

function render(): void {
    list.replaceChildren(...entries.map(row));
    empty.hidden = data === null || entries.length > 0;
    more.hidden = data?.nextCursor == null;
    renderHeader();
}

const isShowEntriesData = (value: unknown): value is ShowEntriesData =>
    typeof value === 'object' &&
    value !== null &&
    Array.isArray(Reflect.get(value, 'entries'));

app.ontoolresult = (result) => {
    const error = toolError(result);
    if (error !== null) {
        showNotice(error);
        return;
    }
    if (!isShowEntriesData(result.structuredContent)) return;
    data = result.structuredContent;
    entries.splice(0, entries.length, ...data.entries);
    selected.clear();
    showNotice('');
    render();
};

more.addEventListener('click', async () => {
    if (data?.nextCursor == null) return;
    more.disabled = true;
    try {
        const result = await app.callServerTool({
            name: SHOW_ENTRIES_TOOL,
            arguments: { ...data.request, cursor: data.nextCursor },
        });
        const error = toolError(result);
        if (error !== null) throw new Error(error);
        if (isShowEntriesData(result.structuredContent)) {
            const page: ShowEntriesData = result.structuredContent;
            const known = new Set(entries.map((entry) => entry.id));
            entries.push(
                ...page.entries.filter((entry) => !known.has(entry.id)),
            );
            // Keep the original request; take the new cursor and total.
            data = { ...page, request: data.request };
            showNotice('');
            render();
        }
    } catch (error) {
        showNotice(
            error instanceof Error ? error.message : 'Could not load more.',
        );
    } finally {
        more.disabled = false;
    }
});

summarize.addEventListener('click', () => {
    const ids = entries
        .filter((entry) => selected.has(entry.id))
        .map((entry) => entry.id);
    if (ids.length === 0) return;
    void app.sendMessage({
        role: 'user',
        content: [
            {
                type: 'text',
                text: `Summarize these Larafeed entries: ${ids.join(', ')}`,
            },
        ],
    });
});

const applyHostContext = (): void => {
    const context = app.getHostContext();
    const theme =
        context?.theme ??
        (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    applyDocumentTheme(theme);
    if (context?.styles?.variables !== undefined) {
        applyHostStyleVariables(context.styles.variables);
    }
};

app.onhostcontextchanged = () => {
    applyHostContext();
    render();
};

applyHostContext();
await app.connect();
applyHostContext();
