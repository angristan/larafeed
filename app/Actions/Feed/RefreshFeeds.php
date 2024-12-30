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
     * Refresh all the feeds asynchronously
     * by queuing a job for each feed
     */
    public function asJob(): void
    {

        Feed::orderByRaw('LEAST(last_successful_refresh_at, last_failed_refresh_at) ASC')->limit(10)->get()->each(
            fn (Feed $feed) => RefreshFeedEntries::dispatch($feed)
        );
    }

    public function asCommand(Command $command): void
    {
        $this->asJob();
        $command->info('Done!');
    }
}
