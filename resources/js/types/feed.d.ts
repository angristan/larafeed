interface Feed {
    id: number;
    name: string;
    favicon_url: string | null;
    site_url: string;
    entries_count: number;
    last_successful_refresh_at: string | null;
    last_failed_refresh_at: string | null;
}

interface Timestamps {
    created_at: string | null;
    updated_at: string | null;
}

interface Entry extends Timestamps {
    id: number;
    title: string;
    url: string;
    author: string | null;
    content: string | null;
    published_at: string;
    read_at: string | null;
    starred_at: string | null;
    feed: {
        id: number;
        favicon_url: string;
        name: string;
    };
}
