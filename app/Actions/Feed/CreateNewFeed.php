<?php

namespace App\Actions\Feed;

use App\Models\Feed;
use App\Models\User;
use AshAllenDesign\FaviconFetcher\Facades\Favicon;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Lorisleiva\Actions\Concerns\AsAction;

class CreateNewFeed
{
    use AsAction;

    public function rules(): array
    {
        return [
            'feed_url' => ['required', 'max:255', 'url'],
        ];
    }

    public function getValidationMessages(): array
    {
        return [
            'feed_url.required' => 'Please enter a feed URL',
            'feed_url.url' => 'Please enter a valid URL',
            'feed_url.max' => 'Please enter a URL that is less than 255 characters',
        ];
    }

    public function asController(Request $request)
    {
        $this->handle($request->feed_url, $request->user());

        return redirect()->route('feeds.index');
    }

    public function handle(string $feed_url, ?User $attachedUser)
    {

        if (Feed::where('feed_url', $feed_url)->exists()) {
            if ($attachedUser) {
                if ($attachedUser->feeds()->where('feed_url', $feed_url)->exists()) {
                    return redirect()->route('feeds.index')->withErrors([
                        'feed_url' => "You're already following this feed",
                    ]);
                } else {
                    $attachedUser->feeds()->attach(Feed::where('feed_url', $feed_url)->first());

                    return redirect()->route('feeds.index');
                }
            }

            return redirect()->route('feeds.index')->withErrors([
                'feed_url' => 'Feed already exists',
            ]);
        }

        // TODO fetch limit
        $crawledFeed = \Feeds::make(feedUrl: $feed_url);
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

            Log::error($error);
            // return redirect()->back()->withErrors([
            //     'feed_url' => $error,
            // ]);

            return redirect()->route('feeds.index')->withErrors([
                'feed_url' => $error,
            ]);
        }

        // Handle feeds without site link such as https://aggregate.stitcher.io/rss
        $site_url = $crawledFeed->get_link() ?? $feed_url;

        // TODO fix + cache/store + refresh
        try {
            $favicon_url = Favicon::withFallback('favicon-kit')->fetch($site_url)?->getFaviconUrl();
        } catch (\Exception $e) {
            Log::error('Failed to fetch favicon for '.$site_url.': '.$e->getMessage());
            $favicon_url = null;
        }

        $feed = Feed::create([
            'name' => $crawledFeed->get_title() ?? $site_url,
            'feed_url' => $feed_url,
            'site_url' => $site_url,
            'favicon_url' => $favicon_url,
        ]);

        if ($attachedUser) {
            $attachedUser->feeds()->attach($feed);
        }

        // TODO single insert
        $entries = $crawledFeed->get_items();
        foreach ($entries as $entry) {
            $feed->entries()->create([
                'title' => $entry->get_title(),
                'url' => $entry->get_permalink(),
                'content' => $entry->get_content(),
                'published_at' => $entry->get_date('Y-m-d H:i:s'),
            ]);
        }
    }
}
