<?php

namespace App\Actions;

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

        $feeds = Auth::user()
            ->feeds()
            ->withCount('entries')
            ->get()->map(fn (Feed $feed) => [
                'id' => $feed->id,
                'name' => $feed->subscription?->custom_feed_name ?? $feed->name,
                'site_url' => $feed->site_url,
                'favicon_url' => $feed->favicon_url,
                'entries_count' => $feed->entries_count,
                'last_successful_refresh_at' => $feed->last_successful_refresh_at,
                'last_failed_refresh_at' => $feed->last_failed_refresh_at,
            ]);

        $entries = Entry::query()
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
                'entry_interactions.read_at',
                'entry_interactions.starred_at',
                'entry_interactions.archived_at',
                'feeds.id as feed_id',
                'feeds.name as feed_name',
                'feeds.favicon_url as feed_favicon_url',

            ])
            // Fetch the feed for each entry
            ->orderByDesc('entries.published_at')
            ->limit(100)
            ->get()
            ->map(fn ($entry) => [
                'id' => $entry->id,
                'title' => $entry->title,
                'url' => $entry->url,
                'author' => $entry->author,
                'content' => $entry->content,
                'published_at' => $entry->published_at,
                'read_at' => $entry->read_at,
                'starred_at' => $entry->starred_at,
                'archived_at' => $entry->archived_at,
                'feed' => [
                    'id' => $entry->feed_id,
                    'name' => $entry->feed_name,
                    'favicon_url' => $entry->feed_favicon_url,
                ],
            ]);

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

            // Mark as read unless explicitly requested not to
            if (! $request->query('skipSetRead')) {
                $requestedEntry->markAsRead(Auth::user());
            }

            // Merge entry with feed data and user interactions
            return Entry::query()
                ->with('feed:id,name,favicon_url')
                ->join('entry_interactions', function ($join) {
                    $join->on('entries.id', '=', 'entry_interactions.entry_id')
                        ->where('entry_interactions.user_id', '=', Auth::id());
                })
                ->where('entries.id', $entry_id)
                ->select([
                    'entries.*',
                    'entry_interactions.read_at',
                    'entry_interactions.starred_at',
                    'entry_interactions.archived_at',
                ])
                ->first();
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

        // TODO https://laravel.com/docs/9.x/eloquent-resources
        return Inertia::render('Reader/Reader', [
            'feeds' => $feeds,
            'entries' => $entries,
            'currententry' => $getCurrentEntryFn,
            'unreadEntriesCount' => $unreadEntriesCountFn,
            'readEntriesCount' => $readEntriesCountFn,
        ]);
    }
}
