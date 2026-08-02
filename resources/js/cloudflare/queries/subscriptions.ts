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
    listManagedSubscriptions,
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
    staleTime: 15_000,
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
        queryClient.invalidateQueries({ queryKey: entryKeys.finiteLists() }),
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
        onSuccess: async () => invalidateSubscriptionReadModels(queryClient),
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
        onSuccess: async () => invalidateSubscriptionReadModels(queryClient),
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
        onSuccess: async () => invalidateSubscriptionReadModels(queryClient),
    });
}

export interface CreateSubscriptionVariables {
    readonly feedUrl: string;
    readonly categoryId: number;
}

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
        onSuccess: async () => invalidateSubscriptionReadModels(queryClient),
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
        onSuccess: async () => invalidateSubscriptionReadModels(queryClient),
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
        onSuccess: async () => invalidateSubscriptionReadModels(queryClient),
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
        onSuccess: async () => invalidateSubscriptionReadModels(queryClient),
    });
}
