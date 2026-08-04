import {
    Alert,
    Badge,
    Button,
    Divider,
    FileInput,
    Group,
    Loader,
    Paper,
    Progress,
    SimpleGrid,
    Stack,
    Text,
    Title,
} from '@mantine/core';
import {
    IconDownload,
    IconFileImport,
    IconInfoCircle,
    IconRefresh,
} from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useMemo, useState } from 'react';
import type { OpmlImport } from '../api/opml';
import { ApplicationPage } from '../components/ApplicationPage';
import {
    createOpmlImportMutationOptions,
    isActiveOpmlImport,
    opmlImportListQueryOptions,
} from '../queries/opml';

const MAX_OPML_BYTES = 2_000_000;
const MAX_OPML_CHARACTERS = 2_000_000;
const MAX_FILENAME_CHARACTERS = 255;
const MAX_VISIBLE_ERRORS = 5;
const ACCEPTED_OPML_EXTENSIONS = /\.(?:opml|xml)$/i;

const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
});

const statePresentation = {
    pending: { label: 'Pending', color: 'gray' },
    processing: { label: 'Processing', color: 'blue' },
    completed: { label: 'Completed', color: 'green' },
    failed: { label: 'Failed', color: 'red' },
    canceled: { label: 'Canceled', color: 'gray' },
} as const satisfies Record<
    OpmlImport['state'],
    { readonly label: string; readonly color: string }
>;

function validateFile(file: File): string | null {
    const filename = file.name.trim();

    if (filename.length === 0 || !ACCEPTED_OPML_EXTENSIONS.test(filename)) {
        return 'Choose a file with an .opml or .xml extension.';
    }

    if (filename.length > MAX_FILENAME_CHARACTERS) {
        return `Use a filename with ${MAX_FILENAME_CHARACTERS.toLocaleString()} characters or fewer.`;
    }

    if (file.size > MAX_OPML_BYTES) {
        return 'Choose an OPML file smaller than 2 MB.';
    }

    return null;
}

function formatTimestamp(timestamp: number): string {
    return dateTimeFormatter.format(new Date(timestamp));
}

function progressValue(opmlImport: OpmlImport): number {
    if (opmlImport.totalItems === 0) {
        return opmlImport.state === 'completed' ? 100 : 0;
    }

    const processed =
        opmlImport.succeededItems +
        opmlImport.failedItems +
        opmlImport.skippedItems;
    return Math.min(100, (processed / opmlImport.totalItems) * 100);
}

function ImportCard({ opmlImport }: { readonly opmlImport: OpmlImport }) {
    const presentation = statePresentation[opmlImport.state];
    const active = isActiveOpmlImport(opmlImport);
    const processed =
        opmlImport.succeededItems +
        opmlImport.failedItems +
        opmlImport.skippedItems;
    const visibleErrors = opmlImport.errors.slice(0, MAX_VISIBLE_ERRORS);
    const hiddenErrorCount = Math.max(
        0,
        opmlImport.errors.length - visibleErrors.length,
    );
    const headingId = `opml-import-${opmlImport.id}`;

    return (
        <Paper
            component="article"
            aria-labelledby={headingId}
            withBorder
            p={{ base: 'md', sm: 'lg' }}
        >
            <Stack gap="md">
                <Group justify="space-between" align="flex-start" wrap="wrap">
                    <Stack gap={2}>
                        <Title id={headingId} order={3} size="h4">
                            {opmlImport.filename ?? `Import #${opmlImport.id}`}
                        </Title>
                        <Text c="dimmed" size="xs">
                            Started {formatTimestamp(opmlImport.createdAt)}
                        </Text>
                    </Stack>
                    <Badge color={presentation.color} variant="light">
                        {presentation.label}
                    </Badge>
                </Group>

                <Stack gap={6}>
                    <Progress
                        aria-label={`${processed.toLocaleString()} of ${opmlImport.totalItems.toLocaleString()} feeds processed`}
                        color={opmlImport.state === 'failed' ? 'red' : 'blue'}
                        size="md"
                        value={progressValue(opmlImport)}
                    />
                    <Text
                        aria-live={active ? 'polite' : undefined}
                        c="dimmed"
                        size="xs"
                    >
                        {opmlImport.totalItems === 0 && active
                            ? 'Waiting for feeds to be discovered…'
                            : `${processed.toLocaleString()} of ${opmlImport.totalItems.toLocaleString()} feeds processed`}
                    </Text>
                </Stack>

                <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="xs">
                    <Stack gap={0}>
                        <Text fw={700}>{opmlImport.totalItems}</Text>
                        <Text c="dimmed" size="xs">
                            Total
                        </Text>
                    </Stack>
                    <Stack gap={0}>
                        <Text c="green" fw={700}>
                            {opmlImport.succeededItems}
                        </Text>
                        <Text c="dimmed" size="xs">
                            Added
                        </Text>
                    </Stack>
                    <Stack gap={0}>
                        <Text c="yellow" fw={700}>
                            {opmlImport.skippedItems}
                        </Text>
                        <Text c="dimmed" size="xs">
                            Skipped
                        </Text>
                    </Stack>
                    <Stack gap={0}>
                        <Text c="red" fw={700}>
                            {opmlImport.failedItems}
                        </Text>
                        <Text c="dimmed" size="xs">
                            Failed
                        </Text>
                    </Stack>
                </SimpleGrid>

                {visibleErrors.length > 0 && (
                    <Stack gap="xs">
                        <Text fw={600} size="sm">
                            Feed errors
                        </Text>
                        <Stack component="ul" gap="xs" m={0} pl="lg">
                            {visibleErrors.map((error) => (
                                <li key={`${error.position}-${error.feedUrl}`}>
                                    <Text size="sm">
                                        {error.title ?? error.feedUrl}
                                    </Text>
                                    <Text
                                        c="dimmed"
                                        lineClamp={1}
                                        size="xs"
                                        title={error.feedUrl}
                                    >
                                        {error.feedUrl} · {error.errorClass}
                                    </Text>
                                </li>
                            ))}
                        </Stack>
                        {hiddenErrorCount > 0 && (
                            <Text c="dimmed" size="xs">
                                {hiddenErrorCount.toLocaleString()} more errors
                                are not shown.
                            </Text>
                        )}
                    </Stack>
                )}
            </Stack>
        </Paper>
    );
}

function ImportHistory({
    imports,
}: {
    readonly imports: readonly OpmlImport[];
}) {
    const currentImports = imports.filter(isActiveOpmlImport);
    const recentImports = imports.filter(
        (opmlImport) => !isActiveOpmlImport(opmlImport),
    );

    if (imports.length === 0) {
        return (
            <Paper withBorder p="xl">
                <Stack align="center" gap="xs" ta="center">
                    <IconInfoCircle aria-hidden="true" size={28} />
                    <Text fw={600}>No OPML imports yet</Text>
                    <Text c="dimmed" maw={480} size="sm">
                        Import an OPML file to add its feeds and category paths.
                    </Text>
                </Stack>
            </Paper>
        );
    }

    return (
        <Stack gap="xl">
            {currentImports.length > 0 && (
                <Stack component="section" gap="sm">
                    <Title order={2} size="h3">
                        Current imports
                    </Title>
                    {currentImports.map((opmlImport) => (
                        <ImportCard
                            key={opmlImport.id}
                            opmlImport={opmlImport}
                        />
                    ))}
                </Stack>
            )}

            {recentImports.length > 0 && (
                <Stack component="section" gap="sm">
                    <Title order={2} size="h3">
                        Recent imports
                    </Title>
                    {recentImports.map((opmlImport) => (
                        <ImportCard
                            key={opmlImport.id}
                            opmlImport={opmlImport}
                        />
                    ))}
                </Stack>
            )}
        </Stack>
    );
}

export function OpmlPage() {
    const queryClient = useQueryClient();
    const importsQuery = useQuery(opmlImportListQueryOptions);
    const uploadMutation = useMutation(
        createOpmlImportMutationOptions(queryClient),
    );
    const [file, setFile] = useState<File | null>(null);
    const [fileError, setFileError] = useState<string | null>(null);
    const [readingFile, setReadingFile] = useState(false);

    const sortedImports = useMemo(
        () =>
            [...(importsQuery.data?.imports ?? [])].sort(
                (left, right) => right.createdAt - left.createdAt,
            ),
        [importsQuery.data?.imports],
    );

    const handleFileChange = (nextFile: File | null) => {
        setFile(nextFile);
        setFileError(nextFile === null ? null : validateFile(nextFile));
        uploadMutation.reset();
    };

    const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();

        if (file === null) {
            setFileError('Choose an OPML file to import.');
            return;
        }

        const metadataError = validateFile(file);
        if (metadataError !== null) {
            setFileError(metadataError);
            return;
        }

        setReadingFile(true);
        setFileError(null);

        try {
            const opml = await file.text();
            if (opml.length === 0) {
                setFileError('The selected file is empty.');
                return;
            }
            if (opml.length > MAX_OPML_CHARACTERS) {
                setFileError(
                    `The selected file contains more than ${MAX_OPML_CHARACTERS.toLocaleString()} characters.`,
                );
                return;
            }

            uploadMutation.mutate(
                { opml, filename: file.name.trim() },
                {
                    onSuccess: () => {
                        setFile(null);
                        setFileError(null);
                    },
                },
            );
        } catch {
            setFileError('Larafeed could not read the selected file.');
        } finally {
            setReadingFile(false);
        }
    };

    const uploadPending = readingFile || uploadMutation.isPending;

    return (
        <ApplicationPage
            activePage="settings"
            pageTitle="Import & export"
            settingsNavigation
        >
            <Stack gap="xl" maw={720} mx="auto" my="md">
                <Stack gap={4}>
                    <Title order={1}>Settings</Title>
                    <Text c="dimmed" size="sm">
                        Manage your account, preferences, and data import/export
                        tools.
                    </Text>
                </Stack>

                <Stack component="section" gap="lg" maw={520}>
                    <Title order={2}>Import &amp; export</Title>
                    <Stack gap="md">
                        <Title id="opml-upload-heading" order={3}>
                            Import OPML
                        </Title>
                        <form onSubmit={handleSubmit}>
                            <Stack gap="md">
                                <FileInput
                                    accept=".opml,.xml,application/xml,text/xml"
                                    clearable
                                    description={`Choose an .opml or .xml file smaller than 2 MB and with no more than ${MAX_OPML_CHARACTERS.toLocaleString()} characters.`}
                                    disabled={uploadPending}
                                    error={fileError ?? undefined}
                                    label="Upload OPML file"
                                    leftSection={
                                        <IconFileImport
                                            aria-hidden="true"
                                            size={18}
                                        />
                                    }
                                    onChange={handleFileChange}
                                    placeholder="Select or drop an .opml file"
                                    value={file}
                                />
                                {uploadMutation.isError && (
                                    <Alert
                                        color="red"
                                        role="alert"
                                        title="Import could not be started"
                                    >
                                        {uploadMutation.error.message}
                                    </Alert>
                                )}
                                {uploadMutation.isSuccess && (
                                    <Alert
                                        color="green"
                                        role="status"
                                        title="Import started"
                                    >
                                        Larafeed is processing import #
                                        {uploadMutation.data.id}. Progress
                                        appears below.
                                    </Alert>
                                )}
                                <Group>
                                    <Button
                                        disabled={
                                            file === null || fileError !== null
                                        }
                                        leftSection={
                                            <IconFileImport
                                                aria-hidden="true"
                                                size={18}
                                            />
                                        }
                                        loading={uploadPending}
                                        type="submit"
                                    >
                                        Import subscriptions
                                    </Button>
                                </Group>
                            </Stack>
                        </form>
                    </Stack>
                    <Divider />
                    <Stack gap="sm">
                        <Title order={3}>Export OPML</Title>
                        <Text c="dimmed" size="sm">
                            Download your subscriptions and categories as an
                            OPML file.
                        </Text>
                        <Button
                            component="a"
                            download="feeds.opml"
                            href="/api/opml/export"
                            leftSection={
                                <IconDownload aria-hidden="true" size={18} />
                            }
                            variant="default"
                            w="fit-content"
                        >
                            Download OPML
                        </Button>
                    </Stack>
                </Stack>

                <Stack
                    component="section"
                    gap="md"
                    aria-labelledby="history-heading"
                >
                    <Group justify="space-between" align="center">
                        <Title id="history-heading" order={2} size="h2">
                            Import progress
                        </Title>
                        {importsQuery.isFetching && !importsQuery.isPending && (
                            <Group gap="xs" role="status" aria-live="polite">
                                <Loader size="xs" />
                                <Text c="dimmed" size="xs">
                                    Updating…
                                </Text>
                            </Group>
                        )}
                    </Group>

                    {importsQuery.isPending && (
                        <Group
                            aria-live="polite"
                            justify="center"
                            py="xl"
                            role="status"
                        >
                            <Loader size="sm" />
                            <Text size="sm">Loading OPML imports…</Text>
                        </Group>
                    )}

                    {importsQuery.isError && (
                        <Alert
                            color="red"
                            title="Import progress is unavailable"
                            role="alert"
                        >
                            <Stack align="flex-start" gap="sm">
                                <Text size="sm">
                                    {importsQuery.error.message}
                                </Text>
                                <Button
                                    leftSection={
                                        <IconRefresh
                                            aria-hidden="true"
                                            size={16}
                                        />
                                    }
                                    onClick={() => void importsQuery.refetch()}
                                    size="xs"
                                    variant="light"
                                >
                                    Try again
                                </Button>
                            </Stack>
                        </Alert>
                    )}

                    {importsQuery.data !== undefined && (
                        <ImportHistory imports={sortedImports} />
                    )}
                </Stack>
            </Stack>
        </ApplicationPage>
    );
}
