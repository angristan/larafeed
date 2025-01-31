<?php

declare(strict_types=1);

namespace App\Actions\Feed;

use App\Actions\Favicon\GetFaviconURL;
use App\Models\Feed;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Log;
use Lorisleiva\Actions\Concerns\AsAction;

class CreateNewFeed
{
    use AsAction;

    public function rules(): array
    {
        return [
            'feed_url' => ['required', 'max:255', 'url', 'active_url'],
            'category_id' => ['required', 'exists:subscription_categories,id'],
        ];
    }

    public function getValidationMessages(): array
    {
        return [
            'feed_url.required' => 'Please enter a feed URL',
            'feed_url.url' => 'Please enter a valid URL',
            'feed_url.active_url' => 'Please ensure the URL is reachable',
            'feed_url.max' => 'Please enter a URL that is less than 255 characters',
            'category_id.required' => 'Please select a category',
            'category_id.exists' => 'Please select a valid category',
        ];
    }

    public function asController(Request $request)
    {
        // Check if category exists for the user
        if (! Auth::user()->subscriptionCategories()->where('id', $request->input('category_id'))->exists()) {
            return redirect()->back()->withErrors([
                'category_id' => 'Invalid category',
            ]);
        }

        return $this->handle($request->feed_url, $request->user(), $request->category_id);
    }

    public function handle(string $requested_feed_url, ?User $attachedUser, ?int $category_id, bool $force = false, ?string $fallback_name = null)
    {
        $error = null;

        // TODO fetch limit
        $crawledFeed = \Feeds::make(feedUrl: $requested_feed_url);
        if ($crawledFeed->error()) {
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

            if (! $force) {
                return redirect()->back()->withErrors([
                    'feed_url' => 'Failed to fetch feed: '.$error,
                ]);
            }

        }

        $feed_url = $crawledFeed->feed_url;

        if (Feed::where('feed_url', $feed_url)->exists()) {
            if ($attachedUser) {
                if ($attachedUser->feeds()->where('feed_url', $feed_url)->exists()) {
                    return redirect()->back()->withErrors([
                        'feed_url' => "You're already following this feed",
                    ]);
                } else {
                    $attachedUser->feeds()->attach(
                        Feed::where('feed_url', $feed_url)->first(),
                        ['category_id' => $category_id]
                    );

                    return redirect()->back();
                }
            }

            return redirect()->back()->withErrors([
                'feed_url' => 'Feed already exists',
            ]);
        }

        // Handle feeds without site link such as https://aggregate.stitcher.io/rss
        $site_url = $crawledFeed->get_link() ?? $feed_url;

        $favicon_url = GetFaviconURL::run($site_url);

        $feed = Feed::create([
            'name' => $crawledFeed->get_title() ?? $fallback_name ?? $site_url,
            'feed_url' => $feed_url,
            'site_url' => $site_url,
            'favicon_url' => $favicon_url,
            'last_successful_refresh_at' => $error ? null : now(),
            'last_failed_refresh_at' => $error ? now() : null,
            'last_error_message' => $error,
        ]);

        if ($attachedUser) {
            $attachedUser->feeds()->attach($feed, ['category_id' => $category_id]);
        }

        // TODO single insert
        $entries = $crawledFeed->get_items();

        $newFeedEntries = [];

        foreach ($entries as $entry) {
            if (strlen($entry->get_author()?->get_name() ?? '') > 255) {
                // 255 is arbitrary, but if the author is that long, it's probably a bug
                // example: https://x.com/fuolpit/status/1873790603768553905

                \Sentry\withScope(function (\Sentry\State\Scope $scope) use ($feed, $entry): void {
                    $scope->setContext('feed', [
                        'url' => $feed->feed_url,
                        'id' => $feed->id,
                    ]);
                    $scope->setContext('entry', [
                        'author' => $entry->get_author()?->get_name(),
                        'title' => $entry->get_title(),
                        'url' => $entry->get_permalink(),
                    ]);

                    \Sentry\captureMessage('Author name too long');
                });
            }

            $title = str_replace('&amp;', '&', $entry->get_title());
            $title = substr($title, 0, 255);
            $newFeedEntries[] = [
                'title' => $title,
                'url' => $entry->get_permalink(),
                'content' => $entry->get_content(),
                'author' => substr($entry->get_author()?->get_name() ?? '', 0, 255),
                'published_at' => $entry->get_date('Y-m-d H:i:s'),
                'feed_id' => $feed->id,
                'created_at' => now(),
                'updated_at' => now(),
            ];
        }

        foreach (array_chunk($newFeedEntries, 100) as $chunk) {
            $feed->entries()->insert($chunk);
        }

        return redirect()->route('feeds.index', ['feed' => $feed->id]);
    }
}
