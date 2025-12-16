<?php

declare(strict_types=1);

namespace App\Actions\Favicon;

use App\Support\UrlSecurityValidator;
use AshAllenDesign\FaviconFetcher\Facades\Favicon;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Lorisleiva\Actions\Concerns\AsAction;
use Uri;

class GetFaviconURL
{
    use AsAction;

    public function handle(string $original_site_url): ?string
    {
        // Extract the site URL from the original URL
        // Handle edges cases such as  https://blog.laravel.com/feed
        // not having a link to https://blog.laravel.com/ in the feed,
        // thus the favicon fetcher cannot extract the favicon URL
        // from the head section.
        $site_uri = Uri::of($original_site_url);
        $site_url = $site_uri->scheme().'://'.$site_uri->host();

        try {
            $favicon_url = Favicon::withFallback('unavatar')
                ->fetch($site_url)
                ?->getFaviconUrl();

            if (! $favicon_url) {
                Log::error('Failed to fetch favicon for '.$site_url.': No favicon URL found');

                return null;
            }

            // Validate favicon URL to prevent SSRF attacks
            if (! UrlSecurityValidator::isSafe($favicon_url)) {
                Log::warning('Favicon URL failed SSRF validation', [
                    'site_url' => $site_url,
                    'favicon_url' => $favicon_url,
                ]);

                return null;
            }

            // Check the favicon URL is valid
            /** @var \Illuminate\Http\Client\Response $response */
            $response = Http::get($favicon_url);

            if (! $response->ok()) {
                Log::withContext([
                    'response_status' => $response->status(),
                    'site_url' => $site_url,
                    'favicon_url' => $favicon_url,
                ])->error('Failed to fetch favicon: invalid response');

                return null;
            }

            if ($response->header('Content-Length') === '0') {
                Log::error('Failed to fetch favicon for '.$site_url.': Empty content');

                return null;
            }

            return $favicon_url;

        } catch (\Exception $e) {
            Log::error('Failed to fetch favicon for '.$site_url.': '.$e->getMessage());

            return null;
        }
    }
}
