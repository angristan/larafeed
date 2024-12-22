<?php

namespace App\Actions;

use App\Models\Entry;
use App\Models\Feed;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Lorisleiva\Actions\Concerns\AsAction;

class ShowFeedReader
{
    use AsAction;

    /* This action is only a controller for the main user facing view */
    public function handle(Request $request): \Inertia\Response
    {
        $feed_id = $request->query('feed');

        $feeds = Feed::query()->withCount('entries')->get();

        $entries = Entry::query()
            ->when($feed_id, fn ($query) => $query->where('feed_id', $feed_id))
            ->orderByDesc('published_at')
            ->with('feed:id,favicon_url,name')
            ->latest()
            ->limit(100)
            ->get();

        // TODO https://laravel.com/docs/9.x/eloquent-resources
        return Inertia::render('Reader', [
            'feeds' => $feeds,
            'entries' => $entries,
            'currententry' => fn () => Entry::whereId($request->query('entry'))->first(),
        ]);
    }
}
