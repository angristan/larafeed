<?php

declare(strict_types=1);

namespace App\Actions\Feed;

use App\Models\Feed;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;
use Lorisleiva\Actions\Concerns\AsAction;
use Carbon\Carbon;

class RefreshOutdatedFavicons
{
    use AsAction;

    public string $commandSignature = 'feeds:refresh-outdated-favicons {--days=30 : Number of days to consider a favicon outdated}';

    public string $commandDescription = 'Refresh favicons for feeds that haven\'t been updated recently';

    public function handle(int $days = 30): void
    {
        $cutoffDate = Carbon::now()->subDays($days);

        // Get feeds where:
        // 1. Favicon is null
        // 2. Feed hasn't been updated in X days
        // 3. Last successful refresh was more than X days ago
        $feeds = Feed::where(function ($query) use ($cutoffDate) {
            $query->whereNull('favicon_url')
                  ->orWhere('updated_at', '<', $cutoffDate)
                  ->orWhere('last_successful_refresh_at', '<', $cutoffDate);
        })
        ->orderByRaw('CASE WHEN favicon_url IS NULL THEN 0 ELSE 1 END') // Prioritize feeds without favicons
        ->orderBy('updated_at', 'asc') // Then by oldest updated
        ->get();

        Log::info('Starting favicon refresh for outdated feeds', [
            'total_feeds' => $feeds->count(),
            'cutoff_date' => $cutoffDate->toDateTimeString(),
            'days_threshold' => $days,
        ]);

        $feeds->each(function (Feed $feed) {
            RefreshFavicon::dispatch($feed);

            Log::info('Dispatched favicon refresh for outdated feed', [
                'feed_id' => $feed->id,
                'feed_name' => $feed->name,
                'site_url' => $feed->site_url,
                'has_favicon' => !is_null($feed->favicon_url),
                'last_updated' => $feed->updated_at?->toDateTimeString(),
                'last_refresh' => $feed->last_successful_refresh_at,
            ]);
        });

        Log::info('Completed dispatching favicon refresh jobs for outdated feeds');
    }

    public function asCommand(Command $command): void
    {
        $days = (int) $command->option('days');
        $this->handle($days);
        $command->info("Favicon refresh jobs dispatched for feeds older than {$days} days!");
    }
}
