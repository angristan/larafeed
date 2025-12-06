import { Avatar, Group, Text, UnstyledButton } from '@mantine/core';
import { IconChevronUp } from '@tabler/icons-react';
import { forwardRef } from 'react';
import type { User } from '@/types';
import classes from './UserButton.module.css';

interface UserButtonProps {
    user: User;
}

const UserButton = forwardRef<
    HTMLDivElement,
    React.ComponentPropsWithoutRef<'div'> & UserButtonProps
>((props, ref) => (
    <div ref={ref} {...props}>
        <UnstyledButton className={classes.user}>
            <Group>
                <Avatar src={null} radius="xl">
                    {props.user.name[0]}
                </Avatar>

                <div style={{ flex: 1 }}>
                    <Text size="sm" fw={500}>
                        {props.user.name}
                    </Text>

                    <Text c="dimmed" size="xs">
                        {props.user.email}
                    </Text>
                </div>

                <IconChevronUp size={14} stroke={1.5} />
            </Group>
        </UnstyledButton>
    </div>
));

UserButton.displayName = 'UserButton';

export default UserButton;
