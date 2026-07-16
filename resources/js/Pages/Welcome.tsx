import { Head, Link } from '@inertiajs/react';
import {
    Badge,
    Box,
    Button,
    Container,
    Group,
    Paper,
    SimpleGrid,
    Stack,
    Text,
    ThemeIcon,
    Title,
} from '@mantine/core';
import { IconBolt, IconBrain, IconRss } from '@tabler/icons-react';
import ApplicationLogo from '@/Components/ApplicationLogo/ApplicationLogo';
import ColorSchemeSwitcher from '@/Components/ColorSchemeSwitcher/ColorSchemeSwitcher';
import classes from './Welcome.module.css';

interface Props {
    canRegister: boolean;
}

const features = [
    {
        icon: IconRss,
        title: 'Everything in one place',
        description: 'Organize the sites you follow without an algorithm.',
    },
    {
        icon: IconBolt,
        title: 'Fast by design',
        description: 'Move through your queue with prefetching and shortcuts.',
    },
    {
        icon: IconBrain,
        title: 'Summaries when useful',
        description: 'Get the gist, then decide what deserves a deeper read.',
    },
];

export default function Welcome({ canRegister }: Props) {
    return (
        <Box className={classes.page}>
            <Head title="Welcome" />

            <header className={classes.header}>
                <Container size="md">
                    <Group justify="space-between" wrap="nowrap">
                        <Group gap="xs" className={classes.brand}>
                            <ApplicationLogo width={36} aria-hidden="true" />
                            <Text fw={800} size="lg">
                                Larafeed
                            </Text>
                        </Group>
                        <ColorSchemeSwitcher />
                    </Group>
                </Container>
            </header>

            <Container component="main" size="md" className={classes.container}>
                <Stack align="center" gap="xl">
                    <Stack align="center" gap="md" maw={720}>
                        <Badge variant="light" size="lg" radius="xl">
                            A calmer way to keep up
                        </Badge>
                        <Title order={1} ta="center" className={classes.title}>
                            Your feeds, one focused reading space.
                        </Title>
                        <Text
                            c="dimmed"
                            size="lg"
                            ta="center"
                            maw={610}
                            className={classes.lede}
                        >
                            Follow the web on your terms, clear the noise, and
                            spend your attention on the stories that matter.
                        </Text>
                    </Stack>

                    <Group justify="center" gap="sm">
                        <Button
                            component={Link}
                            href={route('login')}
                            size="md"
                        >
                            Sign in
                        </Button>
                        {canRegister && (
                            <Button
                                component={Link}
                                href={route('register')}
                                variant="default"
                                size="md"
                            >
                                Create an account
                            </Button>
                        )}
                    </Group>

                    {!canRegister && (
                        <Text size="sm" c="dimmed" ta="center">
                            New registrations are currently closed.
                        </Text>
                    )}

                    <SimpleGrid
                        cols={{ base: 1, sm: 3 }}
                        spacing="md"
                        className={classes.features}
                    >
                        {features.map((feature) => {
                            const Icon = feature.icon;

                            return (
                                <Paper
                                    key={feature.title}
                                    withBorder
                                    p="lg"
                                    radius="lg"
                                    className={classes.feature}
                                >
                                    <ThemeIcon
                                        variant="light"
                                        radius="md"
                                        size={38}
                                    >
                                        <Icon size={19} stroke={1.7} />
                                    </ThemeIcon>
                                    <Text fw={700} mt="md">
                                        {feature.title}
                                    </Text>
                                    <Text size="sm" c="dimmed" mt={5}>
                                        {feature.description}
                                    </Text>
                                </Paper>
                            );
                        })}
                    </SimpleGrid>
                </Stack>
            </Container>
        </Box>
    );
}
