<?php

declare(strict_types=1);

namespace App\Actions\User;

use App\Models\EntryInteraction;
use App\Models\FeedSubscription;
use App\Models\SubscriptionCategory;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Lorisleiva\Actions\Concerns\AsAction;

class WipeAccount
{
    use AsAction;

    public function handle(Request $request)
    {
        EntryInteraction::where('user_id', Auth::user()->id)->delete();

        $feeds = Auth::user()->feeds()->select('feeds.id')->get();

        FeedSubscription::where('user_id', Auth::user()->id)->delete();

        // Delete feed if no other user is subscribed to it
        foreach ($feeds as $feed) {
            if (FeedSubscription::where('feed_id', $feed->id)->count() === 0) {
                $feed->delete();
            }
        }

        SubscriptionCategory::where('user_id', Auth::user()->id)->delete();

        return redirect()->back();

    }
}
