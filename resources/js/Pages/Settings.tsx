import ApplicationLogo from '@/Components/ApplicationLogo/ApplicationLogo';
import { PageProps } from '@/types';
import { useForm, usePage } from '@inertiajs/react';
import {
    AppShell,
    Burger,
    Button,
    Group,
    Radio,
    Stack,
    Title,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { FormEventHandler } from 'react';

const Settings = () => {
    const { paginationType } = usePage<
        PageProps & { paginationType: string }
    >().props;

    const [opened, { toggle }] = useDisclosure();

    const { data, setData, post, processing } = useForm({
        pagination_type: paginationType,
    });

    const submit: FormEventHandler = (e) => {
        e.preventDefault();

        post(route('settings.store'), {
            onSuccess: () => {
                notifications.show({
                    title: 'Settings updated',
                    message: 'Your pagination preference has been saved',
                });
            },
        });
    };

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
                        Larafeed - Settings
                    </Title>
                </Group>
            </AppShell.Header>

            <AppShell.Main>
                <Stack>
                    <Title order={2}>Settings</Title>

                    <form onSubmit={submit}>
                        <Stack>
                            <Title order={3}>Pagination Type</Title>

                            <Radio.Group
                                value={data.pagination_type}
                                onChange={(value) =>
                                    setData('pagination_type', value)
                                }
                                name="paginationType"
                                label="Choose how entries are loaded"
                                description="Infinite scroll loads entries automatically as you scroll, while classic pagination uses page numbers"
                            >
                                <Stack mt="xs">
                                    <Radio
                                        value="infinite"
                                        label="Infinite Scroll"
                                    />
                                    <Radio
                                        value="classic"
                                        label="Classic Pagination"
                                    />
                                </Stack>
                            </Radio.Group>

                            <Button
                                type="submit"
                                loading={processing}
                                style={{ width: 'fit-content' }}
                            >
                                Save Settings
                            </Button>
                        </Stack>
                    </form>
                </Stack>
            </AppShell.Main>
        </AppShell>
    );
};

export default Settings;
