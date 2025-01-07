import classes from './Import.module.css';

import UserButton from '../Components/UserButton/UserButton';
import ApplicationLogo from '@/Components/ApplicationLogo/ApplicationLogo';
import AuthenticatedLayout from '@/Layouts/AuthenticatedLayout';
import { User } from '@/types';
import { useForm, usePage } from '@inertiajs/react';
import {
    AppShell,
    Burger,
    Button,
    Code,
    Divider,
    FileInput,
    Group,
    Stack,
    TextInput,
    Title,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { IconFile, IconSearch, IconUpload } from '@tabler/icons-react';
import { FormEventHandler, ReactNode } from 'react';

const Main = function Main() {
    const { data, setData, post, processing, errors } = useForm({
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
            <Stack>
                <form onSubmit={submit}>
                    <Stack gap="md">
                        <FileInput
                            clearable
                            onChange={(file) => {
                                if (file) {
                                    setData('opml_file', file);
                                }
                            }}
                            leftSection={<IconFile />}
                            accept=".opml"
                            label="Upload OPML file containing subscriptions"
                            placeholder="Click to select file"
                            error={errors.opml_file}
                            disabled={processing}
                            size="md"
                            radius="md"
                        />

                        <Button
                            type="submit"
                            loading={processing}
                            leftSection={<IconUpload size={16} />}
                            disabled={data.opml_file === null}
                            size="md"
                            radius="md"
                        >
                            Upload OPML
                        </Button>
                    </Stack>
                </form>

                <Divider my="md" />

                <a download href={route('export.download')}>
                    <Button>Export all subscription as OPML</Button>
                </a>

                <Button
                    onClick={() => {
                        post(route('profile.wipe'), {
                            onSuccess: () => {
                                notifications.show({
                                    title: 'Account wiped',
                                    message:
                                        'Feeds, entries and categories have been deleted',
                                });
                            },
                        });
                    }}
                    color="red"
                >
                    Wipe account
                </Button>
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

const OPMLImportExport = () => {
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

OPMLImportExport.layout = (page: ReactNode) => (
    <AuthenticatedLayout pageTitle="OPML Import/Export">
        {page}
    </AuthenticatedLayout>
);

export default OPMLImportExport;
