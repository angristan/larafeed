<?php

declare(strict_types=1);

namespace App\Actions\GoogleReaderAPI;

use App\Models\Entry;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Validation\Rule;
use Lorisleiva\Actions\Concerns\AsAction;

class EditTag
{
    use AsAction;

    public function rules(): array
    {
        return [
            'i' => ['required', 'string'],
            'r' => ['sometimes', 'string', Rule::in(['user/-/state/com.google/read', 'user/-/state/com.google/starred'])],
            'a' => ['sometimes', 'string', Rule::in(['user/-/state/com.google/read', 'user/-/state/com.google/starred'])],
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
            switch ($request->input('a')) {
                case 'user/-/state/com.google/read':
                    $entry->markAsRead(Auth::user());
                    break;
                case 'user/-/state/com.google/starred':
                    $entry->favorite(Auth::user());
                    break;
            }

            switch ($request->input('r')) {
                case 'user/-/state/com.google/read':
                    $entry->markAsUnread(Auth::user());
                    break;
                case 'user/-/state/com.google/starred':
                    $entry->unfavorite(Auth::user());
                    break;
            }
        }

        return response()->make('OK', 200, ['Content-Type' => 'text/plain']);
    }
}
