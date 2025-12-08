<?php

declare(strict_types=1);

namespace App\Actions\Entry;

use App\Models\Entry;
use App\Models\EntryInteraction;
use App\Models\FeedSubscription;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Lorisleiva\Actions\Concerns\AsAction;

class ApplySubscriptionFilters
{
    use AsAction;

    /**
     * Apply filter rules to entries for a specific subscription.
     * This will mark matching entries as filtered and unmark entries that no longer match.
     *
     * @param  Collection<int, Entry>|null  $entries  If null, re-evaluates all entries for this feed
     */
    public function handle(FeedSubscription $subscription, ?Collection $entries = null): void
    {
        $filterRules = $subscription->filter_rules;

        // Handle case where filter_rules comes as JSON string (pivot model cast issue)
        // @phpstan-ignore function.impossibleType (Pivot model casts don't always work)
        if (is_string($filterRules)) {
            $filterRules = json_decode($filterRules, true);
        }

        $userId = $subscription->user_id;
        $feedId = $subscription->feed_id;

        // If no specific entries provided, get all entries for this feed
        if ($entries === null) {
            $entries = Entry::where('feed_id', $feedId)->get();
        }

        if ($entries->isEmpty()) {
            return;
        }

        $toFilter = [];
        $toUnfilter = [];
        $now = now();

        foreach ($entries as $entry) {
            $shouldFilter = EvaluateEntryFilter::run($entry, $filterRules);

            if ($shouldFilter) {
                $toFilter[] = [
                    'user_id' => $userId,
                    'entry_id' => $entry->id,
                    'filtered_at' => $now,
                    'read_at' => null,
                    'starred_at' => null,
                    'archived_at' => null,
                    'created_at' => $now,
                    'updated_at' => $now,
                ];
            } else {
                $toUnfilter[] = $entry->id;
            }
        }

        DB::transaction(function () use ($toFilter, $toUnfilter, $userId) {
            // Mark entries as filtered and clear other interactions
            if (! empty($toFilter)) {
                EntryInteraction::upsert(
                    $toFilter,
                    ['user_id', 'entry_id'],
                    ['filtered_at', 'read_at', 'starred_at', 'archived_at', 'updated_at']
                );
            }

            // Unmark entries that no longer match filters
            if (! empty($toUnfilter)) {
                EntryInteraction::where('user_id', $userId)
                    ->whereIn('entry_id', $toUnfilter)
                    ->whereNotNull('filtered_at')
                    ->update(['filtered_at' => null, 'updated_at' => now()]);
            }
        });
    }

    /**
     * Apply filters for newly created entries to all subscribers of a feed.
     *
     * @param  Collection<int, Entry>  $entries
     */
    public function forNewEntries(int $feedId, Collection $entries): void
    {
        if ($entries->isEmpty()) {
            return;
        }

        // Get all subscriptions with filter rules for this feed
        $subscriptions = FeedSubscription::where('feed_id', $feedId)
            ->whereNotNull('filter_rules')
            ->get();

        foreach ($subscriptions as $subscription) {
            $this->handle($subscription, $entries);
        }
    }
}
