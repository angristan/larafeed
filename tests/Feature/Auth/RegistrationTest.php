<?php

declare(strict_types=1);

namespace Tests\Feature\Auth;

use App\Features\Registration;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Pennant\Feature;
use Tests\TestCase;

class RegistrationTest extends TestCase
{
    use RefreshDatabase;

    public function test_registration_screen_is_not_available(): void
    {
        $this->assertFalse(Feature::active(Registration::class));

        $response = $this->get('/register');

        $response->assertStatus(400);
    }

    public function test_registration_attempts_are_rejected(): void
    {
        $response = $this->post('/register', [
            'name' => 'Test User',
            'email' => 'test@example.com',
            'password' => 'password',
            'password_confirmation' => 'password',
        ]);

        $response->assertStatus(400);
        $this->assertGuest();
    }
}
