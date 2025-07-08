<?php

declare(strict_types=1);

namespace App\Actions\Feed;

use App\Models\Feed;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;
use Lorisleiva\Actions\Concerns\AsAction;

class RefreshAllFavicons
{
    use AsAction;

    public string $commandSignature = 'feeds:refresh-all-favicons';

    public string $commandDescription = 'Refresh favicons for all feeds';

    public function handle(): void
    {
        $feeds = Feed::all();

        Log::info('Starting favicon refresh for all feeds', [
            'total_feeds' => $feeds->count(),
        ]);

        $feeds->each(function (Feed $feed) {
            RefreshFavicon::dispatch($feed);
            Log::info('Dispatched favicon refresh for feed', [
                'feed_id' => $feed->id,
                'feed_name' => $feed->name,
                'site_url' => $feed->site_url,
            ]);
        });

        Log::info('Completed dispatching favicon refresh jobs for all feeds');
    }

    public function asCommand(Command $command): void
    {
        $this->handle();
        $command->info('Favicon refresh jobs dispatched for all feeds!');
    }
}
