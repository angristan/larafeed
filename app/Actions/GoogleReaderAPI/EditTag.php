<?php

declare(strict_types=1);

namespace App\Actions\GoogleReaderAPI;

use App\Models\Entry;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Lorisleiva\Actions\Concerns\AsAction;

class EditTag
{
    use AsAction;

    public function rules(): array
    {
        return [
            'a' => 'required|string',
            'i' => 'required|string',
        ];
    }

    public function asController(Request $request)
    {
        $entryId = base_convert($request->input('i'), 16, 10);

        $entries = Entry::where('id', $entryId)
            ->whereExists(function ($query) {
                $query->select('id')
                    ->from('feed_subscriptions')
                    ->whereColumn('feed_subscriptions.feed_id', 'entries.feed_id')
                    ->where('feed_subscriptions.user_id', Auth::id());
            })
            ->get();

        foreach ($entries as $entry) {
            if ($request->input('a') === 'user/-/state/com.google/read') {
                $entry->markAsRead(Auth::user());
            }
        }

        return response()->json(['success' => true]);
    }
}
