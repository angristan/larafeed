<?php

declare(strict_types=1);

namespace App\Actions\Feed;

use App\Models\Feed;
use Illuminate\Console\Command;
use Lorisleiva\Actions\Concerns\AsAction;

class RefreshFeeds
{
    use AsAction;

    public string $commandSignature = 'feeds:refresh';

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
     * Refresh all the feeds asynchronously by queuing a job for each feed
     * Priority is given to to combination of:
     *      feeds that haven't been refreshed in a while
     *      feeds where the last entry is recent
     */
    public function asJob(): void
    {
        Feed::query()
            ->leftJoin('entries', 'feeds.id', '=', 'entries.feed_id')
            // Select the feed and the last entry published_at date
            ->select('feeds.*', \DB::raw('MAX(entries.published_at) as last_entry_at'))
            ->groupBy('feeds.id')
            // Select feeds that haven't been refreshed in the last two hours
            ->whereRaw('GREATEST(last_successful_refresh_at, last_failed_refresh_at) < ?', [now()->subMinutes(120)])
            // Order by the ratio of time since last refresh and time since last entry
            ->orderByRaw(<<<'SQL'
                CASE
                -- Refresh feeds at least once a day
                WHEN GREATEST(last_successful_refresh_at, last_failed_refresh_at) < (NOW() - INTERVAL '24 hour')
                    THEN 1
                ELSE (
                    CASE
                    -- We fetch the entries when we add the feed
                    -- So if there are no entries, the feed has never been working
                    WHEN MAX(entries.published_at) IS NULL THEN (
                        -- ratio of time since last refresh and 10 years ago
                        -- so this should give a lower ratio to feeds that have never been working
                        -- because we treat them as if their last entry was 10 years ago
                        -- we still want to refresh them from time to time
                        (
                            EXTRACT(EPOCH FROM NOW()) - EXTRACT(EPOCH FROM GREATEST(last_successful_refresh_at, last_failed_refresh_at))
                        ) /
                        (
                            EXTRACT(EPOCH FROM NOW()) - (EXTRACT(EPOCH FROM NOW() - INTERVAL '10 year'))
                        )
                    )
                    -- ratio of time since last refresh and time since last entry
                    -- we want to refresh feeds that have not been refreshed in a while
                    -- but we want to prioritize feeds that have recent entries
                    ELSE (
                        EXTRACT(EPOCH FROM NOW()) - EXTRACT(EPOCH FROM GREATEST(last_successful_refresh_at, last_failed_refresh_at))
                    ) / NULLIF( -- Avoid division by zero in the very unlikely case where now = the most recent entry
                        EXTRACT(EPOCH FROM NOW()) - EXTRACT(EPOCH FROM MAX(entries.published_at)),
                        0
                    )
                    END
                )
                END DESC
                SQL
            )
            ->limit(1)
            ->get()
            ->each(fn (Feed $feed) => RefreshFeedEntries::dispatch($feed));
    }

    public function asCommand(Command $command): void
    {
        $this->asJob();
        $command->info('Done!');
    }
}
