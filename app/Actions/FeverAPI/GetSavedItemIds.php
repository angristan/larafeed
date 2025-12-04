<?php

declare(strict_types=1);

namespace App\Actions\FeverAPI;

use App\Models\Entry;
use Illuminate\Support\Facades\Auth;

class GetSavedItemIds extends BaseFeverAction
{
    /**
     * @return array<string, mixed>
     */
    public function handle(): array
    {
        $savedIds = Entry::query()
            ->join('feed_subscriptions', function ($join) {
                $join->on('entries.feed_id', '=', 'feed_subscriptions.feed_id')
                    ->where('feed_subscriptions.user_id', '=', Auth::id());
            })
            ->join('entry_interactions', function ($join) {
                $join->on('entries.id', '=', 'entry_interactions.entry_id')
                    ->where('entry_interactions.user_id', '=', Auth::id());
            })
            ->whereNotNull('entry_interactions.starred_at')
            ->pluck('entries.id')
            ->join(',');

        return array_merge($this->getBaseResponse(), [
            'saved_item_ids' => $savedIds,
        ]);
    }
}
