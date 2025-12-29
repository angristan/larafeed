<?php

declare(strict_types=1);

namespace Tests\Unit\Auth;

use App\Actions\Auth\RegisterUser;
use App\Models\User;
use Illuminate\Auth\Events\Registered;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class RegisterUserTest extends TestCase
{
    use RefreshDatabase;

    public function test_creates_user_with_correct_attributes(): void
    {
        Event::fake([Registered::class]);

        $action = new RegisterUser;
        $user = $action->handle('John Doe', 'john@example.com', 'password123');

        $this->assertInstanceOf(User::class, $user);
        $this->assertSame('John Doe', $user->name);
        $this->assertSame('john@example.com', $user->email);
    }

    public function test_hashes_password(): void
    {
        Event::fake([Registered::class]);

        $action = new RegisterUser;
        $user = $action->handle('John Doe', 'john@example.com', 'password123');

        $this->assertTrue(Hash::check('password123', $user->password));
        $this->assertNotSame('password123', $user->password);
    }

    public function test_generates_fever_api_key(): void
    {
        Event::fake([Registered::class]);

        $action = new RegisterUser;
        $user = $action->handle('John Doe', 'john@example.com', 'password123');

        $expectedKey = md5('john@example.com:password123');
        $this->assertSame($expectedKey, $user->fever_api_key);
    }

    public function test_dispatches_registered_event(): void
    {
        Event::fake([Registered::class]);

        $action = new RegisterUser;
        $user = $action->handle('John Doe', 'john@example.com', 'password123');

        Event::assertDispatched(Registered::class, function ($event) use ($user) {
            return $event->user->id === $user->id;
        });
    }

    public function test_persists_user_to_database(): void
    {
        Event::fake([Registered::class]);

        $action = new RegisterUser;
        $action->handle('John Doe', 'john@example.com', 'password123');

        $this->assertDatabaseHas('users', [
            'name' => 'John Doe',
            'email' => 'john@example.com',
        ]);
    }
}
