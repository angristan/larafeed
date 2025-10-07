export interface User {
    id: number;
    name: string;
    email: string;
    email_verified_at?: string;
    pagination_mode: PaginationMode;
}

export type PageProps<
    T extends Record<string, unknown> = Record<string, unknown>,
> = T & {
    auth: {
        user: User;
    };
};

export type PaginationMode = 'infinite' | 'classic';
