import { router, useForm } from '@inertiajs/react';
import {
    Alert,
    Button,
    FileInput,
    Group,
    Modal,
    Stack,
    Text,
    Title,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import {
    IconAlertCircle,
    IconFileImport,
    IconTrash,
} from '@tabler/icons-react';
import { type FormEventHandler, useState } from 'react';

const OpmlSettings = () => {
    const { data, setData, post, processing, errors, reset } = useForm({
        opml_file: null as File | null,
    });

    const submitImport: FormEventHandler = (event) => {
        event.preventDefault();

        post(route('import.store'), {
            forceFormData: true,
            preserveScroll: true,
            onSuccess: () => {
                notifications.show({
                    title: 'OPML uploaded',
                    message: 'Feeds will import in the background shortly.',
                    color: 'green',
                });
                reset();
            },
        });
    };

    const [wipeModalOpened, wipeModalHandlers] = useDisclosure(false);
    const [wiping, setWiping] = useState(false);

    const handleWipe = () => {
        setWiping(true);
        router.post(
            route('profile.wipe'),
            {},
            {
                preserveScroll: true,
                onSuccess: () => {
                    notifications.show({
                        title: 'Account wiped',
                        message:
                            'All feeds, entries, and categories were deleted.',
                        color: 'orange',
                    });
                    wipeModalHandlers.close();
                },
                onFinish: () => setWiping(false),
            },
        );
    };

    return (
        <Stack gap="xl">
            <Stack gap={4}>
                <Title order={2}>Import & export</Title>
                <Text size="sm" c="dimmed">
                    Manage OPML files and reset your reading data.
                </Text>
            </Stack>

            <Stack component="form" onSubmit={submitImport} gap="md" maw={520}>
                <Title order={3}>Import OPML</Title>
                <FileInput
                    label="Upload OPML file"
                    placeholder="Select or drop an .opml file"
                    accept=".opml"
                    value={data.opml_file}
                    onChange={(file) => setData('opml_file', file)}
                    clearable
                    error={errors.opml_file}
                    required
                />
                <Group justify="flex-end">
                    <Button
                        type="submit"
                        loading={processing}
                        leftSection={<IconFileImport size={16} />}
                        disabled={data.opml_file === null}
                    >
                        Import subscriptions
                    </Button>
                </Group>
            </Stack>

            <Stack gap="md" maw={520}>
                <Title order={3}>Export OPML</Title>
                <Text size="sm" c="dimmed">
                    Download all of your subscriptions as an OPML file.
                </Text>
                <Group justify="flex-start">
                    <Button
                        component="a"
                        href={route('export.download')}
                        leftSection={<IconFileImport size={16} />}
                        variant="default"
                    >
                        Download OPML
                    </Button>
                </Group>
            </Stack>

            <Stack gap="md" maw={520}>
                <Title order={3}>Wipe account data</Title>
                <Alert
                    icon={<IconAlertCircle size={16} />}
                    color="red"
                    variant="light"
                >
                    This removes all feeds, entries, and categories but keeps
                    your account active.
                </Alert>
                <Group justify="space-between">
                    <Text size="sm" c="dimmed">
                        Use when you want a clean slate without deleting your
                        account.
                    </Text>
                    <Button
                        color="red"
                        leftSection={<IconTrash size={16} />}
                        onClick={wipeModalHandlers.open}
                    >
                        Wipe data
                    </Button>
                </Group>
            </Stack>

            <Modal
                opened={wipeModalOpened}
                onClose={wipeModalHandlers.close}
                title="Wipe account data"
            >
                <Stack gap="md">
                    <Text>
                        Are you sure you want to delete all stored feeds,
                        entries, and categories? This cannot be undone.
                    </Text>
                    <Group justify="flex-end">
                        <Button
                            variant="default"
                            onClick={wipeModalHandlers.close}
                        >
                            Cancel
                        </Button>
                        <Button
                            color="red"
                            onClick={handleWipe}
                            loading={wiping}
                        >
                            Wipe data
                        </Button>
                    </Group>
                </Stack>
            </Modal>
        </Stack>
    );
};

export default OpmlSettings;
