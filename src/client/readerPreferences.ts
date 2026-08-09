import { useLocalStorage } from '@mantine/hooks';

export const FEED_LIST_DENSITY_STORAGE_KEY = 'larafeed-feed-list-density';

export const feedListDensities = [
    'compact',
    'comfortable',
    'spacious',
] as const;

export type FeedListDensity = (typeof feedListDensities)[number];

export const DEFAULT_FEED_LIST_DENSITY: FeedListDensity = 'comfortable';

export function parseFeedListDensity(
    value: string | undefined,
): FeedListDensity {
    return (
        feedListDensities.find((density) => density === value) ??
        DEFAULT_FEED_LIST_DENSITY
    );
}

export function useFeedListDensity() {
    return useLocalStorage<FeedListDensity>({
        key: FEED_LIST_DENSITY_STORAGE_KEY,
        defaultValue: DEFAULT_FEED_LIST_DENSITY,
        getInitialValueInEffect: false,
        serialize: (value) => value,
        deserialize: parseFeedListDensity,
    });
}
