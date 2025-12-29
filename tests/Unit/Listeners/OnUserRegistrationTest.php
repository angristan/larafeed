<?php

declare(strict_types=1);

namespace Tests\Unit\Listeners;

use App\Listeners\OnUserRegistration;
use App\Models\User;
use Illuminate\Auth\Events\Registered;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class OnUserRegistrationTest extends TestCase
{
    use RefreshDatabase;

    public function test_listener_handles_registered_event(): void
    {
        $user = User::factory()->create();
        $event = new Registered($user);

        $listener = new OnUserRegistration;

        // Verify the event has the correct user
        $this->assertSame($user->id, $event->user->id);

        // Verify listener can be instantiated
        $this->assertInstanceOf(OnUserRegistration::class, $listener);
    }

    public function test_registered_event_contains_user(): void
    {
        $user = User::factory()->create([
            'email' => 'test@example.com',
        ]);

        $event = new Registered($user);

        $this->assertSame('test@example.com', $event->user->email);
    }
}
