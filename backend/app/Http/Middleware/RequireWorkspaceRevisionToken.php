<?php

namespace App\Http\Middleware;

use App\Services\Workspace\WorkspaceRevisionToken;
use Closure;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class RequireWorkspaceRevisionToken
{
    public function __construct(
        private readonly WorkspaceRevisionToken $tokens,
    ) {}

    public function handle(Request $request, Closure $next): Response
    {
        $claims = $this->tokens->verify(
            (string) $request->header('X-Workspace-Revision-Token', ''),
        );

        if ($claims === null) {
            return new JsonResponse([
                'message' => 'The workspace revision credential is missing, expired or no longer signed in.',
            ], Response::HTTP_PRECONDITION_REQUIRED);
        }

        $request->attributes->set('workspaceRevisionUserId', $claims['uid']);
        $request->attributes->set('workspaceRevisionClaims', $claims);

        return $next($request);
    }
}
