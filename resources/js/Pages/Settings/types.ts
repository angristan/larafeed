import type { PageProps } from '@/types';

export type SettingsSection = 'profile' | 'opml';

export type SettingsPageProps = PageProps<{
    mustVerifyEmail: boolean;
    status?: string;
    initialSection?: SettingsSection;
}>;
