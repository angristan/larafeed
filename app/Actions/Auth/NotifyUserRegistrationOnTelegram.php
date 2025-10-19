<?php

declare(strict_types=1);

namespace App\Actions\Auth;

use App\Models\User;
use Lorisleiva\Actions\Concerns\AsAction;
use NotificationChannels\Telegram\TelegramMessage;
use Throwable;

class NotifyUserRegistrationOnTelegram
{
    use AsAction;

    public function handle(User $user): void
    {
        $token = config('services.telegram-bot-api.token');
        $chatId = config('services.telegram-bot-api.chat_id');

        if ($this->shouldSkipNotification($token, $chatId)) {
            return;
        }

        try {
            TelegramMessage::create()
                ->to($chatId)
                ->content('New user registered with email: '.$user->email)
                ->send();
        } catch (Throwable $exception) {
            report($exception);
        }
    }

    private function shouldSkipNotification(?string $token, ?string $chatId): bool
    {
        if ($token === null || $chatId === null) {
            return true;
        }

        $trimmedToken = trim($token);
        $trimmedChatId = trim($chatId);

        if ($trimmedToken === '' || $trimmedChatId === '') {
            return true;
        }

        return in_array($trimmedToken, ['YOUR BOT TOKEN HERE'], true)
            || in_array($trimmedChatId, ['YOUR CHAT ID HERE'], true);
    }
}
