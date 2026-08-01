import {
    mutationOptions,
    type QueryClient,
    useMutation,
    useQueryClient,
} from '@tanstack/react-query';
import { Effect } from 'effect';

import { readCsrfToken } from '../api/auth';
import {
    markFeedReadThrough,
    ReaderClientError,
    setEntryArchived,
    setEntryRead,
    setEntryStarred,
} from '../api/reader';
import {
    entryKeys,
    invalidateReaderAfterInteraction,
    invalidateReaderAfterReadThrough,
    reconcileReaderInteraction,
    subscriptionKeys,
} from './reader';

function requireCsrfToken(): string {
    const csrfToken = readCsrfToken();
    if (csrfToken === undefined) {
        throw new ReaderClientError(
            'status',
            'Your session security token is missing. Sign in again.',
            401,
            'unauthenticated',
        );
    }

    return csrfToken;
}

export function entryReadMutationOptions(
    queryClient: QueryClient,
    entryId: number,
) {
    return mutationOptions({
        mutationKey: entryKeys.interaction(entryId, 'read'),
        scope: { id: `reader-entry-${entryId}` },
        retry: false,
        mutationFn: (read: boolean) =>
            Effect.runPromise(
                setEntryRead({
                    entryId,
                    read,
                    csrfToken: requireCsrfToken(),
                }),
            ),
        onSuccess: async (interaction) => {
            reconcileReaderInteraction(queryClient, interaction);
            await invalidateReaderAfterInteraction(queryClient);
        },
    });
}

export function entryStarMutationOptions(
    queryClient: QueryClient,
    entryId: number,
) {
    return mutationOptions({
        mutationKey: entryKeys.interaction(entryId, 'star'),
        scope: { id: `reader-entry-${entryId}` },
        retry: false,
        mutationFn: (starred: boolean) =>
            Effect.runPromise(
                setEntryStarred({
                    entryId,
                    starred,
                    csrfToken: requireCsrfToken(),
                }),
            ),
        onSuccess: async (interaction) => {
            reconcileReaderInteraction(queryClient, interaction);
            await invalidateReaderAfterInteraction(queryClient);
        },
    });
}

export function entryArchiveMutationOptions(
    queryClient: QueryClient,
    entryId: number,
) {
    return mutationOptions({
        mutationKey: entryKeys.interaction(entryId, 'archive'),
        scope: { id: `reader-entry-${entryId}` },
        retry: false,
        mutationFn: (archived: boolean) =>
            Effect.runPromise(
                setEntryArchived({
                    entryId,
                    archived,
                    csrfToken: requireCsrfToken(),
                }),
            ),
        onSuccess: async (interaction) => {
            reconcileReaderInteraction(queryClient, interaction);
            await invalidateReaderAfterInteraction(queryClient);
        },
    });
}

export function readThroughMutationOptions(
    queryClient: QueryClient,
    feedId: number,
) {
    return mutationOptions({
        mutationKey: [...subscriptionKeys.all, feedId, 'read-through'],
        scope: { id: `reader-feed-${feedId}` },
        retry: false,
        mutationFn: () =>
            Effect.runPromise(
                markFeedReadThrough({
                    feedId,
                    csrfToken: requireCsrfToken(),
                }),
            ),
        onSuccess: async () => {
            await invalidateReaderAfterReadThrough(queryClient);
        },
    });
}

export function useEntryInteractionMutations(entryId: number) {
    const queryClient = useQueryClient();

    return {
        read: useMutation(entryReadMutationOptions(queryClient, entryId)),
        star: useMutation(entryStarMutationOptions(queryClient, entryId)),
        archive: useMutation(entryArchiveMutationOptions(queryClient, entryId)),
    };
}

export function useReadThroughMutation(feedId: number) {
    const queryClient = useQueryClient();
    return useMutation(readThroughMutationOptions(queryClient, feedId));
}
