<?php

declare(strict_types=1);

namespace App\Actions\Feed;

use App\Actions\Favicon\GetFaviconURL;
use App\Models\Feed;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Log;
use Lorisleiva\Actions\Concerns\AsAction;

class RefreshFavicon
{
    use AsAction;

    public function asJob(Feed $feed): void
    {
        $this->handle($feed);
    }

    public function asController(string $feed_id): \Illuminate\Http\JsonResponse
    {
        if (! $feed_id) {
            return response()->json(['error' => 'Missing feed id'], 400);
        }

        $feed = Feed::forUser(Auth::user())->find($feed_id);

        if (! $feed) {
            return response()->json(['error' => 'Unauthorized'], 401);
        }

        // Dispatch the favicon refresh job
        $this->dispatch($feed);

        return response()->json(['message' => 'Favicon refresh requested'], 200);
    }

    public function handle(Feed $feed): void
    {
        Log::info('Starting favicon refresh for feed', [
            'feed_id' => $feed->id,
            'feed_name' => $feed->name,
            'site_url' => $feed->site_url,
            'current_favicon_url' => $feed->favicon_url,
        ]);

        try {
            $favicon_url = GetFaviconURL::run($feed->site_url);

            if ($favicon_url) {
                $old_favicon_url = $feed->favicon_url;
                $feed->favicon_url = $favicon_url;
                $feed->favicon_updated_at = now();
                $feed->save();

                Log::info('Favicon refreshed successfully for feed', [
                    'feed_id' => $feed->id,
                    'feed_name' => $feed->name,
                    'site_url' => $feed->site_url,
                    'old_favicon_url' => $old_favicon_url,
                    'new_favicon_url' => $favicon_url,
                ]);
            } else {
                // Even if we failed to get a favicon, update the timestamp so we don't keep retrying immediately
                $feed->favicon_updated_at = now();
                $feed->save();

                Log::warning('Failed to fetch favicon for feed', [
                    'feed_id' => $feed->id,
                    'feed_name' => $feed->name,
                    'site_url' => $feed->site_url,
                    'reason' => 'No favicon URL returned',
                ]);
            }
        } catch (\Exception $e) {
            Log::error('Exception occurred while refreshing favicon for feed', [
                'feed_id' => $feed->id,
                'feed_name' => $feed->name,
                'site_url' => $feed->site_url,
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString(),
            ]);
        }
    }
}
