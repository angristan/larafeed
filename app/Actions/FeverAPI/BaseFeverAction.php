<?php

declare(strict_types=1);

namespace App\Actions\FeverAPI;

use App\Models\Feed;
use Carbon\Carbon;
use Lorisleiva\Actions\Concerns\AsAction;

class BaseFeverAction
{
    use AsAction;

    public function getBaseResponse(): array
    {
        return [
            'api_version' => 3,
            'auth' => 1,
            'last_refreshed_on_time' => Feed::max('last_successful_refresh_at')?->timestamp ?? Carbon::now()->timestamp,
        ];
    }
}
