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
        $search_input = $request->query('search');

        $feeds = Feed::query($search_input)->withCount('entries')->get()->map(function (Feed $feed) {
            return $feed->only([
                'id',
                'name',
                'feed_url',
                'site_url',
                'favicon_url',
                'last_crawled_at',
                'entries_count',
            ]);
        });

        // TODO https://laravel.com/docs/9.x/eloquent-resources
        return Inertia::render('Feeds', [
            'filters' => [
                'search' => $search_input,
            ],
            'feeds' => $feeds,
            'entries' => Entry::query()->orderByDesc('published_at')->with('feed:id,favicon_url,name')->latest()->limit(100)->get(),
            'currententry' => Inertia::lazy(fn () => Entry::whereId($request->query('entry'))->first()),
        ]);
    }
}
