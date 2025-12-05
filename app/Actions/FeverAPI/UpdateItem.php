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

    /**
     * @return array<string, mixed>
     */
    public function handle(Request $request): array
    {
        /** @var \App\Models\User $user */
        $user = Auth::user();

        $entry = Entry::whereId($request->input('id'))->first();
        if (! $entry) {
            return array_merge($this->getBaseResponse(), [
                'error' => 'Entry not found',
            ]);
        }

        if (! $user->feeds()->where('id', $entry->feed_id)->exists()) {
            return array_merge($this->getBaseResponse(), [
                'error' => 'Entry not found',
            ]);
        }

        if ($request->input('as') === 'save') {
            $entry->favorite($user);
        }

        if ($request->input('as') === 'unsaved') {
            $entry->unfavorite($user);
        }

        if ($request->input('as') === 'read') {
            $entry->markAsRead($user);
        }

        if ($request->input('as') === 'unread') {
            $entry->markAsUnread($user);
        }

        return $this->getBaseResponse();
    }
}
