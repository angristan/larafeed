/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_APP_NAME: string;
    readonly VITE_APP_VERSION: string;
    readonly VITE_DATADOG_APPLICATION_ID: string;
    readonly VITE_DATADOG_CLIENT_TOKEN: string;
    readonly VITE_DATADOG_SITE: string;
    readonly VITE_DATADOG_SERVICE: string;
    readonly VITE_DATADOG_ENV: string;
    readonly VITE_DATADOG_SESSION_SAMPLE_RATE: string;
    readonly VITE_DATADOG_SESSION_REPLAY_SAMPLE_RATE: string;
    readonly VITE_DATADOG_PRIVACY_LEVEL: 'mask' | 'mask-user-input' | 'allow';
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
