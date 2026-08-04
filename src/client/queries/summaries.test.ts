import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    entrySummaryQueryOptions,
    generateEntrySummaryMutationOptions,
    summaryKeys,
} from './summaries';

const response = {
    summary: {
        id: 41,
        entryId: 31,
        html: '<p>Summary</p>',
        model: 'gemini-2.5-flash',
        promptVersion: 'entry-summary-v1',
        generatedAt: 1_900_000_000_000,
    },
};

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('summary query contracts', () => {
    it('uses a protected per-entry key and disables query retries', () => {
        const options = entrySummaryQueryOptions(31);
        expect(options.queryKey).toEqual([
            'protected',
            'summaries',
            'detail',
            31,
        ]);
        expect(options.queryKey).toEqual(summaryKeys.detail(31));
        expect(options.retry).toBe(false);
    });

    it('does not retry generation and writes its authoritative response', () => {
        const queryClient = new QueryClient();
        const options = generateEntrySummaryMutationOptions(queryClient, 31);
        expect(options.retry).toBe(false);
        expect(options.scope).toEqual({ id: 'entry-summary-31' });

        options.onSuccess?.(response, undefined, undefined, {
            client: queryClient,
            meta: undefined,
            mutationKey: summaryKeys.generate(31),
        });
        expect(queryClient.getQueryData(summaryKeys.detail(31))).toEqual(
            response,
        );
    });
});
