<?php

declare(strict_types=1);

namespace App\Actions\Feed;

use App\Actions\Category\CreateCategory;
use App\Actions\Entry\ApplySubscriptionFilters;
use App\Actions\Favicon\GetFaviconURL;
use App\Models\Feed;
use App\Models\SubscriptionCategory;
use App\Models\User;
use App\Rules\SafeFeedUrl;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
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
            'feed_url' => ['required', 'max:255', 'url', 'active_url', new SafeFeedUrl],
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
                SubscriptionCategory::forUser(Auth::user())
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
                ! SubscriptionCategory::forUser(Auth::user())
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
        $result = FetchFeed::run($requested_feed_url);

        if (! $result['success']) {
            if (! $force) {
                return redirect()->back()->withErrors([
                    'feed_url' => 'Failed to fetch feed: '.$result['error'],
                ]);
            }

            // Force mode (OPML import): skip this feed silently
            return redirect()->back();
        }

        $crawledFeed = $result['feed'];
        $feed_url = $crawledFeed->feed_url ?? $requested_feed_url;

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

        $startedAt = now();

        $feed = DB::transaction(function () use ($feed_name, $feed_url, $site_url, $favicon_url, $attachedUser, $category_id) {
            $feed = Feed::create([
                'name' => $feed_name,
                'feed_url' => $feed_url,
                'site_url' => $site_url,
                'favicon_url' => $favicon_url,
                'favicon_updated_at' => $favicon_url ? now() : null,
            ]);

            if ($attachedUser) {
                $attachedUser->feeds()->attach($feed, ['category_id' => $category_id]);
            }

            return $feed;
        });

        // Ingest entries and record refresh (limit to 20 for performance - get_content() is slow)
        $newEntries = IngestFeedEntries::run($feed, $crawledFeed->get_items(), limit: 20);
        RecordFeedRefresh::run($feed, $startedAt, success: true, entriesCreated: $newEntries->count());

        if ($newEntries->isNotEmpty()) {
            ApplySubscriptionFilters::make()->forNewEntries($feed->id, $newEntries);
        }

        return redirect()->route('feeds.index', ['feed' => $feed->id]);
    }
}
