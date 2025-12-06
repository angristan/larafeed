<?php

declare(strict_types=1);

namespace App\Actions\Feed;

use App\Models\Feed;
use App\Models\User;
use Illuminate\Support\Facades\Auth;
use Lorisleiva\Actions\Concerns\AsAction;

class UnsubscribeFromFeed
{
    use AsAction;

    public function handle(User $user, int $feedId): bool
    {
        // Verify user is subscribed to this feed
        if (! $user->feeds()->where('id', $feedId)->exists()) {
            return false;
        }

        $user->entriesInterracted()->where('feed_id', $feedId)->delete();
        $user->feeds()->detach($feedId);

        // Delete feed if no more users are subscribed to it
        $feed = Feed::find($feedId);
        if ($feed && $feed->users->isEmpty()) {
            $feed->delete();
        }

        return true;
    }

    public function asController(int $feedId): \Illuminate\Http\RedirectResponse
    {
        if (! $this->handle(Auth::user(), $feedId)) {
            return redirect()->back()->withErrors('You are not subscribed to this feed');
        }

        return redirect()->back();
    }
}
