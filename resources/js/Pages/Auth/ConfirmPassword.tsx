import { Head, useForm } from '@inertiajs/react';
import { Button, PasswordInput, Stack } from '@mantine/core';
import { IconLock } from '@tabler/icons-react';
import type { FormEventHandler } from 'react';
import AuthLayout from '@/Layouts/AuthLayout/AuthLayout';

export default function ConfirmPassword() {
    const { data, setData, post, processing, errors, reset } = useForm({
        password: '',
    });

    const submit: FormEventHandler = (e) => {
        e.preventDefault();

        post(route('password.confirm'), {
            onFinish: () => reset('password'),
        });
    };

    return (
        <AuthLayout
            title="Confirm it is you"
            description="This is a secure area. Enter your password to continue."
            icon={<IconLock size={22} stroke={1.7} />}
        >
            <Head title="Confirm Password" />

            <form onSubmit={submit}>
                <Stack gap="lg">
                    <PasswordInput
                        label="Password"
                        placeholder="Your password"
                        name="password"
                        required
                        autoFocus
                        autoComplete="current-password"
                        value={data.password}
                        onChange={(event) =>
                            setData('password', event.currentTarget.value)
                        }
                        error={errors.password}
                    />

                    <Button
                        fullWidth
                        size="md"
                        type="submit"
                        loading={processing}
                        disabled={processing}
                    >
                        Confirm password
                    </Button>
                </Stack>
            </form>
        </AuthLayout>
    );
}
