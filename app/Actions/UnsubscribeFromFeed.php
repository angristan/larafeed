<?php

namespace App\Actions;

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
    }

    public function asController(int $feedId)
    {
        $this->handle(Auth::user(), $feedId);

        return to_route('feeds.index');
    }
}
