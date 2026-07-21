<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class EnsurePasswordChanged
{
    /**
     * Block app access for a user who still owes a password change (a new account
     * or an admin-reset temporary password). They may only reach /api/auth/me,
     * /api/auth/logout and /api/auth/change-password (none of which carry this
     * middleware) until they rotate the temporary password. Returns 403 - never
     * 401 - so the SPA shows the forced change-password screen instead of signing
     * the user out.
     *
     * @param  Closure(Request): Response  $next
     */
    public function handle(Request $request, Closure $next): Response
    {
        if ($request->user()?->password_change_required) {
            return response()->json([
                'message' => 'You must change your password before continuing.',
                'passwordChangeRequired' => true,
            ], 403);
        }

        return $next($request);
    }
}
