import { describe, expect, it, vi } from 'vitest';

import { FeedHttpError, FeedParseError } from '../feeds/errors';
import { makeOpmlOrchestrator } from './orchestration';
import { parseOpml } from './parser';
import type { OpmlRepository } from './repository';

const repositoryStub = (overrides: Partial<OpmlRepository>): OpmlRepository =>
    ({
        createImport: vi.fn(),
        listImports: vi.fn(),
        getImport: vi.fn(),
        listExportSubscriptions: vi.fn(),
        leaseOutbox: vi.fn(),
        markDispatchedBatch: vi.fn(),
        releaseOutboxBatch: vi.fn(),
        markDispatched: vi.fn(),
        releaseOutbox: vi.fn(),
        claimJob: vi.fn(),
        completeItem: vi.fn(),
        recordFailure: vi.fn(),
        recoverStaleJobs: vi.fn(),
        recoverActiveImports: vi.fn(),
        ...overrides,
    }) as OpmlRepository;

describe('OPML orchestration', () => {
    it('dispatches only operation IDs for one import in bounded batches', async () => {
        const leased = Array.from({ length: 105 }, (_, index) => ({
            id: index + 1,
            jobId: index + 1_000,
            operationId: `opml-operation-${index}`,
            attemptCount: 0,
            leaseOwner: 'opml-outbox:owner',
            leaseExpiresAt: 61_000,
        }));
        const sendBatch = vi.fn(
            (_messages: readonly { readonly operationId: string }[]) =>
                Promise.resolve(),
        );
        const markDispatchedBatch = vi.fn(() => Promise.resolve());
        const leaseOutbox = vi.fn(() => Promise.resolve(leased));
        const repository = repositoryStub({
            leaseOutbox,
            markDispatchedBatch,
        });
        const orchestrator = makeOpmlOrchestrator({
            repository,
            queue: { sendBatch },
            now: () => 1_000,
            generateToken: async () => 'owner',
        });

        await expect(orchestrator.dispatchOutbox(105, 42)).resolves.toEqual({
            leased: 105,
            sent: 105,
            released: 0,
            ambiguous: 0,
        });
        expect(leaseOutbox).toHaveBeenCalledWith(
            expect.objectContaining({ limit: 105, importId: 42 }),
        );
        expect(
            sendBatch.mock.calls.map(([messages]) => messages.length),
        ).toEqual([50, 50, 5]);
        expect(sendBatch.mock.calls.flatMap(([messages]) => messages)).toEqual(
            leased.map((message) => ({
                operationId: message.operationId,
            })),
        );
        expect(Object.keys(sendBatch.mock.calls[0]?.[0]?.[0] ?? {})).toEqual([
            'operationId',
        ]);
        expect(markDispatchedBatch).toHaveBeenCalledTimes(3);
    });

    it('terminally fails a private normalized feed URL', async () => {
        const recordFailure = vi.fn(() =>
            Promise.resolve({ terminal: true, availableAt: null }),
        );
        const repository = repositoryStub({
            claimJob: vi.fn(() =>
                Promise.resolve({
                    type: 'claimed' as const,
                    claim: {
                        itemId: 1,
                        importId: 2,
                        userId: 3,
                        jobId: 4,
                        operationId: 'private-url',
                        title: null,
                        customTitle: null,
                        feedUrl: 'http://127.0.0.1/rss',
                        normalizedFeedUrl: 'http://127.0.0.1/rss',
                        siteUrl: null,
                        categoryPath: [],
                        attemptCount: 1,
                        maxAttempts: 5,
                        leaseOwner: 'consumer',
                        leaseExpiresAt: 6_000,
                    },
                }),
            ),
            recordFailure,
        });
        const orchestrator = makeOpmlOrchestrator({
            repository,
            queue: { sendBatch: async () => undefined },
            now: () => 1_000,
        });

        await expect(
            orchestrator.processQueueMessage(
                { operationId: 'private-url' },
                'consumer',
            ),
        ).resolves.toEqual({ action: 'dead', reason: 'terminal_failure' });
        expect(recordFailure).toHaveBeenCalledWith(
            expect.objectContaining({
                retryable: false,
                errorClass: 'FeedPolicyError',
                errorMessage: 'forbidden_ip_address',
            }),
        );
    });

    it('persists initial discovery without creating refresh work', async () => {
        const completeItem = vi.fn(() =>
            Promise.resolve({ state: 'succeeded' as const }),
        );
        const repository = repositoryStub({
            claimJob: vi.fn(() =>
                Promise.resolve({
                    type: 'claimed' as const,
                    claim: {
                        itemId: 1,
                        importId: 2,
                        userId: 3,
                        jobId: 4,
                        operationId: 'verified-feed',
                        title: 'Fallback title',
                        customTitle: 'Custom title',
                        feedUrl: 'https://site.example.test/',
                        normalizedFeedUrl: 'https://site.example.test/',
                        siteUrl: null,
                        categoryPath: ['Tech'],
                        attemptCount: 1,
                        maxAttempts: 5,
                        leaseOwner: 'consumer',
                        leaseExpiresAt: 6_000,
                    },
                }),
            ),
            completeItem,
        });
        const generatedIds = [10, 11];
        const orchestrator = makeOpmlOrchestrator({
            repository,
            queue: { sendBatch: async () => undefined },
            now: () => 1_000,
            generateId: async () => generatedIds.shift() ?? Number.NaN,
            discoverFeed: async () => ({
                kind: 'updated',
                finalUrl: 'https://site.example.test/feed.xml',
                etag: null,
                lastModified: null,
                httpStatus: 200,
                feed: {
                    title: 'Discovered feed',
                    description: null,
                    siteUrl: 'https://site.example.test/',
                    faviconUrl: 'https://site.example.test/favicon.ico',
                    sourceUpdatedAt: null,
                },
                entries: [],
            }),
        });

        await expect(
            orchestrator.processQueueMessage(
                { operationId: 'verified-feed' },
                'consumer',
            ),
        ).resolves.toEqual({ action: 'ack', reason: 'succeeded' });
        expect(completeItem).toHaveBeenCalledWith(
            expect.objectContaining({
                categoryId: 10,
                historyId: 11,
                feedUrl: 'https://site.example.test/feed.xml',
                feedName: 'Discovered feed',
                categoryName: 'Tech',
                siteUrl: 'https://site.example.test/',
                faviconUrl: 'https://site.example.test/favicon.ico',
                entries: [],
                nextRefreshAt: 901_000,
            }),
        );
    });

    it('recovers an unavailable xmlUrl through its distinct htmlUrl', async () => {
        const completeItem = vi.fn(() =>
            Promise.resolve({ state: 'succeeded' as const }),
        );
        const discoverFeed = vi
            .fn()
            .mockRejectedValueOnce(
                new FeedHttpError({
                    status: 404,
                    retryable: false,
                }),
            )
            .mockResolvedValueOnce({
                kind: 'updated' as const,
                finalUrl: 'https://site.example.test/index.xml',
                etag: null,
                lastModified: null,
                httpStatus: 200,
                feed: {
                    title: 'Recovered feed',
                    description: null,
                    siteUrl: 'https://site.example.test/',
                    faviconUrl: null,
                    sourceUpdatedAt: null,
                },
                entries: [],
            });
        const repository = repositoryStub({
            claimJob: vi.fn(() =>
                Promise.resolve({
                    type: 'claimed' as const,
                    claim: {
                        itemId: 1,
                        importId: 2,
                        userId: 3,
                        jobId: 4,
                        operationId: 'stale-feed-url',
                        title: null,
                        customTitle: null,
                        feedUrl: 'https://feed.example.test/old.xml',
                        normalizedFeedUrl: 'https://feed.example.test/old.xml',
                        siteUrl: 'https://site.example.test/',
                        categoryPath: [],
                        attemptCount: 1,
                        maxAttempts: 5,
                        leaseOwner: 'consumer',
                        leaseExpiresAt: 6_000,
                    },
                }),
            ),
            completeItem,
        });
        const ids = [20, 21];
        const orchestrator = makeOpmlOrchestrator({
            repository,
            queue: { sendBatch: async () => undefined },
            now: () => 1_000,
            generateId: async () => ids.shift() ?? Number.NaN,
            discoverFeed,
        });

        await expect(
            orchestrator.processQueueMessage(
                { operationId: 'stale-feed-url' },
                'consumer',
            ),
        ).resolves.toEqual({ action: 'ack', reason: 'succeeded' });
        expect(discoverFeed.mock.calls.map(([url]) => url)).toEqual([
            'https://feed.example.test/old.xml',
            'https://site.example.test/',
        ]);
        expect(completeItem).toHaveBeenCalledWith(
            expect.objectContaining({
                feedUrl: 'https://site.example.test/index.xml',
                siteUrl: 'https://site.example.test/',
            }),
        );
    });

    it('does not mark an unparseable OPML URL as added', async () => {
        const completeItem = vi.fn();
        const recordFailure = vi.fn(() =>
            Promise.resolve({ terminal: true, availableAt: null }),
        );
        const repository = repositoryStub({
            claimJob: vi.fn(() =>
                Promise.resolve({
                    type: 'claimed' as const,
                    claim: {
                        itemId: 1,
                        importId: 2,
                        userId: 3,
                        jobId: 4,
                        operationId: 'invalid-feed',
                        title: null,
                        customTitle: null,
                        feedUrl: 'https://site.example.test/page',
                        normalizedFeedUrl: 'https://site.example.test/page',
                        siteUrl: 'https://fallback.example.test/',
                        categoryPath: [],
                        attemptCount: 1,
                        maxAttempts: 5,
                        leaseOwner: 'consumer',
                        leaseExpiresAt: 6_000,
                    },
                }),
            ),
            completeItem,
            recordFailure,
        });
        const discoverFeed = vi.fn(() =>
            Promise.reject(new FeedParseError({ reason: 'unsupported_feed' })),
        );
        const orchestrator = makeOpmlOrchestrator({
            repository,
            queue: { sendBatch: async () => undefined },
            now: () => 1_000,
            discoverFeed,
        });

        await expect(
            orchestrator.processQueueMessage(
                { operationId: 'invalid-feed' },
                'consumer',
            ),
        ).resolves.toEqual({ action: 'dead', reason: 'terminal_failure' });
        expect(completeItem).not.toHaveBeenCalled();
        expect(discoverFeed).toHaveBeenCalledTimes(1);
        expect(recordFailure).toHaveBeenCalledWith(
            expect.objectContaining({
                retryable: false,
                errorClass: 'FeedParseError',
                errorMessage: 'unsupported_feed',
            }),
        );
    });

    it('exports canonical and escaped custom titles compatibly', async () => {
        const repository = repositoryStub({
            listExportSubscriptions: vi.fn(() =>
                Promise.resolve([
                    {
                        category: 'A & B',
                        canonicalTitle: 'Feed "One"',
                        customTitle: 'My <Feed>',
                        feedUrl: 'https://one.example.test/rss?a=1&b=2',
                        siteUrl: null,
                    },
                    {
                        category: 'A & B',
                        canonicalTitle: 'Feed Two',
                        customTitle: null,
                        feedUrl: 'https://two.example.test/rss',
                        siteUrl: null,
                    },
                ]),
            ),
        });
        const orchestrator = makeOpmlOrchestrator({
            repository,
            queue: { sendBatch: async () => undefined },
        });

        const document = await orchestrator.exportOpml(1);
        expect(document).toContain('A &amp; B');
        expect(document).toContain(
            'text="My &lt;Feed&gt;" title="My &lt;Feed&gt;" customTitle="My &lt;Feed&gt;"',
        );
        expect(document).toContain('a=1&amp;b=2');
        expect(document).toContain('text="Feed Two" title="Feed Two" xmlUrl=');
        expect(document).not.toContain('customTitle="Feed Two"');
        expect(parseOpml(document)).toEqual([
            expect.objectContaining({
                title: 'My <Feed>',
                customTitle: 'My <Feed>',
                feedUrl: 'https://one.example.test/rss?a=1&b=2',
            }),
            expect.objectContaining({
                title: 'Feed Two',
                customTitle: null,
                feedUrl: 'https://two.example.test/rss',
            }),
        ]);
    });
});
