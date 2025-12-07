<?php

declare(strict_types=1);

namespace App\Actions\Feed;

use App\Models\Feed;
use App\Models\User;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Lorisleiva\Actions\Concerns\AsAction;

class UnsubscribeFromFeed
{
    use AsAction;

    public function handle(User $user, Feed $feed): void
    {
        DB::transaction(function () use ($user, $feed) {
            $user->entriesInterracted()->where('feed_id', $feed->id)->delete();
            $user->feeds()->detach($feed->id);

            // Delete feed if no more users are subscribed to it
            $feed->refresh();
            if ($feed->users->isEmpty()) {
                $feed->delete();
            }
        });
    }

    public function asController(int $feedId): \Illuminate\Http\RedirectResponse
    {
        $feed = Feed::forUser(Auth::user())->find($feedId);

        if (! $feed) {
            return redirect()->back()->withErrors('You are not subscribed to this feed');
        }

        $this->handle(Auth::user(), $feed);

        return redirect()->back();
    }
}
