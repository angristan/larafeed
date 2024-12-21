import classes from './Import.module.css';

import { UserButton } from '../Components/UserButton/UserButton';
import ApplicationLogo from '@/Components/ApplicationLogo';
import AuthenticatedLayout from '@/Layouts/AuthenticatedLayout';
import { User } from '@/types';
import { useForm, usePage } from '@inertiajs/react';
import { AppShell, Burger, Code, Group, TextInput, Title } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { IconSearch } from '@tabler/icons-react';
import { FormEventHandler, ReactNode } from 'react';

const Main = function Main() {
    const { setData, post, progress } = useForm({
        opml_file: null as File | null,
    });

    const submit: FormEventHandler = (e) => {
        e.preventDefault();

        post(route('import.store'), {
            onSuccess: () => {
                notifications.show({
                    title: 'OMPL imported',
                    message:
                        'The feeds are now being imported in the background',
                });
            },
        });
    };

    return (
        <AppShell.Main
            style={{
                display: 'flex',
                height: '100vh',
                width: '100vw',
                overflow: 'hidden',
            }}
        >
            <form onSubmit={submit}>
                <input
                    type="file"
                    onChange={(e) => {
                        if (e.target.files) {
                            if (e.target.files.length > 0) {
                                setData('opml_file', e.target.files[0]);
                            }
                        }
                    }}
                />
                {progress && (
                    <progress value={progress.percentage} max="100">
                        {progress.percentage}%
                    </progress>
                )}
                <button type="submit">Submit</button>
            </form>
            {/* <FileInput
                clearable
                leftSection={icon}
                accept=".opml"
                label="Upload files"
                placeholder="Upload files"
            /> */}
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

const Import = () => {
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

            <Main />
        </AppShell>
    );
};

Import.layout = (page: ReactNode) => (
    <AuthenticatedLayout pageTitle="Import">{page}</AuthenticatedLayout>
);

export default Import;
