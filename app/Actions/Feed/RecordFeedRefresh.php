<?php

declare(strict_types=1);

namespace App\Actions\Feed;

use App\Models\Feed;
use App\Models\FeedRefresh;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;
use Lorisleiva\Actions\Concerns\AsAction;

class RecordFeedRefresh
{
    use AsAction;

    public function handle(Feed $feed, Carbon $timestamp, bool $success, int $entriesCreated = 0, ?string $error = null): void
    {
        if ($success) {
            $feed->last_successful_refresh_at = $timestamp;
            $feed->last_error_message = null;
        } else {
            $feed->last_failed_refresh_at = $timestamp;
            $feed->last_error_message = Str::limit($error ?? '', 255, '');
        }
        $feed->save();

        FeedRefresh::create([
            'feed_id' => $feed->id,
            'refreshed_at' => $timestamp,
            'was_successful' => $success,
            'entries_created' => $entriesCreated,
            'error_message' => $error,
        ]);
    }
}
