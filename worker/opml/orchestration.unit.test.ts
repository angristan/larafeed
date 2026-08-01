import { describe, expect, it, vi } from 'vitest';

import { makeOpmlOrchestrator } from './orchestration';
import type { OpmlRepository } from './repository';

const repositoryStub = (overrides: Partial<OpmlRepository>): OpmlRepository =>
    ({
        createImport: vi.fn(),
        listImports: vi.fn(),
        getImport: vi.fn(),
        listExportSubscriptions: vi.fn(),
        leaseOutbox: vi.fn(),
        markDispatched: vi.fn(),
        releaseOutbox: vi.fn(),
        claimJob: vi.fn(),
        completeItem: vi.fn(),
        recordFailure: vi.fn(),
        recordDeadLetter: vi.fn(),
        recoverStaleJobs: vi.fn(),
        recoverActiveImports: vi.fn(),
        ...overrides,
    }) as OpmlRepository;

describe('OPML orchestration', () => {
    it('dispatches only the operation ID wire contract', async () => {
        const send = vi.fn((_message: { readonly operationId: string }) =>
            Promise.resolve(),
        );
        const markDispatched = vi.fn(() => Promise.resolve());
        const repository = repositoryStub({
            leaseOutbox: vi.fn(() =>
                Promise.resolve([
                    {
                        id: 1,
                        jobId: 2,
                        operationId: 'opml-operation',
                        attemptCount: 0,
                        leaseOwner: 'opml-outbox:owner',
                        leaseExpiresAt: 61_000,
                    },
                ]),
            ),
            markDispatched,
        });
        const orchestrator = makeOpmlOrchestrator({
            repository,
            queue: { send },
            now: () => 1_000,
            generateToken: async () => 'owner',
        });

        await expect(orchestrator.dispatchOutbox(1)).resolves.toEqual({
            leased: 1,
            sent: 1,
            released: 0,
            ambiguous: 0,
        });
        expect(send).toHaveBeenCalledWith({ operationId: 'opml-operation' });
        expect(Object.keys(send.mock.calls[0]?.[0] ?? {})).toEqual([
            'operationId',
        ]);
        expect(markDispatched).toHaveBeenCalledOnce();
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
            queue: { send: async () => undefined },
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

    it('escapes exported attributes and preserves deterministic grouping', async () => {
        const repository = repositoryStub({
            listExportSubscriptions: vi.fn(() =>
                Promise.resolve([
                    {
                        category: 'A & B',
                        title: 'Feed "One"',
                        feedUrl: 'https://one.example.test/rss?a=1&b=2',
                        siteUrl: null,
                    },
                ]),
            ),
        });
        const orchestrator = makeOpmlOrchestrator({
            repository,
            queue: { send: async () => undefined },
        });

        const document = await orchestrator.exportOpml(1);
        expect(document).toContain('A &amp; B');
        expect(document).toContain('Feed &quot;One&quot;');
        expect(document).toContain('a=1&amp;b=2');
    });
});
