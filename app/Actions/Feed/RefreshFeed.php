<?php

declare(strict_types=1);

namespace App\Actions\Feed;

use App\Actions\Entry\ApplySubscriptionFilters;
use App\Exceptions\FeedCrawlFailedException;
use App\Models\Feed;
use Carbon\Carbon;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Log;
use Lorisleiva\Actions\Concerns\AsAction;
use Throwable;

class RefreshFeed
{
    use AsAction;

    public function asJob(Feed $feed): void
    {
        RefreshFeed::run($feed);
    }

    public function handle(Feed $feed): void
    {
        $startedAt = now();

        $result = FetchFeed::run($feed->feed_url);

        if (! $result['success']) {
            $error = $result['error'];

            RecordFeedRefresh::run($feed, $startedAt, success: false, error: $error);

            Log::withContext([
                'feed_id' => $feed->id,
                'feed_name' => $feed->name,
                'feed_url' => $feed->feed_url,
                'error' => $error,
            ])->error('Failed to refresh feed');

            throw new FeedCrawlFailedException("Failed to refresh feed: {$error}");
        }

        $crawledFeed = $result['feed'];

        try {
            $newEntries = IngestFeedEntries::run($feed, $crawledFeed->get_items());

            RecordFeedRefresh::run($feed, $startedAt, success: true, entriesCreated: $newEntries->count());

            if ($newEntries->isNotEmpty()) {
                ApplySubscriptionFilters::make()->forNewEntries($feed->id, $newEntries);
            }

            Log::withContext([
                'feed_id' => $feed->id,
                'feed_name' => $feed->name,
                'feed_url' => $feed->feed_url,
                'entries_created' => $newEntries->count(),
            ])->info('Feed refreshed');
        } catch (Throwable $exception) {
            RecordFeedRefresh::run($feed, $startedAt, success: false, error: $exception->getMessage());

            Log::withContext([
                'feed_id' => $feed->id,
                'feed_name' => $feed->name,
                'feed_url' => $feed->feed_url,
                'error' => $exception->getMessage(),
            ])->error('Feed refresh crashed', ['exception' => $exception]);

            throw $exception;
        }
    }

    public function asController(string $feed_id): \Illuminate\Http\JsonResponse
    {
        $feed = Feed::forUser(Auth::user())->find($feed_id);

        if (! $feed) {
            return response()->json(['error' => 'Unauthorized'], 403);
        }

        if ($feed->last_successful_refresh_at && Carbon::parse($feed->last_successful_refresh_at)->diffInMinutes(now()) < 5) {
            return response()->json(['message' => 'Feed has already been refreshed less than 5min ago'], 429);
        }

        $this->dispatch($feed);

        return response()->json(['message' => 'Feed refresh requested'], 200);
    }
}
