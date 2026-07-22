<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ApiErrorRenderingTest extends TestCase
{
    use RefreshDatabase;

    public function test_unauthenticated_api_request_returns_401_json_not_a_login_redirect(): void
    {
        // A plain (non-JSON-Accept) request to a guarded API route previously 500'd
        // trying to resolve the non-existent web "login" route. With JSON forced
        // for /api/* it must return a clean 401 instead.
        $response = $this->get('/api/auth/me');

        $response->assertStatus(401);
        $response->assertHeader('content-type', 'application/json');
    }
}
