<?php

declare(strict_types=1);

namespace App\Actions\FeverAPI;

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

    private function getFeedsGroups()
    {
        return Auth::user()->subscriptionCategories()
            ->with('feedsSubscriptions')
            ->get()
            ->map(fn ($category) => [
                'group_id' => $category->id,
                'feed_ids' => $category->feedsSubscriptions->pluck('feed_id')->join(','),
            ]);
    }
}
