<?php

declare(strict_types=1);

namespace App\Actions\Feed;

use App\Support\Tracing;
use App\Support\UrlSecurityValidator;
use DDTrace\Trace;
use Feeds;
use Illuminate\Support\Facades\Log;
use Keepsuit\LaravelOpenTelemetry\Facades\Tracer;
use Lorisleiva\Actions\Concerns\AsAction;
use SimplePie\SimplePie;

class FetchFeed
{
    use AsAction;

    /**
     * @return array{success: true, feed: SimplePie}|array{success: false, error: string}
     */
    #[Trace(name: 'feed.fetch', tags: ['domain' => 'feeds'])]
    public function handle(string $url): array
    {
        return Tracer::newSpan('feed.fetch')
            ->setAttributes(['domain' => 'feeds'])
            ->measure(function () use ($url): array {
                Tracing::setAttributes(['feed.url' => $url]);

                $urlValidation = UrlSecurityValidator::validate($url);
                if (! $urlValidation['valid']) {
                    Log::warning("[FetchFeed] Blocked unsafe URL: {$url}");

                    Tracing::setAttributes([
                        'fetch.status' => 'blocked',
                        'fetch.error' => $urlValidation['error'] ?? 'Invalid feed URL',
                    ]);

                    return [
                        'success' => false,
                        'error' => $urlValidation['error'] ?? 'Invalid feed URL',
                    ];
                }

                // Pin DNS resolution to the IPs we validated, preventing DNS rebinding
                $curlOptions = [];
                if (! empty($urlValidation['curl_resolve'])) {
                    $curlOptions[CURLOPT_RESOLVE] = $urlValidation['curl_resolve'];
                }

                $crawledFeed = Feeds::make(
                    $url, // @phpstan-ignore argument.type (SimplePie accepts string; array triggers deprecated multi-feed mode)
                    0,
                    false,
                    ! empty($curlOptions) ? ['curl.options' => $curlOptions] : null // @phpstan-ignore argument.type
                );

                if ($crawledFeed->error()) {
                    $error = is_array($crawledFeed->error())
                        ? implode(', ', $crawledFeed->error())
                        : $crawledFeed->error();

                    // "cURL error 3: " -> "cURL error 3"
                    $error = rtrim($error, ': ');

                    Tracing::setAttributes([
                        'fetch.status' => 'error',
                        'fetch.error' => $error,
                    ]);

                    return [
                        'success' => false,
                        'error' => $error,
                    ];
                }

                Tracing::setAttributes(['fetch.status' => 'success']);

                return [
                    'success' => true,
                    'feed' => $crawledFeed,
                ];
            });
    }
}
