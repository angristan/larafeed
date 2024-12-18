import classes from './UserButton.module.css';
import { User } from '@/types';
import { Avatar, Group, Text, UnstyledButton } from '@mantine/core';
import { IconChevronRight } from '@tabler/icons-react';

export function UserButton({ user }: { user: User }) {
    return (
        <UnstyledButton className={classes.user}>
            <Group>
                <Avatar
                    src="https://raw.githubusercontent.com/mantinedev/mantine/master/.demo/avatars/avatar-8.png"
                    radius="xl"
                />

                <div style={{ flex: 1 }}>
                    <Text size="sm" fw={500}>
                        {user.name}
                    </Text>

                    <Text c="dimmed" size="xs">
                        {user.email}
                    </Text>
                </div>

                <IconChevronRight size={14} stroke={1.5} />
            </Group>
        </UnstyledButton>
    );
}
