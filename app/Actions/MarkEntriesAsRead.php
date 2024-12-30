<?php

declare(strict_types=1);

namespace App\Actions;

use App\Models\Entry;
use App\Models\EntryInteraction;
use App\Models\FeedSubscription;
use Illuminate\Http\RedirectResponse;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Lorisleiva\Actions\Concerns\AsAction;

class MarkEntriesAsRead
{
    use AsAction;

    public function asController(int $feedId): RedirectResponse
    {
        if (! $this->isCurrentUserSubscribed($feedId)) {
            return redirect()
                ->back()
                ->withErrors('You are not subscribed to this feed.');
        }

        DB::transaction(function () use ($feedId) {
            $this->updateExistingInteractions($feedId);
            $this->createNewInteractions($feedId);
        });

        return redirect()->back();
    }

    /**
     * Verify user is subscribed to the feed
     */
    private function isCurrentUserSubscribed(int $feedId): bool
    {
        return FeedSubscription::query()
            ->where('feed_id', $feedId)
            ->where('user_id', Auth::id())
            ->exists();
    }

    /**
     * Update existing unread interactions to read
     */
    private function updateExistingInteractions(int $feedId): void
    {
        EntryInteraction::query()
            ->join('entries', 'entries.id', '=', 'entry_interactions.entry_id')
            ->where('entries.feed_id', $feedId)
            ->where('entry_interactions.user_id', Auth::id())
            ->whereNull('entry_interactions.read_at')
            ->update(['entry_interactions.read_at' => now()]);
    }

    /**
     * Create new read interactions for entries without interactions
     */
    private function createNewInteractions(int $feedId)
    {
        $entriesWithoutInteraction = Entry::query()
            ->select('id')
            ->where('feed_id', $feedId)
            ->whereNotExists(function ($query) {
                $query->select('id')
                    ->from('entry_interactions')
                    ->whereColumn('entry_interactions.entry_id', 'entries.id')
                    ->where('entry_interactions.user_id', Auth::id());
            })
            ->pluck('id');

        if ($entriesWithoutInteraction->isEmpty()) {
            return;
        }

        $now = now();
        $userId = Auth::id();

        $interactions = $entriesWithoutInteraction->map(
            fn (int $entryId) => [
                'user_id' => $userId,
                'entry_id' => $entryId,
                'read_at' => $now,
                'created_at' => $now,
                'updated_at' => $now,
            ]
        )->toArray();

        EntryInteraction::insert($interactions);
    }
}
