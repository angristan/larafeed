<?php

declare(strict_types=1);

namespace App\Actions\FeverAPI;

use App\Models\Feed;
use Carbon\Carbon;
use Lorisleiva\Actions\Concerns\AsAction;

class BaseFeverAction
{
    use AsAction;

    /**
     * @return array{api_version: int, auth: int, last_refreshed_on_time: int}
     */
    public function getBaseResponse(): array
    {
        $lastRefresh = Feed::query()->max('last_successful_refresh_at');
        $timestamp = $lastRefresh ? Carbon::parse($lastRefresh)->timestamp : Carbon::now()->timestamp;

        return [
            'api_version' => 3,
            'auth' => 1,
            'last_refreshed_on_time' => (int) $timestamp,
        ];
    }
}
