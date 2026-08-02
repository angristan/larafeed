import {
    Alert,
    Button,
    Center,
    Container,
    Group,
    Stack,
    Text,
    Title,
} from '@mantine/core';
import { IconArrowLeft, IconHome, IconRefresh } from '@tabler/icons-react';
import {
    isRouteErrorResponse,
    Link,
    useNavigate,
    useRevalidator,
    useRouteError,
} from 'react-router';

export interface RouteErrorDescription {
    readonly title: string;
    readonly message: string;
}

export function describeRouteError(error: unknown): RouteErrorDescription {
    if (isRouteErrorResponse(error)) {
        return {
            title:
                error.status === 404
                    ? 'Page not found'
                    : `Request failed (${error.status})`,
            message:
                error.status === 404
                    ? 'The requested page does not exist.'
                    : error.statusText || 'The request could not be completed.',
        };
    }

    if (error instanceof Error) {
        return {
            title: 'Something went wrong',
            message: error.message || 'The page could not be loaded.',
        };
    }

    return {
        title: 'Something went wrong',
        message: 'The page could not be loaded.',
    };
}

function BackAndHomeActions() {
    const navigate = useNavigate();

    return (
        <Group justify="center">
            <Button
                leftSection={<IconArrowLeft aria-hidden="true" size={16} />}
                onClick={() => void navigate(-1)}
                variant="default"
            >
                Go back
            </Button>
            <Button
                component={Link}
                leftSection={<IconHome aria-hidden="true" size={16} />}
                to="/feeds"
            >
                Back to reader
            </Button>
        </Group>
    );
}

export function RouteErrorPage() {
    const description = describeRouteError(useRouteError());
    const revalidator = useRevalidator();

    return (
        <Container component="main" size="sm" py="xl">
            <Center mih="70dvh">
                <Stack gap="lg" w="100%">
                    <Alert color="red" title={description.title}>
                        <Text>{description.message}</Text>
                    </Alert>
                    <Group justify="center">
                        <Button
                            leftSection={
                                <IconRefresh aria-hidden="true" size={16} />
                            }
                            loading={revalidator.state !== 'idle'}
                            onClick={() => revalidator.revalidate()}
                        >
                            Try again
                        </Button>
                    </Group>
                    <BackAndHomeActions />
                </Stack>
            </Center>
        </Container>
    );
}

export function NotFoundPage() {
    return (
        <Container component="main" size="sm" py="xl">
            <Center mih="70dvh">
                <Stack align="center" gap="md" ta="center">
                    <Text c="dimmed" fw={700} size="xl">
                        404
                    </Text>
                    <Title order={1}>Page not found</Title>
                    <Text c="dimmed">
                        This address does not match a Larafeed page.
                    </Text>
                    <BackAndHomeActions />
                </Stack>
            </Center>
        </Container>
    );
}
