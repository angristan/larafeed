<?php

namespace App\Actions\Feed;

use App\Models\Feed;
use Inertia\Inertia;
use Lorisleiva\Actions\Concerns\AsAction;

class ShowFeedPage
{
    use AsAction;

    /**
     * Show the feed page with entries
     * This action is only meant to be used to return a view
     */
    public function handle(Feed $feed): \Inertia\Response
    {
        // TODO: https://www.eoghanobrien.com/posts/define-a-custom-collection-for-your-eloquent-model
        return Inertia::render('Feed/Entries', [
            'feed' => collect($feed->only([
                'id',
                'name',
                'feed_url',
                'site_url',
                'favicon_url',
                'last_crawled_at',
            ]))->merge([
                'entries_count' => $feed->entries()->count(),
            ]),
            'entries' => $feed->entries()->orderBy('published_at', 'desc')->get(),
        ]);
    }
}
