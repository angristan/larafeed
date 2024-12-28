<?php

namespace App\Actions;

use App\Models\Feed;
use App\Models\User;
use Illuminate\Support\Facades\Auth;
use Lorisleiva\Actions\Concerns\AsAction;

class UnsubscribeFromFeed
{
    use AsAction;

    public function handle(User $user, int $feedId): void
    {
        $user->entriesInterracted()->where('feed_id', $feedId)->delete();
        $user->feeds()->detach($feedId);

        // Delete feed if no more users are subscribed to it
        if (Feed::find($feedId)->users->isEmpty()) {
            Feed::find($feedId)->delete();
        }
    }

    public function asController(int $feedId)
    {
        $this->handle(Auth::user(), $feedId);

        return to_route('feeds.index');
    }
}
