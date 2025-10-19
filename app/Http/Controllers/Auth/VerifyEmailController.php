<?php

declare(strict_types=1);

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use Illuminate\Foundation\Auth\EmailVerificationRequest;
use Illuminate\Http\RedirectResponse;
use Illuminate\Support\Facades\Event;
use Illuminate\Auth\Events\Verified;

class VerifyEmailController extends Controller
{
    /**
     * Mark the authenticated user's email address as verified.
     */
    public function __invoke(EmailVerificationRequest $request): RedirectResponse
    {
        if ($request->user()->hasVerifiedEmail()) {
            return redirect()->intended(route('feeds.index', absolute: false).'?verified=1');
        }

        if ($request->user()->markEmailAsVerified()) {
            Event::dispatch(new Verified($request->user()));
        }

        return redirect()->intended(route('feeds.index', absolute: false).'?verified=1');
    }
}
