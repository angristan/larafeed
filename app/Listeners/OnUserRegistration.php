<?php

namespace App\Listeners;

use App\Actions\Auth\NotifyUserRegistrationOnTelegram;
use Illuminate\Auth\Events\Registered;

class OnUserRegistration
{
    public function handle(Registered $event): void
    {
        NotifyUserRegistrationOnTelegram::dispatch($event->user);
    }
}
