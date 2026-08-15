import {
    Alert,
    Button,
    Group,
    Radio,
    Stack,
    Text,
    VisuallyHidden,
} from '@mantine/core';
import { type FormEvent, useMemo, useState } from 'react';

import type { FeedDiscoveryCandidate } from '../../api/subscriptions';
import classes from './FeedCandidateSelector.module.css';

const formatList = (values: readonly string[]): string => {
    if (values.length < 2) return values[0] ?? '';
    if (values.length === 2) return `${values[0]} and ${values[1]}`;
    return `${values.slice(0, -1).join(', ')}, and ${values.at(-1)}`;
};

const displayFeedUrl = (feedUrl: string): string => {
    const withoutProtocol = feedUrl.startsWith('https://')
        ? feedUrl.slice('https://'.length)
        : feedUrl;
    return withoutProtocol.startsWith('www.')
        ? withoutProtocol.slice('www.'.length)
        : withoutProtocol;
};

const allMatchingFeedsCopy = (count: number): string =>
    count === 2
        ? 'Both feeds have the same recent posts.'
        : 'All feeds have the same recent posts.';

const findMatchingGroups = (
    candidates: readonly FeedDiscoveryCandidate[],
): readonly (readonly string[])[] => {
    const candidatesByUrl = new Map(
        candidates.map((candidate) => [candidate.feedUrl, candidate]),
    );
    const visited = new Set<string>();
    const groups: string[][] = [];

    for (const candidate of candidates) {
        if (visited.has(candidate.feedUrl)) continue;

        const group: FeedDiscoveryCandidate[] = [];
        const pending = [candidate];
        while (pending.length > 0) {
            const current = pending.pop();
            if (current === undefined || visited.has(current.feedUrl)) continue;

            visited.add(current.feedUrl);
            group.push(current);
            for (const identicalUrl of current.identicalTo) {
                const identicalCandidate = candidatesByUrl.get(identicalUrl);
                if (identicalCandidate !== undefined) {
                    pending.push(identicalCandidate);
                }
            }
        }

        if (group.length > 1) {
            groups.push(group.map((item) => item.title));
        }
    }

    return groups;
};

export function FeedCandidateSelector({
    candidates,
    error,
    isPending,
    onBack,
    onSubmit,
}: {
    readonly candidates: readonly FeedDiscoveryCandidate[];
    readonly error: Error | null;
    readonly isPending: boolean;
    readonly onBack: () => void;
    readonly onSubmit: (feedUrl: string) => void;
}) {
    const [selectedFeedUrl, setSelectedFeedUrl] = useState('');
    const matchingGroups = useMemo(
        () => findMatchingGroups(candidates),
        [candidates],
    );

    const submit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (selectedFeedUrl !== '') onSubmit(selectedFeedUrl);
    };

    return (
        <form onSubmit={submit}>
            <Stack gap="sm">
                <Text c="dimmed" size="sm">
                    Select the feed you want to follow.
                </Text>

                <Radio.Group
                    disabled={isPending}
                    label={<VisuallyHidden>Available feeds</VisuallyHidden>}
                    onChange={setSelectedFeedUrl}
                    value={selectedFeedUrl}
                >
                    <div className={classes.list}>
                        {candidates.map((candidate) => (
                            <Radio.Card
                                className={classes.option}
                                key={candidate.feedUrl}
                                type="button"
                                value={candidate.feedUrl}
                            >
                                <Group
                                    align="flex-start"
                                    gap="sm"
                                    wrap="nowrap"
                                >
                                    <Radio.Indicator mt={2} />
                                    <div className={classes.optionContent}>
                                        <Text fw={650} size="sm">
                                            {candidate.title}
                                        </Text>
                                        <Text
                                            c="dimmed"
                                            className={classes.feedUrl}
                                            size="xs"
                                            title={candidate.feedUrl}
                                        >
                                            {displayFeedUrl(candidate.feedUrl)}
                                        </Text>
                                    </div>
                                </Group>
                            </Radio.Card>
                        ))}
                    </div>
                </Radio.Group>

                {matchingGroups.map((titles) => (
                    <Text
                        c="dimmed"
                        className={classes.matchingNote}
                        key={titles.join('\u0000')}
                        size="xs"
                    >
                        {titles.length === candidates.length ? (
                            allMatchingFeedsCopy(titles.length)
                        ) : (
                            <>
                                <Text component="span" fw={650} inherit>
                                    Same recent posts:
                                </Text>{' '}
                                {formatList(titles)}
                            </>
                        )}
                    </Text>
                ))}

                {error !== null && <Alert color="red">{error.message}</Alert>}

                <Group justify="flex-end" mt="xs">
                    <Button
                        disabled={isPending}
                        onClick={onBack}
                        type="button"
                        variant="subtle"
                    >
                        Back
                    </Button>
                    <Button
                        disabled={selectedFeedUrl === '' || isPending}
                        loading={isPending}
                        type="submit"
                    >
                        Add feed
                    </Button>
                </Group>
            </Stack>
        </form>
    );
}
