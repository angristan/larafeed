<?php

declare(strict_types=1);

namespace Tests;

use App\Features\Registration;
use Illuminate\Foundation\Testing\TestCase as BaseTestCase;
use Laravel\Pennant\Feature;

abstract class TestCase extends BaseTestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        Feature::activate(Registration::class);
    }
}
