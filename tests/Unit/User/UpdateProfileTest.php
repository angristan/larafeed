<?php

declare(strict_types=1);

namespace Tests\Unit\User;

use App\Actions\User\UpdateProfile;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class UpdateProfileTest extends TestCase
{
    use RefreshDatabase;

    public function test_updates_user_name(): void
    {
        $user = User::factory()->create([
            'name' => 'Old Name',
        ]);

        $action = new UpdateProfile;
        $action->handle($user, ['name' => 'New Name']);

        $user->refresh();

        $this->assertSame('New Name', $user->name);
    }

    public function test_updates_user_email(): void
    {
        $user = User::factory()->create([
            'email' => 'old@example.com',
            'email_verified_at' => now(),
        ]);

        $action = new UpdateProfile;
        $action->handle($user, ['email' => 'new@example.com']);

        $user->refresh();

        $this->assertSame('new@example.com', $user->email);
    }

    public function test_clears_email_verified_at_when_email_changes(): void
    {
        $user = User::factory()->create([
            'email' => 'old@example.com',
            'email_verified_at' => now(),
        ]);

        $action = new UpdateProfile;
        $action->handle($user, ['email' => 'new@example.com']);

        $user->refresh();

        $this->assertNull($user->email_verified_at);
    }

    public function test_keeps_email_verified_at_when_email_unchanged(): void
    {
        $verifiedAt = now();
        $user = User::factory()->create([
            'email' => 'same@example.com',
            'email_verified_at' => $verifiedAt,
        ]);

        $action = new UpdateProfile;
        $action->handle($user, ['name' => 'New Name']);

        $user->refresh();

        $this->assertNotNull($user->email_verified_at);
    }

    public function test_updates_multiple_attributes(): void
    {
        $user = User::factory()->create([
            'name' => 'Old Name',
            'email' => 'old@example.com',
        ]);

        $action = new UpdateProfile;
        $action->handle($user, [
            'name' => 'New Name',
            'email' => 'new@example.com',
        ]);

        $user->refresh();

        $this->assertSame('New Name', $user->name);
        $this->assertSame('new@example.com', $user->email);
    }
}
