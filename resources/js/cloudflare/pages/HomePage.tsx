import {
    Alert,
    Badge,
    Button,
    Container,
    Group,
    Loader,
    Paper,
    Stack,
    Text,
    Title,
} from '@mantine/core';
import { useQuery } from '@tanstack/react-query';

import { healthQueryOptions } from '../queries/health';

export function HomePage() {
    const healthQuery = useQuery(healthQueryOptions);

    return (
        <Container component="main" size="sm" py="xl">
            <Stack gap="lg">
                <Stack gap={4}>
                    <Title order={1}>Larafeed</Title>
                    <Text c="dimmed">
                        The Cloudflare React application is ready.
                    </Text>
                </Stack>

                <Paper component="section" withBorder p="lg" aria-live="polite">
                    <Stack gap="md">
                        <Group justify="space-between">
                            <Title order={2} size="h3">
                                Service health
                            </Title>
                            {healthQuery.isSuccess && (
                                <Badge color="green">Available</Badge>
                            )}
                        </Group>

                        {healthQuery.isPending && (
                            <Group gap="sm">
                                <Loader size="sm" />
                                <Text>Checking the API…</Text>
                            </Group>
                        )}

                        {healthQuery.isError && (
                            <Alert color="red" title="Health check failed">
                                <Stack gap="sm">
                                    <Text size="sm">
                                        {healthQuery.error.message}
                                    </Text>
                                    <Button
                                        onClick={() =>
                                            void healthQuery.refetch()
                                        }
                                        size="xs"
                                        variant="light"
                                    >
                                        Try again
                                    </Button>
                                </Stack>
                            </Alert>
                        )}

                        {healthQuery.isSuccess && (
                            <Stack gap="xs">
                                <Text>The API returned a valid response.</Text>
                                <Text
                                    component="pre"
                                    ff="monospace"
                                    fz="sm"
                                    m={0}
                                >
                                    {JSON.stringify(healthQuery.data, null, 2)}
                                </Text>
                                {healthQuery.isFetching && (
                                    <Text c="dimmed" size="xs">
                                        Refreshing…
                                    </Text>
                                )}
                            </Stack>
                        )}
                    </Stack>
                </Paper>
            </Stack>
        </Container>
    );
}
