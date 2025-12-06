<?php

declare(strict_types=1);

namespace App\Actions\Feed;

use App\Exceptions\FeedCrawlFailedException;
use App\Models\Feed;
use App\Models\FeedRefresh;
use Carbon\Carbon;
use Feeds;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Lorisleiva\Actions\Concerns\AsAction;
use SimplePie\Item;
use Throwable;

class RefreshFeedEntries
{
    use AsAction;

    public function asJob(Feed $feed): void
    {
        RefreshFeedEntries::run($feed);
    }

    public function handle(Feed $feed): void
    {
        $startedAt = now();

        try {
            // @phpstan-ignore argument.type (SimplePie accepts string, array triggers deprecated multi-feed mode)
            $crawledFeed = Feeds::make(feedUrl: $feed->feed_url);
            if ($crawledFeed->error()) {
                $error = '';
                if (is_array($crawledFeed->error())) {
                    $error = implode(', ', $crawledFeed->error());
                } else {
                    $error = $crawledFeed->error();
                }
                // "cURL error 3: " -> "cURL error 3"
                // idk why it adds a colon at the end
                $error = rtrim($error, ': ');

                $feed->last_error_message = Str::limit($error, 255, '');
                $feed->last_failed_refresh_at = $startedAt;
                $feed->save();

                FeedRefresh::create([
                    'feed_id' => $feed->id,
                    'refreshed_at' => $startedAt,
                    'was_successful' => false,
                    'entries_created' => 0,
                    'error_message' => $error,
                ]);

                Log::withContext([
                    'feed_id' => $feed->id,
                    'feed_name' => $feed->name,
                    'feed_url' => $feed->feed_url,
                    'feed_site_url' => $feed->site_url,
                    'error' => $error,
                ])->error('Failed to refresh feed');

                throw new FeedCrawlFailedException("Failed to refresh feed: {$error}");
            }

            $entriesCreated = 0;

            collect($crawledFeed->get_items())->each(function (Item $item) use ($feed, &$entriesCreated) {
                if ($feed->entries()->where('url', $item->get_permalink())->exists()) {
                    // TODO: should we update the entry?
                    return;
                }

                $feed->entries()->create([
                    'title' => str_replace('&amp;', '&', $item->get_title()),
                    'url' => $item->get_permalink(),
                    'author' => $item->get_author()?->get_name(),
                    'content' => $item->get_content(),
                    'published_at' => $item->get_date('Y-m-d H:i:s'),
                ]);

                $entriesCreated++;
            });

            $feed->last_successful_refresh_at = $startedAt;
            $feed->last_error_message = null;
            $feed->save();

            FeedRefresh::create([
                'feed_id' => $feed->id,
                'refreshed_at' => $startedAt,
                'was_successful' => true,
                'entries_created' => $entriesCreated,
                'error_message' => null,
            ]);

            Log::withContext([
                'feed_id' => $feed->id,
                'feed_name' => $feed->name,
                'feed_url' => $feed->feed_url,
                'feed_site_url' => $feed->site_url,
                'feed_entries_count' => $feed->entries()->count(),
                'entries_created' => $entriesCreated,
            ])->info('Feed refreshed');
        } catch (FeedCrawlFailedException $exception) {
            throw $exception;
        } catch (Throwable $exception) {
            $errorMessage = $exception->getMessage();
            $trimmedError = Str::limit($errorMessage, 255, '');

            $feed->last_error_message = $trimmedError;
            $feed->last_failed_refresh_at = $startedAt;
            $feed->save();

            FeedRefresh::create([
                'feed_id' => $feed->id,
                'refreshed_at' => $startedAt,
                'was_successful' => false,
                'entries_created' => 0,
                'error_message' => $errorMessage,
            ]);

            Log::withContext([
                'feed_id' => $feed->id,
                'feed_name' => $feed->name,
                'feed_url' => $feed->feed_url,
                'feed_site_url' => $feed->site_url,
                'error' => $trimmedError,
            ])->error('Feed refresh crashed', [
                'exception' => $exception,
            ]);

            throw $exception;
        }
    }

    public function asController(string $feed_id): \Illuminate\Http\JsonResponse
    {
        if (! $feed_id) {
            return response()->json(['error' => 'Missing feed id'], 400);
        }

        // Check if the user has access to the feed
        if (! Auth::user()->feeds()->where('id', $feed_id)->exists()) {
            return response()->json(['error' => 'Unauthorized'], 401);
        }

        $feed = Feed::whereId($feed_id)->first();

        if ($feed->last_successful_refresh_at && Carbon::parse($feed->last_successful_refresh_at)->diffInMinutes(now()) < 5) {
            return response()->json(['message' => 'Feed has already been refreshed less than 5min ago'], 429);
        }

        $this->dispatch($feed);

        return response()->json(['message' => 'Feed refresh requested'], 200);
    }
}
