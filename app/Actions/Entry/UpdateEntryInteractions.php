<?php

declare(strict_types=1);

namespace App\Actions\Entry;

use App\Models\Entry;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Lorisleiva\Actions\Concerns\AsAction;

class UpdateEntryInteractions
{
    use AsAction;

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'read' => ['nullable', 'boolean'],
            'starred' => ['nullable', 'boolean'],
            'archived' => ['nullable', 'boolean'],
        ];
    }

    public function handle(Request $request, string $entry_id): RedirectResponse
    {
        /** @var \App\Models\User $user */
        $user = Auth::user();

        if (! $entry_id) {
            return redirect()->back()->withErrors('Missing entry id');
        }

        $entry = Entry::whereId($entry_id)->first();
        if (! $entry) {
            return redirect()->back()->withErrors('Entry not found');
        }

        if (! $user->feeds()->where('id', $entry->feed_id)->exists()) {
            return redirect()->back()->withErrors('You\'re not subscribed to this feed');
        }

        if ($request->has('read')) {
            if ($request->input('read')) {
                $entry->markAsRead($user);

                return redirect()->back();
            } else {
                $entry->markAsUnread($user);

                return redirect()->back();
            }
        }

        if ($request->has('starred')) {
            if ($request->input('starred')) {
                $entry->favorite($user);

                return redirect()->back();
            } else {
                $entry->unfavorite($user);

                return redirect()->back();
            }
        }

        if ($request->has('archived')) {
            if ($request->input('archived')) {
                $entry->archive($user);

                return redirect()->back();

            } else {
                $entry->unarchive($user);

                return redirect()->back();
            }
        }

        return redirect()->back()->withErrors('Invalid request');
    }
}
