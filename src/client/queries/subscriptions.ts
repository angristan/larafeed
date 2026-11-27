import {
    mutationOptions,
    type QueryClient,
    queryOptions,
} from '@tanstack/react-query';
import { Effect } from 'effect';

import { readCsrfToken } from '../api/auth';
import {
    createCategory,
    createSubscription,
    deleteCategory,
    dismissMovedFeed,
    listManagedSubscriptions,
    moveSubscription,
    refreshFavicon,
    refreshSubscription,
    SubscriptionClientError,
    type SubscriptionFilterRules,
    unsubscribe,
    updateCategory,
    updateSubscription,
} from '../api/subscriptions';
import { protectedQueryKeys } from './auth';
import {
    categoryKeys,
    entryKeys,
    readerKeys,
    subscriptionKeys,
} from './reader';

export const subscriptionManagementKeys = {
    all: [...protectedQueryKeys.all, 'subscription-management'] as const,
    lists: () => [...subscriptionManagementKeys.all, 'list'] as const,
    list: () => [...subscriptionManagementKeys.lists(), 'current'] as const,
    categories: () =>
        [...subscriptionManagementKeys.all, 'category-mutation'] as const,
    category: (categoryId: number) =>
        [...subscriptionManagementKeys.categories(), categoryId] as const,
    createCategory: () =>
        [...subscriptionManagementKeys.categories(), 'create'] as const,
    subscriptions: () =>
        [...subscriptionManagementKeys.all, 'subscription-mutation'] as const,
    subscription: (feedId: number) =>
        [...subscriptionManagementKeys.subscriptions(), feedId] as const,
    createSubscription: () =>
        [...subscriptionManagementKeys.subscriptions(), 'create'] as const,
    refresh: (feedId: number) =>
        [
            ...subscriptionManagementKeys.subscription(feedId),
            'refresh',
        ] as const,
};

export const subscriptionManagementQueryOptions = queryOptions({
    queryKey: subscriptionManagementKeys.list(),
    queryFn: ({ signal }) =>
        Effect.runPromise(listManagedSubscriptions(), { signal }),
    // The management payload carries every subscription and its refresh
    // history, and the entry pane reads it on every open. Every subscription
    // and category mutation invalidates it, so a longer stale window only delays background changes such as new refresh
    // results.
    staleTime: 60_000,
    // This is the largest payload the reader loads. Refetching it on every
    // tab focus only refreshed the feed failure dots, which can wait for the
    // next page visit or subscription change.
    refetchOnWindowFocus: false,
    retry: false,
});

function requireCsrfToken(): string {
    const csrfToken = readCsrfToken();
    if (csrfToken === undefined) {
        throw new SubscriptionClientError(
            'status',
            'Your session security token is missing. Sign in again.',
            401,
            'unauthenticated',
        );
    }
    return csrfToken;
}

export async function invalidateSubscriptionReadModels(
    queryClient: QueryClient,
): Promise<void> {
    await Promise.all([
        queryClient.invalidateQueries({
            queryKey: subscriptionManagementKeys.lists(),
        }),
        queryClient.invalidateQueries({ queryKey: categoryKeys.lists() }),
        queryClient.invalidateQueries({ queryKey: subscriptionKeys.lists() }),
        queryClient.invalidateQueries({ queryKey: readerKeys.counts() }),
        queryClient.invalidateQueries({ queryKey: entryKeys.lists() }),
    ]);
}

// Refresh requests only queue a job and a moved-feed dismissal only changes
// management fields, so the reader lists and loaded entry pages stay valid.
async function invalidateSubscriptionManagement(
    queryClient: QueryClient,
): Promise<void> {
    await queryClient.invalidateQueries({
        queryKey: subscriptionManagementKeys.lists(),
    });
}

// Only empty categories can be deleted, and no reader list or entry page
// shows category names, so category changes leave those caches valid.
async function invalidateCategoryReadModels(
    queryClient: QueryClient,
): Promise<void> {
    await Promise.all([
        queryClient.invalidateQueries({
            queryKey: subscriptionManagementKeys.lists(),
        }),
        queryClient.invalidateQueries({ queryKey: categoryKeys.lists() }),
    ]);
}

export interface CreateCategoryVariables {
    readonly name: string;
}

export function createCategoryMutationOptions(queryClient: QueryClient) {
    return mutationOptions({
        mutationKey: subscriptionManagementKeys.createCategory(),
        retry: false,
        mutationFn: (input: CreateCategoryVariables) =>
            Effect.runPromise(
                createCategory({
                    name: input.name,
                    csrfToken: requireCsrfToken(),
                }),
            ),
        onSuccess: async () => invalidateCategoryReadModels(queryClient),
    });
}

export interface UpdateCategoryVariables {
    readonly categoryId: number;
    readonly name: string;
}

export function updateCategoryMutationOptions(queryClient: QueryClient) {
    return mutationOptions({
        mutationKey: subscriptionManagementKeys.categories(),
        retry: false,
        mutationFn: (input: UpdateCategoryVariables) =>
            Effect.runPromise(
                updateCategory({
                    ...input,
                    csrfToken: requireCsrfToken(),
                }),
            ),
        onSuccess: async () => invalidateCategoryReadModels(queryClient),
    });
}

export interface DeleteCategoryVariables {
    readonly categoryId: number;
}

export function deleteCategoryMutationOptions(queryClient: QueryClient) {
    return mutationOptions({
        mutationKey: [...subscriptionManagementKeys.categories(), 'delete'],
        retry: false,
        mutationFn: (input: DeleteCategoryVariables) =>
            Effect.runPromise(
                deleteCategory({
                    ...input,
                    csrfToken: requireCsrfToken(),
                }),
            ),
        onSuccess: async () => invalidateCategoryReadModels(queryClient),
    });
}

export type CreateSubscriptionVariables = {
    readonly feedUrl: string;
} & (
    | {
          readonly categoryId: number;
          readonly categoryName?: never;
      }
    | {
          readonly categoryId?: never;
          readonly categoryName: string;
      }
);

export function createSubscriptionMutationOptions(queryClient: QueryClient) {
    return mutationOptions({
        mutationKey: subscriptionManagementKeys.createSubscription(),
        retry: false,
        mutationFn: (input: CreateSubscriptionVariables) =>
            Effect.runPromise(
                createSubscription({
                    ...input,
                    csrfToken: requireCsrfToken(),
                }),
            ),
        onSuccess: async (result) =>
            result.kind === 'created'
                ? invalidateSubscriptionReadModels(queryClient)
                : undefined,
    });
}

export interface UpdateSubscriptionVariables {
    readonly feedId: number;
    readonly categoryId: number;
    readonly customFeedName: string | null;
    readonly filterRules: SubscriptionFilterRules;
}

export function updateSubscriptionMutationOptions(queryClient: QueryClient) {
    return mutationOptions({
        mutationKey: subscriptionManagementKeys.subscriptions(),
        retry: false,
        mutationFn: (input: UpdateSubscriptionVariables) =>
            Effect.runPromise(
                updateSubscription({
                    ...input,
                    csrfToken: requireCsrfToken(),
                }),
            ),
        onSuccess: async () => invalidateSubscriptionReadModels(queryClient),
    });
}

export interface FeedMutationVariables {
    readonly feedId: number;
}

export function unsubscribeMutationOptions(queryClient: QueryClient) {
    return mutationOptions({
        mutationKey: [...subscriptionManagementKeys.subscriptions(), 'delete'],
        retry: false,
        mutationFn: (input: FeedMutationVariables) =>
            Effect.runPromise(
                unsubscribe({
                    ...input,
                    csrfToken: requireCsrfToken(),
                }),
            ),
        onSuccess: async () => {
            queryClient.removeQueries({ queryKey: entryKeys.details() });
            await invalidateSubscriptionReadModels(queryClient);
        },
    });
}

export interface MoveSubscriptionVariables {
    readonly feedId: number;
    readonly feedUrl: string;
}

export function moveSubscriptionMutationOptions(queryClient: QueryClient) {
    return mutationOptions({
        mutationKey: [...subscriptionManagementKeys.subscriptions(), 'move'],
        retry: false,
        mutationFn: (input: MoveSubscriptionVariables) =>
            Effect.runPromise(
                moveSubscription({
                    ...input,
                    csrfToken: requireCsrfToken(),
                }),
            ),
        onSuccess: async (result) => {
            if (result.kind !== 'moved') return;
            // The old feed's entries may be gone.
            queryClient.removeQueries({ queryKey: entryKeys.details() });
            await invalidateSubscriptionReadModels(queryClient);
        },
    });
}

export interface DismissMovedFeedVariables {
    readonly feedId: number;
    readonly movedToUrl: string;
}

export function dismissMovedFeedMutationOptions(queryClient: QueryClient) {
    return mutationOptions({
        mutationKey: [
            ...subscriptionManagementKeys.subscriptions(),
            'dismiss-moved',
        ],
        retry: false,
        mutationFn: (input: DismissMovedFeedVariables) =>
            Effect.runPromise(
                dismissMovedFeed({
                    ...input,
                    csrfToken: requireCsrfToken(),
                }),
            ),
        onSuccess: async () => invalidateSubscriptionManagement(queryClient),
    });
}

export function refreshSubscriptionMutationOptions(queryClient: QueryClient) {
    return mutationOptions({
        mutationKey: [...subscriptionManagementKeys.subscriptions(), 'refresh'],
        retry: false,
        mutationFn: (input: FeedMutationVariables) =>
            Effect.runPromise(
                refreshSubscription({
                    ...input,
                    csrfToken: requireCsrfToken(),
                }),
            ),
        onSuccess: async () => invalidateSubscriptionManagement(queryClient),
    });
}

export function refreshFaviconMutationOptions(queryClient: QueryClient) {
    return mutationOptions({
        mutationKey: [
            ...subscriptionManagementKeys.subscriptions(),
            'refresh-favicon',
        ],
        retry: false,
        mutationFn: (input: FeedMutationVariables) =>
            Effect.runPromise(
                refreshFavicon({
                    ...input,
                    csrfToken: requireCsrfToken(),
                }),
            ),
        onSuccess: async () => invalidateSubscriptionManagement(queryClient),
    });
}
