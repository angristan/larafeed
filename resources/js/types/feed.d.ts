interface Feed {
    id: number;
    name: string;
    original_name: string;
    favicon_url: string;
    site_url: string;
    feed_url: string;
    entries_count: number;
    last_successful_refresh_at: string | null;
    last_failed_refresh_at: string | null;
    category_id: number;
}

interface Timestamps {
    created_at: string | null;
    updated_at: string | null;
}

interface PaginatedEntries {
    data: Entry[];
    current_page: number;
    last_page: number;
    total: number;
}

interface Entry extends Timestamps {
    id: number;
    title: string;
    url: string;
    author: string | null;
    content: string | null;
    hn_points: number | null;
    hn_comments_count: number | null;
    published_at: string;
    read_at: string | null;
    starred_at: string | null;
    feed: {
        id: number;
        favicon_url: string;
        name: string;
    };
}

interface Category extends Timestamps {
    id: number;
    name: string;
}
