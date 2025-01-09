<?php

declare(strict_types=1);

namespace App\Actions\FeverAPI;

use App\Models\Entry;
use Carbon\Carbon;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;

class GetItems extends BaseFeverAction
{
    public function handle(Request $request)
    {
        $query = Entry::query()
            ->join('feed_subscriptions', function ($join) {
                $join->on('entries.feed_id', '=', 'feed_subscriptions.feed_id')
                    ->where('feed_subscriptions.user_id', '=', Auth::id());
            })
            ->leftJoin('entry_interactions', function ($join) {
                $join->on('entries.id', '=', 'entry_interactions.entry_id')
                    ->where('entry_interactions.user_id', '=', Auth::id());
            })
            ->select([
                'entries.id',
                'entries.feed_id',
                'entries.title',
                'entries.author',
                'entries.content',
                'entries.url',
                'entries.published_at as created_on_time',
                'entry_interactions.starred_at as is_saved',
                'entry_interactions.read_at as is_read',
            ]);

        // Handle pagination
        if ($sinceId = $request->input('since_id')) {
            $query->where('entries.id', '>', $sinceId);
        }

        if ($maxId = $request->input('max_id')) {
            $query->where('entries.id', '<', $maxId);
        }

        if ($withIds = $request->input('with_ids')) {
            $ids = explode(',', $withIds);
            $query->whereIn('entries.id', $ids);
        }

        $items = $query->limit(50)
            ->orderBy('entries.id', 'desc')
            ->get()
            ->map(fn ($entry) => [
                'id' => $entry->id,
                'feed_id' => $entry->feed_id,
                'title' => $entry->title,
                'author' => $entry->author,
                'html' => $entry->content,
                'url' => $entry->url,
                'is_saved' => ! is_null($entry->is_saved),
                'is_read' => ! is_null($entry->is_read),
                'created_on_time' => Carbon::parse($entry->created_on_time)->timestamp,
            ]);

        return array_merge($this->getBaseResponse(), [
            'items' => $items,
            'total_items' => Entry::query()
                ->join('feed_subscriptions', function ($join) {
                    $join->on('entries.feed_id', '=', 'feed_subscriptions.feed_id')
                        ->where('feed_subscriptions.user_id', '=', Auth::id());
                })->count(),
        ]);
    }
}
