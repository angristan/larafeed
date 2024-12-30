<?php

declare(strict_types=1);

namespace App\Actions;

use AshAllenDesign\FaviconFetcher\Facades\Favicon;
use Http;
use Illuminate\Support\Facades\Log;
use Lorisleiva\Actions\Concerns\AsAction;

class GetFaviconURL
{
    use AsAction;

    public function handle(string $site_url): ?string
    {
        try {
            $favicon_url = Favicon::withFallback('unavatar')
                ->fetch($site_url)
                ?->getFaviconUrl();

            // Check the favicon URL is valid
            $response = Http::head($favicon_url);

            if (! $response->ok()) {
                Log::error('Failed to fetch favicon for '.$site_url.': '.$response->status());
                $favicon_url = null;
            }

            if ($response->header('Content-Length') === '0') {
                Log::error('Failed to fetch favicon for '.$site_url.': Empty content');
                $favicon_url = null;
            }

            return $favicon_url;

        } catch (\Exception $e) {
            Log::error('Failed to fetch favicon for '.$site_url.': '.$e->getMessage());

            return null;
        }
    }
}
