<?php

declare(strict_types=1);

namespace App\Actions\Feed;

use App\Models\Feed;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;
use Lorisleiva\Actions\Concerns\AsAction;

class RefreshFavicons
{
    use AsAction;

    public string $commandSignature = 'feeds:refresh-favicons {--limit=1 : Number of feeds to refresh}';

    public string $commandDescription = 'Refresh favicons for feeds';

    public function handle(int $limit = 1): void
    {
        // Get feeds ordered by favicon refresh priority:
        // 1. Feeds without favicons (favicon_url IS NULL)
        // 2. Feeds that have never had their favicon refreshed (favicon_updated_at IS NULL)
        // 3. Feeds with the oldest favicon refresh date
        $feeds = Feed::orderByRaw('CASE WHEN favicon_url IS NULL THEN 0 ELSE 1 END')
            ->orderByRaw('CASE WHEN favicon_updated_at IS NULL THEN 0 ELSE 1 END')
            ->orderBy('favicon_updated_at', 'asc')
            ->limit($limit)
            ->get();

        Log::info('Starting favicon refresh for feeds', [
            'total_feeds' => $feeds->count(),
            'limit' => $limit,
        ]);

        $feeds->each(function (Feed $feed) {
            RefreshFavicon::dispatch($feed);
            Log::info('Dispatched favicon refresh for feed', [
                'feed_id' => $feed->id,
                'feed_name' => $feed->name,
                'site_url' => $feed->site_url,
                'has_favicon' => ! is_null($feed->favicon_url),
                'favicon_updated_at' => $feed->favicon_updated_at,
            ]);
        });

        Log::info('Completed dispatching favicon refresh jobs', [
            'feeds_processed' => $feeds->count(),
        ]);
    }

    public function asCommand(Command $command): void
    {
        $limit = (int) $command->option('limit');
        $this->handle($limit);
        $command->info("Favicon refresh jobs dispatched for {$limit} feed(s)!");
    }
}
