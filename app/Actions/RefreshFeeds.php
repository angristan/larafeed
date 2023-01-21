<?php

namespace App\Actions;

use App\Models\Feed;
use Lorisleiva\Actions\Concerns\AsAction;

class RefreshFeeds
{
    use AsAction;

    /**
     * Refresh all the feeds synchronously.
     */
    public function handle(): void
    {
        Feed::all()->each(
            fn (Feed $feed) => RefreshFeedEntries::run($feed)
        );
    }

    /**
     * Refresh all the feeds asynchronously
     * by queuing a job for each feed
     */
    public function asJob(): void
    {
        Feed::all()->each(
            fn (Feed $feed) => RefreshFeedEntries::dispatch($feed)
        );
    }
}
