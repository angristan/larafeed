<?php

namespace App\Listeners;

use App\Actions\NotifyLoginFailureOnTelegram;
use App\Events\LoginFailed;

class OnLoginFailed
{
    public function handle(LoginFailed $event): void
    {
        NotifyLoginFailureOnTelegram::dispatch($event);
    }
}
