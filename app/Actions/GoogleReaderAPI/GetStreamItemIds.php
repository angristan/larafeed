<?php

declare(strict_types=1);

namespace App\Actions\GoogleReaderAPI;

use App\Models\Entry;
use Carbon\Carbon;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Lorisleiva\Actions\Concerns\AsAction;

class GetStreamItemIds
{
    use AsAction;

    public function asController(Request $request): \Illuminate\Http\JsonResponse
    {
        $continuation = $request->input('c');
        $streamType = $request->input('s');
        $excludeTargets = $request->input('xt');
        $afterTimestamp = $request->input('ot');

        $query = Entry::query()
            ->join('feeds', 'entries.feed_id', '=', 'feeds.id')
            ->join('feed_subscriptions', function ($join) {
                $join->on('feeds.id', '=', 'feed_subscriptions.feed_id')
                    ->where('feed_subscriptions.user_id', '=', Auth::id());
            })
            ->leftJoin('entry_interactions', function ($join) {
                $join->on('entries.id', '=', 'entry_interactions.entry_id')
                    ->where('entry_interactions.user_id', '=', Auth::id());
            })
            ->select(['entries.id', 'entries.published_at'])
            ->orderBy('entries.published_at', 'desc');

        if ($excludeTargets === 'user/-/state/com.google/read') {
            $query->whereNull('entry_interactions.read_at');
        }

        // For s=user/-/state/com.google/reading-list, we want to return all entries

        if ($streamType === 'user/-/state/com.google/starred') {
            $query->whereNotNull('entry_interactions.starred_at');
        }

        if ($streamType === 'user/-/state/com.google/read') {
            $query->whereNotNull('entry_interactions.read_at');
        }

        if ($afterTimestamp) {
            $query->where('entries.published_at', '>', Carbon::createFromTimestamp($afterTimestamp));
        }

        // Handle continuation token
        if ($continuation) {
            $query->where('entries.published_at', '<', Carbon::createFromTimestamp($continuation));
        }

        // $entries = $query->limit($limit)->get();
        $entries = $query->get();

        // Format response according to Google Reader API
        $itemRefs = $entries->map(function ($entry) {
            return [
                'id' => (string) $entry->id,
            ];
        });

        return response()->json([
            'itemRefs' => $itemRefs,
            // 'continuation' => $entries->last()?->published_at ?
            //     Carbon::parse($entries->last()->published_at)->timestamp :
            //     null,
        ]);
    }
}
