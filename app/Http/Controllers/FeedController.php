<?php

namespace App\Http\Controllers;

use App\Models\Entry;
use App\Models\Feed;
use Illuminate\Http\Request;
use Inertia\Inertia;

class FeedController extends Controller
{
    /**
     * Display a listing of the resource.
     */
    public function index(Request $request): \Inertia\Response
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
        return Inertia::render('Feeds', [
            'feeds' => $feeds,
            'entries' => $entries,
            'currententry' => fn () => Entry::whereId($request->query('entry'))->first(),
        ]);
    }
}
