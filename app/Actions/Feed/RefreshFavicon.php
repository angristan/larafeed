<?php

declare(strict_types=1);

namespace App\Actions\Feed;

use App\Actions\Favicon\AnalyzeFaviconBrightness;
use App\Actions\Favicon\GetFaviconURL;
use App\Models\Feed;
use App\Support\Tracing;
use DDTrace\Trace;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Log;
use Keepsuit\LaravelOpenTelemetry\Facades\Tracer;
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
        $feed = Feed::forUser(Auth::user())->find($feed_id);

        if (! $feed) {
            return response()->json(['error' => 'Unauthorized'], 403);
        }

        $this->dispatch($feed);

        return response()->json(['message' => 'Favicon refresh requested'], 200);
    }

    #[Trace(name: 'favicon.refresh', tags: ['domain' => 'feeds'])]
    public function handle(Feed $feed): void
    {
        Tracer::newSpan('favicon.refresh')
            ->setAttributes(['domain' => 'feeds'])
            ->measure(function () use ($feed): void {
                Tracing::setAttributes([
                    'feed.id' => (string) $feed->id,
                    'feed.name' => $feed->name,
                    'feed.site_url' => $feed->site_url,
                ]);

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
                        $feed->favicon_is_dark = AnalyzeFaviconBrightness::run($favicon_url);
                        $feed->favicon_updated_at = now();
                        $feed->save();

                        Log::info('Favicon refreshed successfully for feed', [
                            'feed_id' => $feed->id,
                            'feed_name' => $feed->name,
                            'site_url' => $feed->site_url,
                            'old_favicon_url' => $old_favicon_url,
                            'new_favicon_url' => $favicon_url,
                            'favicon_is_dark' => $feed->favicon_is_dark,
                        ]);

                        Tracing::setAttributes([
                            'favicon.status' => 'success',
                            'favicon.url' => $favicon_url,
                            'favicon.changed' => $old_favicon_url !== $favicon_url ? 'true' : 'false',
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

                        Tracing::setAttributes(['favicon.status' => 'not_found']);
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
            });
    }
}
