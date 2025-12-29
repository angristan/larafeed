<?php

declare(strict_types=1);

namespace Tests\Unit\User;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class DeleteAccountTest extends TestCase
{
    use RefreshDatabase;

    public function test_deletes_user_account(): void
    {
        $user = User::factory()->create([
            'password' => Hash::make('password'),
        ]);

        $this->actingAs($user);

        $response = $this->delete(route('profile.destroy'), [
            'password' => 'password',
        ]);

        $response->assertRedirect('/');
        $this->assertDatabaseMissing('users', ['id' => $user->id]);
    }

    public function test_requires_correct_password(): void
    {
        $user = User::factory()->create([
            'password' => Hash::make('correct_password'),
        ]);

        $this->actingAs($user);

        $response = $this->delete(route('profile.destroy'), [
            'password' => 'wrong_password',
        ]);

        $response->assertSessionHasErrors('password');
        $this->assertDatabaseHas('users', ['id' => $user->id]);
    }

    public function test_logs_out_user_after_deletion(): void
    {
        $user = User::factory()->create([
            'password' => Hash::make('password'),
        ]);

        $this->actingAs($user);

        $this->delete(route('profile.destroy'), [
            'password' => 'password',
        ]);

        $this->assertGuest();
    }
}
