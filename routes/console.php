<?php

declare(strict_types=1);

use App\Actions\Feed\RefreshFeeds;
use Illuminate\Support\Facades\Schedule;

Schedule::command('telescope:prune')->daily();

Schedule::command(RefreshFeeds::class)->hourly();

Schedule::command('horizon:snapshot')->everyFiveMinutes();
