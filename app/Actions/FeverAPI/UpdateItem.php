<?php

declare(strict_types=1);

namespace App\Actions\FeverAPI;

use App\Models\Entry;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Lorisleiva\Actions\Concerns\AsAction;

class UpdateItem extends BaseFeverAction
{
    use AsAction;

    public function handle(Request $request)
    {
        $entry = Entry::whereId($request->input('id'))->first();
        if (! $entry) {
            return array_merge($this->getBaseResponse(), [
                'error' => 'Entry not found',
            ]);
        }

        if (! Auth::user()->feeds()->where('id', $entry->feed_id)->exists()) {
            return array_merge($this->getBaseResponse(), [
                'error' => 'Entry not found',
            ]);
        }

        if ($request->input('as') === 'saved') {
            $entry->favorite(Auth::user());
        }

        if ($request->input('as') === 'unsaved') {
            $entry->unfavorite(Auth::user());
        }

        if ($request->input('as') === 'read') {
            $entry->markAsRead(Auth::user());
        }

        if ($request->input('as') === 'unread') {
            $entry->markAsUnread(Auth::user());
        }

        return $this->getBaseResponse();
    }
}
