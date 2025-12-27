export interface User {
    id: number;
    name: string;
    email: string;
    email_verified_at?: string;
}

export interface DatadogRumConfig {
    applicationId: string | null;
    clientToken: string | null;
    site: string;
    service: string;
    env: string;
    sessionSampleRate: number;
    sessionReplaySampleRate: number;
    privacyLevel: 'mask' | 'mask-user-input' | 'allow';
}

export type PageProps<
    T extends Record<string, unknown> = Record<string, unknown>,
> = T & {
    auth: {
        user: User;
    };
    datadogRum: DatadogRumConfig;
};
