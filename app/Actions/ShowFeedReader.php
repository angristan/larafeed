<?php

declare(strict_types=1);

namespace App\Actions;

use App\Actions\Entry\ProxifyImagesInHTML;
use App\Actions\Entry\SummarizeEntryWithLLM;
use App\Actions\Favicon\BuildProxifiedFaviconURL;
use App\Models\Entry;
use App\Models\Feed;
use DDTrace\Trace;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Inertia\Inertia;
use Lorisleiva\Actions\Concerns\AsAction;

class ShowFeedReader
{
    use AsAction;

    #[Trace(name: 'reader.show', tags: ['domain' => 'reader'])]
    public function asController(Request $request): \Inertia\Response
    {
        $span = function_exists('DDTrace\active_span') ? \DDTrace\active_span() : null;
        if ($span) {
            $span->meta['user.id'] = (string) Auth::id();
            if ($request->query('feed')) {
                $span->meta['reader.feed_id'] = (string) $request->query('feed');
            }
            if ($request->query('entry')) {
                $span->meta['reader.entry_id'] = (string) $request->query('entry');
            }
            if ($request->query('filter')) {
                $span->meta['reader.filter'] = (string) $request->query('filter');
            }
            if ($request->query('category')) {
                $span->meta['reader.category_id'] = (string) $request->query('category');
            }
        }
        $feed_id = $request->query('feed');
        $entry_id = $request->query('entry');
        $filter = $request->query('filter');
        $order_by = 'published_at';
        $order_direction = 'desc';
        $category_id = $request->query('category');

        // Handle sorting options
        $allowed_sort_fields = ['published_at', 'created_at', 'balanced'];
        if (in_array($request->query('order_by'), $allowed_sort_fields)) {
            $order_by = $request->query('order_by');
        }

        // Handle sort direction
        if (in_array($request->query('order_direction'), ['asc', 'desc'])) {
            $order_direction = $request->query('order_direction');
        }

        $getFeedsFn = function () {
            $userId = Auth::id();

            return Auth::user()
                ->feeds()
                ->orderBy('name')
                ->join('subscription_categories', 'feed_subscriptions.category_id', '=', 'subscription_categories.id')
                ->select([
                    'feeds.id',
                    'feeds.name',
                    'feeds.feed_url',
                    'feeds.site_url',
                    'feeds.favicon_url',
                    'feeds.favicon_is_dark',
                    'feeds.last_successful_refresh_at',
                    'feeds.last_failed_refresh_at',
                    'subscription_categories.id as category_id',
                    'feed_subscriptions.filter_rules',
                    \DB::raw("(
                        SELECT COUNT(*)
                        FROM entries
                        LEFT JOIN entry_interactions ON entries.id = entry_interactions.entry_id
                            AND entry_interactions.user_id = {$userId}
                        WHERE entries.feed_id = feeds.id
                            AND entry_interactions.filtered_at IS NULL
                    ) as entries_count"),
                ])
                ->get()->map(fn (Feed $feed) => [
                    'id' => $feed->id,
                    'name' => $feed->subscription->custom_feed_name ?? $feed->name,
                    'original_name' => $feed->name,
                    'feed_url' => $feed->feed_url,
                    'site_url' => $feed->site_url,
                    'favicon_url' => $feed->favicon_url(),
                    'favicon_is_dark' => $feed->favicon_is_dark,
                    'entries_count' => $feed['entries_count'],
                    'last_successful_refresh_at' => $feed->last_successful_refresh_at,
                    'last_failed_refresh_at' => $feed->last_failed_refresh_at,
                    'category_id' => $feed['category_id'],
                    'filter_rules' => $feed->subscription->filter_rules,
                ]);
        };

        $getEntriesFn = function () use ($feed_id, $filter, $order_by, $order_direction, $category_id) {
            return Entry::query()
               // Apply optional filters
                ->when($feed_id, fn ($query) => $query->where('entries.feed_id', $feed_id))
                ->when($filter === 'unread', fn ($query) => $query->whereNull('entry_interactions.read_at'))
                ->when($filter === 'read', fn ($query) => $query->whereNotNull('entry_interactions.read_at'))
                ->when($filter === 'favorites', fn ($query) => $query->whereNotNull('entry_interactions.starred_at'))
               // Exclude filtered entries
                ->whereNull('entry_interactions.filtered_at')
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
                    'entry_interactions.filtered_at',
                    'feeds.name as feed_name',
                    'feed_subscriptions.custom_feed_name as feed_custom_name',
                    'feeds.favicon_url as feed_favicon_url',
                    'feeds.favicon_is_dark as feed_favicon_is_dark',
                ])
                ->when($order_by === 'balanced', function ($query) use ($order_direction) {
                    // Balanced algorithm: boost posts from feeds with fewer recent entries
                    return $query->orderByRaw('
                        (EXTRACT(EPOCH FROM entries.published_at) / 86400) -
                        ((SELECT COUNT(*)
                          FROM entries as e2
                          WHERE e2.feed_id = entries.feed_id
                          AND e2.published_at >= NOW() - INTERVAL \'7 days\') * 2) '.
                        ($order_direction === 'asc' ? 'ASC' : 'DESC')
                    );
                }, function ($query) use ($order_by, $order_direction) {
                    return $query->orderBy('entries.'.$order_by, $order_direction);
                })
                ->paginate(perPage: 30)
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
                        'name' => $entry['feed_custom_name'] ?? $entry['feed_name'],
                        'favicon_url' => BuildProxifiedFaviconURL::run($entry['feed_favicon_url']),
                        'favicon_is_dark' => $entry['feed_favicon_is_dark'],
                    ],
                ]);
        };

        $getCurrentEntryFn = function () use ($request, $entry_id): Entry|null {
            if (! $entry_id) {
                return null;
            }

            $requestedEntry = Entry::forUser(Auth::user())->firstWhere('id', $entry_id);
            if (! $requestedEntry) {
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
                ->with('feed:id,name,favicon_url,favicon_is_dark')
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

            if ($currentEntry->content) {
                $currentEntry->content = ProxifyImagesInHTML::run($currentEntry->content);
            }

            if ($currentEntry['custom_feed_name']) {
                $currentEntry->feed->name = $currentEntry['custom_feed_name'];
            }

            $currentEntry->feed->favicon_url = BuildProxifiedFaviconURL::run($currentEntry->feed->favicon_url);

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

            $entry = Entry::forUser(Auth::user())->firstWhere('id', $entry_id);
            if (! $entry) {
                return null;
            }

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
                ->whereNull('entry_interactions.filtered_at')
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
                ->whereNull('entry_interactions.filtered_at')
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
