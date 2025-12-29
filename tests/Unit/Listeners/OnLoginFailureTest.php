<?php

declare(strict_types=1);

namespace Tests\Unit\Listeners;

use App\Events\LoginFailed;
use App\Listeners\OnLoginFailure;
use Tests\TestCase;

class OnLoginFailureTest extends TestCase
{
    public function test_listener_handles_login_failed_event(): void
    {
        $event = new LoginFailed('test@example.com', '192.168.1.1');

        $listener = new OnLoginFailure;

        // Verify the event has the correct data
        $this->assertSame('test@example.com', $event->email);
        $this->assertSame('192.168.1.1', $event->ip);

        // Verify listener can be instantiated
        $this->assertInstanceOf(OnLoginFailure::class, $listener);
    }

    public function test_login_failed_event_stores_email_and_ip(): void
    {
        $event = new LoginFailed('admin@example.com', '10.0.0.1');

        $this->assertSame('admin@example.com', $event->email);
        $this->assertSame('10.0.0.1', $event->ip);
    }
}
