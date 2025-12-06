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
        if (! $entry_id) {
            return redirect()->back()->withErrors('Missing entry id');
        }

        $entry = Entry::whereId($entry_id)
            ->whereIn('feed_id', Auth::user()->feeds()->select('id'))
            ->first();

        if (! $entry) {
            return redirect()->back()->withErrors('Entry not found');
        }

        if ($request->has('read')) {
            if ($request->input('read')) {
                $entry->markAsRead(Auth::user());

                return redirect()->back();
            } else {
                $entry->markAsUnread(Auth::user());

                return redirect()->back();
            }
        }

        if ($request->has('starred')) {
            if ($request->input('starred')) {
                $entry->favorite(Auth::user());

                return redirect()->back();
            } else {
                $entry->unfavorite(Auth::user());

                return redirect()->back();
            }
        }

        if ($request->has('archived')) {
            if ($request->input('archived')) {
                $entry->archive(Auth::user());

                return redirect()->back();

            } else {
                $entry->unarchive(Auth::user());

                return redirect()->back();
            }
        }

        return redirect()->back()->withErrors('Invalid request');
    }
}
