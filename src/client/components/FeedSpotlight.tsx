import { rem } from '@mantine/core';
import {
    isActionsGroup,
    Spotlight,
    type SpotlightActionData,
    type SpotlightFilterFunction,
} from '@mantine/spotlight';
import { IconSearch } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { memo, useMemo } from 'react';
import { useNavigate } from 'react-router';

import type { ReaderSubscriptionList } from '../api/reader';
import { subscriptionListQueryOptions } from '../queries/reader';
import { FeedFavicon } from './reader/FeedFavicon';

// Typing re-renders every listed action, so the list stops at this many.
export const FEED_SPOTLIGHT_LIMIT = 50;

interface SpotlightFeed {
    readonly feedId: number;
    readonly label: string;
    readonly description: string | undefined;
    readonly faviconUrl: string | null;
    readonly faviconIsDark: boolean | null;
}

// Only the displayed fields: an unread count change after reading an entry
// leaves this selection equal, so the spotlight does not re-render.
export function selectSpotlightFeeds(
    data: ReaderSubscriptionList,
): readonly SpotlightFeed[] {
    return data.subscriptions.map((subscription) => ({
        feedId: subscription.feedId,
        label: subscription.customFeedName ?? subscription.feedName,
        description:
            subscription.customFeedName === null
                ? undefined
                : subscription.feedName,
        faviconUrl: subscription.faviconUrl,
        faviconIsDark: subscription.faviconIsDark,
    }));
}

export function selectHasFeeds(data: ReaderSubscriptionList): boolean {
    return data.subscriptions.length > 0;
}

/**
 * Same ranking as Mantine's default filter (label matches, then description
 * matches) in one pass. The default flattens the actions with a spread per
 * item, which is quadratic in the number of feeds on every keystroke.
 */
export const filterFeedActions: SpotlightFilterFunction = (query, actions) => {
    const needle = query.trim().toLowerCase();
    if (needle === '') return actions;
    const labelMatches: SpotlightActionData[] = [];
    const descriptionMatches: SpotlightActionData[] = [];
    for (const action of actions) {
        if (isActionsGroup(action)) continue;
        if (action.label?.toLowerCase().includes(needle)) {
            labelMatches.push(action);
        } else if (action.description?.toLowerCase().includes(needle)) {
            descriptionMatches.push(action);
        }
    }
    return labelMatches.concat(descriptionMatches);
};

const searchProps = {
    leftSection: (
        <IconSearch style={{ width: rem(20), height: rem(20) }} stroke={1.5} />
    ),
    placeholder: 'Find a feed',
};

export const FeedSpotlight = memo(function FeedSpotlight() {
    const navigate = useNavigate();
    const { data: feeds } = useQuery({
        ...subscriptionListQueryOptions,
        select: selectSpotlightFeeds,
    });
    const actions = useMemo<SpotlightActionData[]>(
        () =>
            (feeds ?? []).map((feed) => ({
                id: `feed-${feed.feedId}`,
                label: feed.label,
                description: feed.description,
                leftSection: (
                    <FeedFavicon
                        isDark={feed.faviconIsDark}
                        size={20}
                        src={feed.faviconUrl}
                    />
                ),
                onClick: () =>
                    void navigate(
                        `/feeds?feed=${feed.feedId}&filter=all&order_by=published_at`,
                    ),
            })),
        [feeds, navigate],
    );

    if (actions.length === 0) return null;

    return (
        <Spotlight
            actions={actions}
            filter={filterFeedActions}
            highlightQuery
            limit={FEED_SPOTLIGHT_LIMIT}
            maxHeight="calc(100vh * 0.6)"
            nothingFound="No feeds found"
            scrollable
            searchProps={searchProps}
            shortcut="mod + K"
        />
    );
});
