import classes from './Import.module.css';

import UserButton from '../Components/UserButton/UserButton';
import ApplicationLogo from '@/Components/ApplicationLogo/ApplicationLogo';
import AuthenticatedLayout from '@/Layouts/AuthenticatedLayout';
import { PageProps, User } from '@/types';
import { usePage } from '@inertiajs/react';
import { Heatmap } from '@mantine/charts';
import {
    AppShell,
    Burger,
    Code,
    Group,
    Stack,
    TextInput,
    Title,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconSearch } from '@tabler/icons-react';
import { ReactNode } from 'react';

const Main = function Main({ dailyReads }: { dailyReads: DailyReads[] }) {
    // Transform data for heatmap - create an object with date keys and read counts as values
    const transformDataForHeatmap = (
        data: DailyReads[],
    ): Record<string, number> => {
        const result: Record<string, number> = {};

        data.forEach((item) => {
            result[item.date] = item.reads;
        });

        return result;
    };

    const heatmapData = transformDataForHeatmap(dailyReads);

    // Set date range to show the last year (like GitHub)
    const today = new Date();
    const oneYearAgo = new Date(today);
    oneYearAgo.setFullYear(today.getFullYear() - 1);

    const startDate = oneYearAgo.toISOString().split('T')[0]; // YYYY-MM-DD format
    const endDate = today.toISOString().split('T')[0]; // YYYY-MM-DD format

    return (
        <AppShell.Main>
            <Stack>
                <Title order={2}>Daily Reads Activity</Title>
                <Heatmap
                    data={heatmapData}
                    startDate={startDate}
                    endDate={endDate}
                    withTooltip
                    withMonthLabels
                    withWeekdayLabels
                    getTooltipLabel={({ date, value }) =>
                        `${new Date(date).toLocaleDateString('en-US', {
                            weekday: 'long',
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric',
                        })} – ${value === null || value === 0 ? 'No reads' : `${value} read${value > 1 ? 's' : ''}`}`
                    }
                    colors={[
                        'var(--mantine-color-blue-1)',
                        'var(--mantine-color-blue-4)',
                        'var(--mantine-color-blue-6)',
                        'var(--mantine-color-blue-8)',
                    ]}
                />
            </Stack>
        </AppShell.Main>
    );
};

const NavBar = function Navbar({ user }: { user: User }) {
    return (
        <AppShell.Navbar>
            <AppShell.Section pr="md" pl="md" pt="md">
                <TextInput
                    placeholder="Search"
                    size="xs"
                    leftSection={<IconSearch size={12} stroke={1.5} />}
                    rightSectionWidth={70}
                    rightSection={
                        <Code className={classes.searchCode}>Ctrl + K</Code>
                    }
                    styles={{ section: { pointerEvents: 'none' } }}
                    mb="sm"
                />
            </AppShell.Section>

            <AppShell.Section>
                <UserButton user={user} />
            </AppShell.Section>
        </AppShell.Navbar>
    );
};

interface DailyReads {
    date: string;
    reads: number;
}

interface ChartsProps extends PageProps {
    dailyReads: DailyReads[];
}

const Charts = ({ dailyReads }: ChartsProps) => {
    const user = usePage().props.auth.user;

    const [opened, { toggle }] = useDisclosure();

    return (
        <AppShell
            header={{ height: 60 }}
            navbar={{
                width: 300,
                breakpoint: 'sm',
                collapsed: { mobile: !opened },
            }}
            padding="md"
        >
            <AppShell.Header>
                <Group h="100%" px="md">
                    <Burger
                        opened={opened}
                        onClick={toggle}
                        hiddenFrom="sm"
                        size="sm"
                    />
                    <ApplicationLogo width={50} />
                    <Title order={3} style={{ margin: 0 }}>
                        Larafeed
                    </Title>
                </Group>
            </AppShell.Header>

            <NavBar user={user} />

            <Main dailyReads={dailyReads} />
        </AppShell>
    );
};

Charts.layout = (page: ReactNode) => (
    <AuthenticatedLayout pageTitle="Charts">{page}</AuthenticatedLayout>
);

export default Charts;
