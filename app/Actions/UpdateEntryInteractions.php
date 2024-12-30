<?php

declare(strict_types=1);

namespace App\Actions;

use App\Models\Entry;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Lorisleiva\Actions\Concerns\AsAction;

class UpdateEntryInteractions
{
    use AsAction;

    public function rules(): array
    {
        return [
            'read' => ['nullable', 'boolean'],
            'starred' => ['nullable', 'boolean'],
            'archived' => ['nullable', 'boolean'],
        ];
    }

    public function handle(Request $request, string $entry_id): \Illuminate\Http\JsonResponse
    {
        if (! $entry_id) {
            return response()->json(['error' => 'Missing entry id'], 400);
        }

        $entry = Entry::whereId($entry_id)->first();
        if (! $entry) {
            return response()->json(['error' => 'Entry not found'], 404);
        }

        // Check if the user has access to the feed
        if (! Auth::user()->feeds()->where('id', $entry->feed_id)->exists()) {
            return response()->json(['error' => 'Unauthorized'], 401);
        }

        if ($request->has('read')) {
            if ($request->input('read')) {
                $entry->markAsRead(Auth::user());

                return response()->json(['message' => 'Entry marked as read'], 200);
            } else {
                $entry->markAsUnread(Auth::user());

                return response()->json(['message' => 'Entry marked as unread'], 200);
            }
        }

        if ($request->has('starred')) {
            if ($request->input('starred')) {
                $entry->favorite(Auth::user());

                return response()->json(['message' => 'Entry added to favorites'], 200);
            } else {
                $entry->unfavorite(Auth::user());

                return response()->json(['message' => 'Entry removed from favorites'], 200);
            }
        }

        if ($request->has('archived')) {
            if ($request->input('archived')) {
                $entry->archive(Auth::user());

                return response()->json(['message' => 'Entry archived'], 200);
            } else {
                $entry->unarchive(Auth::user());

                return response()->json(['message' => 'Entry unarchived'], 200);
            }
        }

        return response()->json(['error' => 'Missing interaction'], 400);
    }
}
