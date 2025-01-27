<?php

declare(strict_types=1);

namespace App\Actions;

use App\Actions\Entry\SummarizeEntryWithLLM;
use App\Models\Entry;
use App\Models\Feed;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Inertia\Inertia;
use Lorisleiva\Actions\Concerns\AsAction;

class ShowFeedReader
{
    use AsAction;

    /* This action is only a controller for the main user facing view */
    public function handle(Request $request): \Inertia\Response
    {
        $feed_id = $request->query('feed');
        $entry_id = $request->query('entry');
        $filter = $request->query('filter');
        $order_by = 'published_at';
        $category_id = $request->query('category');

        if ($request->query('order_by') === 'created_at') {
            $order_by = 'created_at';
        }

        $getFeedsFn = function () {
            return Auth::user()
                ->feeds()
                ->orderBy('name')
                ->join('subscription_categories', 'feed_subscriptions.category_id', '=', 'subscription_categories.id')
                ->select([
                    'feeds.id',
                    'feeds.name',
                    'feeds.site_url',
                    'feeds.favicon_url',
                    'feeds.last_successful_refresh_at',
                    'feeds.last_failed_refresh_at',
                    'subscription_categories.id as category_id',
                    \DB::raw('(SELECT COUNT(*) FROM entries WHERE entries.feed_id = feeds.id) as entries_count'),
                ])
                ->get()->map(fn (Feed $feed) => [
                    'id' => $feed->id,
                    'name' => $feed->subscription?->custom_feed_name ?? $feed->name,
                    'original_name' => $feed->name,
                    'site_url' => $feed->site_url,
                    'favicon_url' => $feed->favicon_url(),
                    'entries_count' => $feed['entries_count'],
                    'last_successful_refresh_at' => $feed->last_successful_refresh_at,
                    'last_failed_refresh_at' => $feed->last_failed_refresh_at,
                    'category_id' => $feed['category_id'],
                ]);
        };

        $getEntriesFn = function () use ($feed_id, $filter, $order_by, $category_id) {
            return Entry::query()
               // Apply optional filters
                ->when($feed_id, fn ($query) => $query->where('entries.feed_id', $feed_id))
                ->when($filter === 'unread', fn ($query) => $query->whereNull('entry_interactions.read_at'))
                ->when($filter === 'read', fn ($query) => $query->whereNotNull('entry_interactions.read_at'))
                ->when($filter === 'favorites', fn ($query) => $query->whereNotNull('entry_interactions.starred_at'))
               // Only show entries from feeds the user is subscribed to
                ->join('feed_subscriptions', function ($join) {
                    $join->on('entries.feed_id', '=', 'feed_subscriptions.feed_id')
                        ->where('feed_subscriptions.user_id', '=', Auth::id());
                })
                // Only show entries from the requested category
                ->when($category_id, fn ($query) => $query->where('feed_subscriptions.category_id', $category_id))
               // Fetch the user interaction for each entry
                ->leftJoin('entry_interactions', function ($join) {
                    $join->on('entries.id', '=', 'entry_interactions.entry_id')
                        ->where('entry_interactions.user_id', '=', Auth::id());
                })
               // Fetch the feed for each entry
                ->join('feeds', 'entries.feed_id', '=', 'feeds.id')
                ->select([
                    'entries.id',
                    'entries.title',
                    'entries.url',
                    'entries.author',
                    'entries.content',
                    'entries.published_at',
                    'entries.feed_id',
                    'entry_interactions.read_at',
                    'entry_interactions.starred_at',
                    'entry_interactions.archived_at',
                    'feeds.name as feed_name',
                    'feed_subscriptions.custom_feed_name as feed_custom_name',
                    'feeds.favicon_url as feed_favicon_url',
                ])
                ->orderByDesc('entries.'.$order_by)
                ->paginate(perPage: 20)
                ->through(fn ($entry) => [
                    'id' => $entry->id,
                    'title' => $entry->title,
                    'url' => $entry->url,
                    'author' => $entry->author,
                    'content' => $entry->content,
                    'published_at' => $entry->published_at,
                    'read_at' => $entry['read_at'],
                    'starred_at' => $entry['starred_at'],
                    'archived_at' => $entry['archived_at'],
                    'feed' => [
                        'id' => $entry->feed_id,
                        'name' => $entry->feed_custom_name ?? $entry->feed_name,
                        'favicon_url' => BuildProfixedFaviconURL::run($entry['feed_favicon_url']),
                    ],
                ]);
        };

        $getCurrentEntryFn = function () use ($request, $entry_id): Entry|null {
            if (! $entry_id) {
                return null;
            }

            $requestedEntry = Entry::whereId($entry_id)->first();
            if (! $requestedEntry) {
                return null;
            }

            // Check if the user has access to the feed
            if (! Auth::user()->feeds()->where('id', $requestedEntry->feed_id)->exists()) {
                return null;
            }

            if ($request->query('read') === 'false') {
                $requestedEntry->markAsUnread(Auth::user());
            }
            if ($request->query('read') === 'true') {
                $requestedEntry->markAsRead(Auth::user());
            }

            // Merge entry with feed data and user interactions
            $currentEntry = Entry::query()
                ->with('feed:id,name,favicon_url')
                ->leftJoin('entry_interactions', function ($join) {
                    $join->on('entries.id', '=', 'entry_interactions.entry_id')
                        ->where('entry_interactions.user_id', '=', Auth::id());
                })
                ->leftJoin('feed_subscriptions', function ($join) {
                    $join->on('entries.feed_id', '=', 'feed_subscriptions.feed_id')
                        ->where('feed_subscriptions.user_id', '=', Auth::id());
                })
                ->where('entries.id', $entry_id)
                ->select([
                    'entries.*',
                    'entry_interactions.read_at',
                    'entry_interactions.starred_at',
                    'entry_interactions.archived_at',
                    'feed_subscriptions.custom_feed_name',
                ])
                ->first();

            if ($currentEntry && $currentEntry->feed && $currentEntry['custom_feed_name']) {
                $currentEntry->feed->name = $currentEntry['custom_feed_name'];
            }

            if ($currentEntry && $currentEntry->feed) {
                $currentEntry->feed->favicon_url = BuildProfixedFaviconURL::run($currentEntry->feed->favicon_url);
            }

            return $currentEntry;
        };

        $getEntrySummaryFn = function () use ($request, $entry_id): string|null {
            // Only summarize if requested
            if ($request->query('summarize') !== 'true') {
                return null;
            }

            if (! $entry_id) {
                return null;
            }

            $requestedEntry = Entry::whereId($entry_id)->first();
            if (! $requestedEntry) {
                return null;
            }

            // Check if the user has access to the feed
            if (! Auth::user()->feeds()->where('id', $requestedEntry->feed_id)->exists()) {
                return null;
            }

            $entry = Entry::whereId($entry_id)->first();

            return SummarizeEntryWithLLM::run($entry);
        };

        $unreadEntriesCountFn = function () {
            return Entry::query()
                ->join('feed_subscriptions', function ($join) {
                    $join->on('entries.feed_id', '=', 'feed_subscriptions.feed_id')
                        ->where('feed_subscriptions.user_id', '=', Auth::id());
                })
                ->leftJoin('entry_interactions', function ($join) {
                    $join->on('entries.id', '=', 'entry_interactions.entry_id')
                        ->where('entry_interactions.user_id', '=', Auth::id());
                })
                ->whereNull('entry_interactions.read_at')
                ->count();
        };

        $readEntriesCountFn = function () {
            return Entry::query()
                ->join('feed_subscriptions', function ($join) {
                    $join->on('entries.feed_id', '=', 'feed_subscriptions.feed_id')
                        ->where('feed_subscriptions.user_id', '=', Auth::id());
                })
                ->leftJoin('entry_interactions', function ($join) {
                    $join->on('entries.id', '=', 'entry_interactions.entry_id')
                        ->where('entry_interactions.user_id', '=', Auth::id());
                })
                ->whereNotNull('entry_interactions.read_at')
                ->count();
        };

        $getUserCategoriesFn = function () {
            return Auth::user()->subscriptionCategories()->get();
        };

        // TODO https://laravel.com/docs/9.x/eloquent-resources
        return Inertia::render('Reader/Reader', [
            'feeds' => $getFeedsFn,
            'entries' => $getEntriesFn,
            'currententry' => $getCurrentEntryFn,
            'unreadEntriesCount' => $unreadEntriesCountFn,
            'readEntriesCount' => $readEntriesCountFn,
            'summary' => Inertia::always($getEntrySummaryFn),
            'categories' => $getUserCategoriesFn,
        ]);
    }
}
