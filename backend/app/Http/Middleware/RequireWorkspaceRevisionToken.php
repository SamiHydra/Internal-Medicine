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
        $userId = $this->tokens->userId(
            (string) $request->header('X-Workspace-Revision-Token', ''),
        );

        if ($userId === null) {
            return new JsonResponse([
                'message' => 'The workspace revision credential is missing or expired.',
            ], Response::HTTP_PRECONDITION_REQUIRED);
        }

        $request->attributes->set('workspaceRevisionUserId', $userId);

        return $next($request);
    }
}
