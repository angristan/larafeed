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

    public function handle(User $user, int $feedId): void
    {
        $user->entriesInteracted()->where('feed_id', $feedId)->delete();
        $user->feeds()->detach($feedId);

        // Delete feed if no more users are subscribed to it
        $feed = Feed::find($feedId);
        if ($feed && $feed->users->isEmpty()) {
            $feed->delete();
        }
    }

    public function asController(int $feedId): \Illuminate\Http\RedirectResponse
    {
        /** @var \App\Models\User $user */
        $user = Auth::user();

        $this->handle($user, $feedId);

        return redirect()->back();
    }
}
