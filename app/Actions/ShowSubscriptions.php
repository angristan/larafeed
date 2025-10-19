<?php

declare(strict_types=1);

namespace App\Actions;

use App\Actions\Favicon\BuildProfixedFaviconURL;
use App\Models\Feed;
use App\Models\FeedRefresh;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Inertia\Inertia;
use Lorisleiva\Actions\Concerns\AsAction;

class ShowSubscriptions
{
    use AsAction;

    public function handle(Request $request): \Inertia\Response
    {
        /** @var User $user */
        $user = Auth::user();

        $categories = $user->subscriptionCategories()->orderBy('name')->get();

        $feedsCollection = $user
            ->feeds()
            ->with([
                'refreshes' => fn ($query) => $query->latest('refreshed_at')->limit(20),
            ])
            ->withCount('entries')
            ->orderBy('feeds.name')
            ->get();

        $feedsCollection->loadMissing('subscription.category');

        $feeds = $feedsCollection
            ->map(function (Feed $feed) {
                $category = $feed->subscription?->category;

                $refreshes = $feed->refreshes
                    ->map(fn (FeedRefresh $refresh) => [
                        'id' => $refresh->id,
                        'refreshed_at' => $refresh->refreshed_at?->toIso8601String(),
                        'was_successful' => $refresh->was_successful,
                        'entries_created' => $refresh->entries_created,
                        'error_message' => $refresh->error_message,
                    ])
                    ->values();

                return [
                    'id' => $feed->id,
                    'name' => $feed->subscription?->custom_feed_name ?? $feed->name,
                    'original_name' => $feed->name,
                    'feed_url' => $feed->feed_url,
                    'site_url' => $feed->site_url,
                    'favicon_url' => BuildProfixedFaviconURL::run($feed->favicon_url),
                    'entries_count' => $feed->entries_count,
                    'last_successful_refresh_at' => $feed->last_successful_refresh_at,
                    'last_failed_refresh_at' => $feed->last_failed_refresh_at,
                    'last_error_message' => $feed->last_error_message,
                    'category' => $category ? [
                        'id' => $category->id,
                        'name' => $category->name,
                    ] : null,
                    'refreshes' => $refreshes,
                ];
            })
            ->values()
            ->all();

        return Inertia::render('Subscriptions', [
            'feeds' => $feeds,
            'categories' => $categories
                ->map(fn ($category) => [
                    'id' => $category->id,
                    'name' => $category->name,
                ])
                ->values()
                ->all(),
        ]);
    }
}
