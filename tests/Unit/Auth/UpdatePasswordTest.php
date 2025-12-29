<?php

declare(strict_types=1);

namespace Tests\Unit\Auth;

use App\Actions\Auth\UpdatePassword;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class UpdatePasswordTest extends TestCase
{
    use RefreshDatabase;

    public function test_updates_user_password(): void
    {
        $user = User::factory()->create([
            'password' => Hash::make('old_password'),
        ]);

        $action = new UpdatePassword;
        $action->handle($user, 'new_password');

        $user->refresh();

        $this->assertTrue(Hash::check('new_password', $user->password));
    }

    public function test_hashes_new_password(): void
    {
        $user = User::factory()->create();

        $action = new UpdatePassword;
        $action->handle($user, 'plain_password');

        $user->refresh();

        $this->assertNotSame('plain_password', $user->password);
        $this->assertTrue(Hash::check('plain_password', $user->password));
    }

    public function test_old_password_no_longer_works(): void
    {
        $user = User::factory()->create([
            'password' => Hash::make('old_password'),
        ]);

        $action = new UpdatePassword;
        $action->handle($user, 'new_password');

        $user->refresh();

        $this->assertFalse(Hash::check('old_password', $user->password));
    }
}
