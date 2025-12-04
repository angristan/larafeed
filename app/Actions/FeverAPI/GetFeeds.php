<?php

declare(strict_types=1);

namespace App\Actions\FeverAPI;

use App\Models\SubscriptionCategory;
use Carbon\Carbon;
use Illuminate\Support\Facades\Auth;

class GetFeeds extends BaseFeverAction
{
    /**
     * @return array<string, mixed>
     */
    public function handle(): array
    {
        $feeds = Auth::user()->feeds()
            ->select([
                'feeds.id',
                'feeds.favicon_url as favicon_id',
                'feeds.name as title',
                'feeds.feed_url as url',
                'feeds.site_url',
                'feeds.last_successful_refresh_at as last_updated_on_time',
            ])
            ->get()
            ->map(fn ($feed) => [
                'id' => $feed->id,
                'favicon_id' => $feed['favicon_id'],
                'title' => $feed->subscription->custom_feed_name ?? $feed['title'],
                'url' => $feed['url'],
                'site_url' => $feed->site_url,
                'is_spark' => 0,
                'last_updated_on_time' => $feed['last_updated_on_time'] ? Carbon::parse($feed['last_updated_on_time'])->timestamp : 0,
            ]);

        return array_merge($this->getBaseResponse(), [
            'feeds' => $feeds,
            'feeds_groups' => $this->getFeedsGroups(),
        ]);
    }

    /**
     * @return list<array{group_id: int, feed_ids: string}>
     */
    private function getFeedsGroups(): array
    {
        $categories = Auth::user()->subscriptionCategories()
            ->with('feedsSubscriptions')
            ->get();

        return $categories->map(fn (SubscriptionCategory $category): array => [
            'group_id' => $category->id,
            'feed_ids' => $category->feedsSubscriptions()->pluck('feed_id')->join(','),
        ])->all();
    }
}
