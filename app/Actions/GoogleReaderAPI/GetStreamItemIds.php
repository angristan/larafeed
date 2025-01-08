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

    public function asController(Request $request)
    {
        $continuation = $request->input('c');
        $excludeTargets = explode('|', $request->input('xt', ''));
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

        // Handle read state exclusion
        if (in_array('user/'.Auth::id().'/state/com.google/read', $excludeTargets)) {
            $query->whereNull('entry_interactions.read_at');
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
