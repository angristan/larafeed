<?php

declare(strict_types=1);

namespace App\Actions\Feed;

use App\Actions\Category\CreateCategory;
use App\Actions\Favicon\GetFaviconURL;
use App\Models\Feed;
use App\Models\FeedRefresh;
use App\Models\SubscriptionCategory;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Lorisleiva\Actions\Concerns\AsAction;

class CreateNewFeed
{
    use AsAction;

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'feed_url' => ['required', 'max:255', 'url', 'active_url'],
            'category_id' => ['nullable', 'integer', 'exists:subscription_categories,id', 'required_without:category_name'],
            'category_name' => ['nullable', 'string', 'max:20', 'required_without:category_id'],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function getValidationMessages(): array
    {
        return [
            'feed_url.required' => 'Please enter a feed URL',
            'feed_url.url' => 'Please enter a valid URL',
            'feed_url.active_url' => 'Please ensure the URL is reachable',
            'feed_url.max' => 'Please enter a URL that is less than 255 characters',
            'category_id.required_without' => 'Please select a category',
            'category_id.exists' => 'Please select a valid category',
            'category_name.required_without' => 'Please enter a category name',
            'category_name.max' => 'Please enter a category name that is less than 20 characters',
        ];
    }

    public function asController(Request $request): \Illuminate\Http\RedirectResponse
    {
        $categoryIdInput = $request->input('category_id');
        $categoryName = trim((string) $request->input('category_name', ''));
        $resolvedCategoryId = null;

        if ($categoryName !== '') {
            if (
                SubscriptionCategory::query()
                    ->where('user_id', Auth::id())
                    ->where('name', $categoryName)
                    ->exists()
            ) {
                return redirect()->back()->withErrors([
                    'category_name' => 'You already have a category with that name',
                ]);
            }

            $newCategory = CreateCategory::run(
                $request->user(),
                $categoryName
            );

            $resolvedCategoryId = $newCategory->id;
        } elseif ($categoryIdInput !== null) {
            $resolvedCategoryId = (int) $categoryIdInput;

            if (
                ! Auth::user()
                    ->subscriptionCategories()
                    ->where('id', $resolvedCategoryId)
                    ->exists()
            ) {
                return redirect()->back()->withErrors([
                    'category_id' => 'Invalid category',
                ]);
            }
        } else {
            return redirect()->back()->withErrors([
                'category_id' => 'Please select a category',
            ]);
        }

        return $this->handle($request->feed_url, $request->user(), $resolvedCategoryId);
    }

    public function handle(string $requested_feed_url, ?User $attachedUser, ?int $category_id, bool $force = false, ?string $fallback_name = null): \Illuminate\Http\RedirectResponse
    {
        $error = null;

        // TODO fetch limit
        $crawledFeed = \Feeds::make(feedUrl: [$requested_feed_url]);
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

        $feed_name = $crawledFeed->get_title() ?? $fallback_name ?? $site_url;
        $feed_name = str_replace('&amp;', '&', $feed_name);

        $refreshTimestamp = now();

        $trimmedError = $error ? Str::limit($error, 255, '') : null;

        $feed = Feed::create([
            'name' => $feed_name,
            'feed_url' => $feed_url,
            'site_url' => $site_url,
            'favicon_url' => $favicon_url,
            'favicon_updated_at' => $favicon_url ? now() : null,
            'last_successful_refresh_at' => $error ? null : $refreshTimestamp,
            'last_failed_refresh_at' => $error ? $refreshTimestamp : null,
            'last_error_message' => $trimmedError,
        ]);

        if ($attachedUser) {
            $attachedUser->feeds()->attach($feed, ['category_id' => $category_id]);
        }

        // Only get last 20 because $entry->get_content() is very slow
        // so for feeds with many full-cotent entries, it can take a while
        $entries = $crawledFeed->get_items(0, 20);

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

        $feed->entries()->insert($newFeedEntries);

        FeedRefresh::create([
            'feed_id' => $feed->id,
            'refreshed_at' => $refreshTimestamp,
            'was_successful' => ! $error,
            'entries_created' => count($newFeedEntries),
            'error_message' => $error,
        ]);

        return redirect()->route('feeds.index', ['feed' => $feed->id]);
    }
}
