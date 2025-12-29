<?php

declare(strict_types=1);

namespace Tests\Unit\Events;

use App\Events\LoginFailed;
use Tests\TestCase;

class LoginFailedTest extends TestCase
{
    public function test_login_failed_event_stores_email_and_ip(): void
    {
        $event = new LoginFailed('test@example.com', '192.168.1.1');

        $this->assertSame('test@example.com', $event->email);
        $this->assertSame('192.168.1.1', $event->ip);
    }

    public function test_login_failed_event_is_dispatchable(): void
    {
        $event = new LoginFailed('test@example.com', '127.0.0.1');

        $this->assertContains(\Illuminate\Foundation\Events\Dispatchable::class, class_uses($event));
    }
}
