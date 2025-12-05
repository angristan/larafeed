<?php

declare(strict_types=1);

namespace App\Actions\GoogleReaderAPI;

use App\Models\Feed;
use Illuminate\Support\Facades\Auth;
use Lorisleiva\Actions\Concerns\AsAction;

class GetSubscriptionList
{
    use AsAction;

    public function asController(): \Illuminate\Http\JsonResponse
    {
        /** @var \App\Models\User $user */
        $user = Auth::user();

        $feeds = $user->feeds()
            ->join('subscription_categories', 'feed_subscriptions.category_id', '=', 'subscription_categories.id')
            ->select([
                'feeds.id',
                'feeds.feed_url',
                'feeds.site_url',
                'feeds.name',
                'subscription_categories.name as category_name',
            ])
            ->get()
            ->map(fn (Feed $feed) => [
                'id' => 'feed/'.$feed->id,
                'url' => $feed->feed_url,
                'htmlUrl' => $feed->site_url,
                'title' => $feed->name,
                'categories' => [
                    [
                        'id' => 'user/'.$user->id.'/label/'.$feed['category_name'],
                        'label' => $feed['category_name'],
                        'type' => 'folder',
                    ],
                ],
                'iconUrl' => '',
            ]);

        return response()->json([
            'subscriptions' => $feeds,
        ]);
    }
}
