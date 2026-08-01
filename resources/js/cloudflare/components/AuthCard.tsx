import {
    Center,
    Container,
    Paper,
    Stack,
    type StackProps,
    Text,
    Title,
} from '@mantine/core';
import type { PropsWithChildren, ReactElement } from 'react';

interface AuthCardProps extends PropsWithChildren {
    readonly title: string;
    readonly description: string;
    readonly gap?: StackProps['gap'];
}

export function AuthCard({
    title,
    description,
    children,
    gap = 'lg',
}: AuthCardProps): ReactElement {
    return (
        <Container component="main" size={460} px="md">
            <Center mih="100dvh" py="xl">
                <Stack gap="xl" w="100%">
                    <Stack gap={4} ta="center">
                        <Text fw={700} fz="lg" c="blue">
                            Larafeed
                        </Text>
                        <Title order={1}>{title}</Title>
                        <Text c="dimmed" size="sm">
                            {description}
                        </Text>
                    </Stack>

                    <Paper withBorder shadow="xs" p={{ base: 'lg', sm: 'xl' }}>
                        <Stack gap={gap}>{children}</Stack>
                    </Paper>

                    <Text c="dimmed" size="xs" ta="center">
                        Private reader · Passkey access only
                    </Text>
                </Stack>
            </Center>
        </Container>
    );
}
