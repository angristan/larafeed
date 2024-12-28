<?php

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
        Feed::inRandomOrder()->limit(5)->get()->each(
            fn (Feed $feed) => RefreshFeedEntries::dispatch($feed)
        );
    }

    public function asCommand(Command $command): void
    {
        $this->asJob();
        $command->info('Done!');
    }
}
