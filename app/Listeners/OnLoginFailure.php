<?php

namespace App\Listeners;

use App\Actions\Auth\NotifyLoginFailureOnTelegram;
use App\Events\LoginFailed;

class OnLoginFailure
{
    public function handle(LoginFailed $event): void
    {
        NotifyLoginFailureOnTelegram::dispatch($event);
    }
}
