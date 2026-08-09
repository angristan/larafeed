import { Divider, SegmentedControl, Stack, Text, Title } from '@mantine/core';

import {
    ApplicationPage,
    ApplicationSettingsContent,
    ApplicationWorkSurface,
} from '../components/ApplicationPage';
import { FeedFavicon } from '../components/reader/FeedFavicon';
import readerClasses from '../components/reader/Reader.module.css';
import { type FeedListDensity, useFeedListDensity } from '../readerPreferences';
import classes from './AppearancePage.module.css';

const densityOptions: Array<{
    readonly label: string;
    readonly value: FeedListDensity;
}> = [
    { label: 'Compact', value: 'compact' },
    { label: 'Comfortable', value: 'comfortable' },
    { label: 'Spacious', value: 'spacious' },
];

const densityDescriptions: Record<FeedListDensity, string> = {
    compact: 'Shows more entries with tighter spacing.',
    comfortable: 'Balances entry detail and list space.',
    spacious: 'Adds more space between entry details.',
};

const previewEntries = [
    {
        title: 'A calmer way to organize daily reading',
        feed: 'Product Notes',
        time: '12 minutes ago',
        read: false,
        active: false,
    },
    {
        title: 'Building a tiny server for the weekend',
        feed: 'Home Lab Weekly',
        time: '2 hours ago',
        read: false,
        active: true,
    },
    {
        title: 'Running through Paris before sunrise',
        feed: 'Field Journal',
        time: 'yesterday',
        read: true,
        active: false,
    },
] as const;

function FeedListPreview({ density }: { readonly density: FeedListDensity }) {
    return (
        <Stack gap={6}>
            <Text fw={600} size="sm">
                Preview
            </Text>
            <div
                aria-hidden="true"
                className={`${readerClasses.entryList} ${classes.preview}`}
                data-density={density}
                data-density-preview={density}
            >
                {previewEntries.map((entry) => (
                    <div
                        className={`${readerClasses.entry} ${classes.previewRow} ${
                            entry.active ? readerClasses.activeEntry : ''
                        } ${entry.read ? readerClasses.readEntry : ''}`}
                        key={entry.title}
                    >
                        <span
                            className={readerClasses.unreadMarker}
                            data-read={entry.read || undefined}
                        />
                        <span className={readerClasses.entryCopy}>
                            <span className={readerClasses.entryTitle}>
                                {entry.title}
                            </span>
                            <span className={readerClasses.entryMeta}>
                                <span className={readerClasses.feedMeta}>
                                    <FeedFavicon
                                        isDark={null}
                                        size={18}
                                        src={null}
                                    />
                                    <span>{entry.feed}</span>
                                </span>
                                <time>{entry.time}</time>
                            </span>
                        </span>
                    </div>
                ))}
            </div>
        </Stack>
    );
}

function FeedListSection() {
    const [density, setDensity] = useFeedListDensity();

    return (
        <Stack component="section" gap="lg" maw={600}>
            <Stack gap={3}>
                <Title order={2}>Feed list</Title>
                <Text c="dimmed" size="sm">
                    Choose how tightly entries are arranged. This setting is
                    saved on this device.
                </Text>
            </Stack>
            <Divider />
            <Stack gap="sm">
                <Text fw={600} size="sm">
                    Density
                </Text>
                <SegmentedControl<FeedListDensity>
                    aria-label="Feed list density"
                    data={densityOptions}
                    fullWidth
                    onChange={setDensity}
                    value={density}
                />
                <Text c="dimmed" size="xs">
                    {densityDescriptions[density]}
                </Text>
            </Stack>
            <FeedListPreview density={density} />
        </Stack>
    );
}

export function AppearancePage() {
    return (
        <ApplicationPage activePage="settings" settingsNavigation>
            <ApplicationSettingsContent
                description="Adjust how Larafeed looks on this device."
                title="Settings"
            >
                <ApplicationWorkSurface>
                    <FeedListSection />
                </ApplicationWorkSurface>
            </ApplicationSettingsContent>
        </ApplicationPage>
    );
}
