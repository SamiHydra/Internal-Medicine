<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Mail\PasswordResetMail;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Password;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class PasswordResetController extends Controller
{
    public function forgot(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'email' => ['required', 'email', 'max:255'],
        ]);
        $email = Str::lower(trim($validated['email']));
        $user = User::query()->whereRaw('lower(email) = ?', [$email])->first();

        if ($user) {
            $token = Password::broker()->createToken($user);
            $resetUrl = rtrim((string) config('app.frontend_url', env('FRONTEND_URL', 'http://localhost:5173')), '/')
                .'/reset-password?token='.urlencode($token).'&email='.urlencode($email);

            Mail::to($email)->queue(new PasswordResetMail($resetUrl));
        }

        return response()->json([
            'message' => 'If that email exists, reset instructions have been sent.',
        ], 202);
    }

    public function reset(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'email' => ['required', 'email', 'max:255'],
            'token' => ['required', 'string'],
            'password' => ['required', 'string', \Illuminate\Validation\Rules\Password::defaults(), 'confirmed'],
        ]);
        $email = Str::lower(trim($validated['email']));
        $user = User::query()->whereRaw('lower(email) = ?', [$email])->first();

        if (! $user || ! Password::broker()->tokenExists($user, $validated['token'])) {
            throw ValidationException::withMessages([
                'token' => 'This password reset link is invalid or has expired.',
            ]);
        }

        $user->forceFill([
            'password' => Hash::make($validated['password']),
            'password_change_required' => false,
            'remember_token' => Str::random(60),
        ])->save();
        Password::broker()->deleteToken($user);

        return response()->json([
            'message' => 'Password updated.',
        ]);
    }
}
