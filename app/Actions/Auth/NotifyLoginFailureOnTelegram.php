<?php

declare(strict_types=1);

namespace App\Actions\Auth;

use App\Events\LoginFailed;
use Lorisleiva\Actions\Concerns\AsAction;
use NotificationChannels\Telegram\TelegramMessage;

class NotifyLoginFailureOnTelegram
{
    use AsAction;

    public function handle(LoginFailed $event)
    {
        TelegramMessage::create()
            ->to(config('services.telegram-bot-api.chat_id'))
            ->content('Suspicious login attempt from IP: '.$event->ip.' with email: '.$event->email)->send();
    }
}
