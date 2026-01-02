import type { PageProps } from '@/types';

export type SettingsSection = 'profile' | 'security' | 'opml';

export type SettingsPageProps = PageProps<{
    mustVerifyEmail: boolean;
    status?: string;
    initialSection?: SettingsSection;
    twoFactorEnabled: boolean;
    twoFactorConfirmed: boolean;
}>;
