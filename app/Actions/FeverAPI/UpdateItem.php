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
        $entry = Entry::forUser(Auth::user())->firstWhere('id', $request->input('id'));

        if (! $entry) {
            return array_merge($this->getBaseResponse(), [
                'error' => 'Entry not found',
            ]);
        }

        if ($request->input('as') === 'save') {
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
