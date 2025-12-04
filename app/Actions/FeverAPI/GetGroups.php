<?php

declare(strict_types=1);

namespace App\Actions\FeverAPI;

use App\Models\SubscriptionCategory;
use Illuminate\Support\Facades\Auth;

class GetGroups extends BaseFeverAction
{
    public function handle()
    {
        $groups = Auth::user()->subscriptionCategories()
            ->select(['id', 'name as title'])
            ->get();

        return array_merge($this->getBaseResponse(), [
            'groups' => $groups,
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
            'feed_ids' => $category->feedsSubscriptions->pluck('feed_id')->join(','),
        ])->all();
    }
}
