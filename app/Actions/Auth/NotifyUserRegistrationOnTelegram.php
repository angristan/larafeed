<?php

declare(strict_types=1);

namespace App\Actions\Auth;

use App\Models\User;
use Lorisleiva\Actions\Concerns\AsAction;
use NotificationChannels\Telegram\TelegramMessage;

class NotifyUserRegistrationOnTelegram
{
    use AsAction;

    public function handle(User $user)
    {
        TelegramMessage::create()
            ->to(config('services.telegram-bot-api.chat_id'))
            ->content('New user registered with email: '.$user->email)->send();
    }
}
