import viewHtml from 'virtual:larafeed-mcp-view';
import { registerAppResource } from '@modelcontextprotocol/ext-apps/server';
import type { McpServer } from '@modelcontextprotocol/server';
import type { ReaderEntry } from '@shared/schemas/reader';

import { type ShowEntry, VIEW_URI } from '../../mcp-app/contract';

/*
 * The MCP App: an interactive entry card that hosts with MCP Apps support
 * (Claude, ChatGPT, VS Code) render inline for `show_entries`. Other hosts
 * ignore the resource and show the tool's text.
 */

const MIME_TYPE = 'text/html;profile=mcp-app';

/** Registers the view HTML. Favicons load from Larafeed's public path. */
export const registerEntriesView = (
    server: McpServer,
    publicOrigin: string,
): void => {
    registerAppResource(
        server,
        'Larafeed entries',
        VIEW_URI,
        { description: 'Interactive list of feed entries.' },
        () => ({
            contents: [
                {
                    uri: VIEW_URI,
                    mimeType: MIME_TYPE,
                    text: viewHtml,
                    _meta: {
                        ui: {
                            // The view makes no requests of its own; it only
                            // loads favicon images from Larafeed.
                            csp: { resourceDomains: [publicOrigin] },
                            prefersBorder: false,
                        },
                    },
                },
            ],
        }),
    );
};

// Only content-addressed favicon assets are public; the image proxy path
// needs a browser session the iframe does not have.
const PUBLIC_FAVICON_PATH = /^\/api\/public\/favicons\/[\w./-]+$/u;

export const toShowEntry = (
    entry: ReaderEntry,
    excerpt: string,
    publicOrigin: string,
): ShowEntry => ({
    id: entry.id,
    title: entry.title,
    url: entry.url,
    feed: entry.customFeedName ?? entry.feedName,
    feedId: entry.feedId,
    faviconUrl:
        entry.faviconUrl !== null && PUBLIC_FAVICON_PATH.test(entry.faviconUrl)
            ? `${publicOrigin}${entry.faviconUrl}`
            : null,
    faviconIsDark: entry.faviconIsDark === true,
    publishedAt: entry.publishedAt,
    read: entry.read,
    starred: entry.starred,
    excerpt,
});
