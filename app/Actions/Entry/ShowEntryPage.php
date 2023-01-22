<?php

namespace App\Actions\Entry;

use App\Models\Feed;
use Inertia\Inertia;
use Lorisleiva\Actions\Concerns\AsAction;

class ShowEntryPage
{
    use AsAction;

    /**
     * Show the entry page
     * This action is only meant to be used to return a view
     */
    public function handle(Feed $feed, int $entryId): \Inertia\Response
    {
        $entry = $feed->entries()->findOrFail($entryId);

        // TODO: DTO
        return Inertia::render('Feed/Entry', [
            'feed' => $feed,
            'entry' => $entry,
            // https://inertiajs.com/partial-reloads#lazy-data-evaluation
            'summary' => Inertia::lazy(fn () => SummarizeEntryWithGPTChat::run($entry)),
        ]);
    }
}
