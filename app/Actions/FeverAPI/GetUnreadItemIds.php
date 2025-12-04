<?php

declare(strict_types=1);

namespace App\Actions\FeverAPI;

use App\Models\Entry;
use Illuminate\Support\Facades\Auth;

class GetUnreadItemIds extends BaseFeverAction
{
    /**
     * @return array<string, mixed>
     */
    public function handle(): array
    {
        $unreadIds = Entry::query()
            ->join('feed_subscriptions', function ($join) {
                $join->on('entries.feed_id', '=', 'feed_subscriptions.feed_id')
                    ->where('feed_subscriptions.user_id', '=', Auth::id());
            })
            ->leftJoin('entry_interactions', function ($join) {
                $join->on('entries.id', '=', 'entry_interactions.entry_id')
                    ->where('entry_interactions.user_id', '=', Auth::id());
            })
            ->whereNull('entry_interactions.read_at')
            ->pluck('entries.id')
            ->join(',');

        return array_merge($this->getBaseResponse(), [
            'unread_item_ids' => $unreadIds,
        ]);
    }
}
