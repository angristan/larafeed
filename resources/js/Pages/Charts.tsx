import classes from './Import.module.css';

import UserButton from '../Components/UserButton/UserButton';
import ApplicationLogo from '@/Components/ApplicationLogo/ApplicationLogo';
import AuthenticatedLayout from '@/Layouts/AuthenticatedLayout';
import { PageProps, User } from '@/types';
import { usePage } from '@inertiajs/react';
import { BarChart } from '@mantine/charts';
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
    return (
        <AppShell.Main>
            <Stack>
                <Title order={2}>Daily Reads</Title>
                <BarChart
                    h={300}
                    data={dailyReads}
                    dataKey="date"
                    series={[{ name: 'reads', color: 'blue.6' }]}
                    tickLine="y"
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
