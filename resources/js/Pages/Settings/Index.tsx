import AuthenticatedLayout from '@/Layouts/AuthenticatedLayout';
import { PageProps, PaginationMode } from '@/types';
import { Head, useForm } from '@inertiajs/react';
import {
    Alert,
    Button,
    Container,
    Paper,
    Radio,
    Stack,
    Switch,
    Text,
    Title,
} from '@mantine/core';
import { IconInfoCircle } from '@tabler/icons-react';
import { FormEvent, useMemo } from 'react';

type SettingsProps = PageProps<{
    paginationMode: PaginationMode;
    paginationModes: PaginationMode[];
    showHnBadges: boolean;
}>;

const PAGINATION_LABELS: Record<PaginationMode, string> = {
    infinite: 'Infinite scroll',
    classic: 'Classic pagination',
};

export default function Settings({
    paginationMode,
    paginationModes,
    showHnBadges,
}: SettingsProps) {
    const { data, setData, patch, processing, recentlySuccessful, errors } =
        useForm<{
            pagination_mode: PaginationMode;
            show_hn_badges: boolean;
        }>({
            pagination_mode: paginationMode,
            show_hn_badges: showHnBadges,
        });

    const options = useMemo(
        () =>
            paginationModes.map((mode) => ({
                value: mode,
                label: PAGINATION_LABELS[mode],
            })),
        [paginationModes],
    );

    const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();

        patch(route('settings.update'), {
            preserveScroll: true,
        });
    };

    return (
        <AuthenticatedLayout pageTitle="Settings">
            <Head title="Settings" />
            <Container size="sm" py="xl">
                <Title order={2} mb="md">
                    Settings
                </Title>
                <Paper withBorder p="lg" radius="md">
                    <form onSubmit={handleSubmit}>
                        <Stack gap="md">
                            <div>
                                <Text fw={500} mb="xs">
                                    Pagination mode
                                </Text>
                                <Text size="sm" c="dimmed" mb="sm">
                                    Choose how entries should load in the
                                    reader.
                                </Text>
                                <Radio.Group
                                    name="pagination_mode"
                                    value={data.pagination_mode}
                                    onChange={(value) =>
                                        setData(
                                            'pagination_mode',
                                            value as PaginationMode,
                                        )
                                    }
                                    error={errors.pagination_mode}
                                >
                                    <Stack gap="xs">
                                        {options.map((option) => (
                                            <Radio
                                                key={option.value}
                                                value={option.value}
                                                label={option.label}
                                            />
                                        ))}
                                    </Stack>
                                </Radio.Group>
                            </div>

                            <div>
                                <Text fw={500} mb="xs">
                                    Hacker News badges
                                </Text>
                                <Text size="sm" c="dimmed" mb="sm">
                                    Toggle points and comment badges for
                                    Hacker News entries in the reader.
                                </Text>
                                <Switch
                                    label="Show badges for Hacker News entries"
                                    checked={data.show_hn_badges}
                                    name="show_hn_badges"
                                    onChange={(event) =>
                                        setData(
                                            'show_hn_badges',
                                            event.currentTarget.checked,
                                        )
                                    }
                                    error={errors.show_hn_badges}
                                />
                            </div>

                            {recentlySuccessful && (
                                <Alert
                                    color="green"
                                    icon={<IconInfoCircle size={16} />}
                                >
                                    Settings saved.
                                </Alert>
                            )}

                            <Button
                                type="submit"
                                loading={processing}
                                disabled={
                                    data.pagination_mode === paginationMode &&
                                    data.show_hn_badges === showHnBadges
                                }
                            >
                                Save changes
                            </Button>
                        </Stack>
                    </form>
                </Paper>
            </Container>
        </AuthenticatedLayout>
    );
}
