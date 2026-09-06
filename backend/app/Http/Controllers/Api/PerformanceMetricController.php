<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class PerformanceMetricController extends Controller
{
    public function store(Request $request): Response
    {
        $validated = $request->validate([
            'metric' => ['required', Rule::in(['LCP', 'INP', 'CLS', 'route-transition'])],
            'value' => ['required', 'numeric', 'min:0', 'max:120000'],
            'routeName' => ['required', 'string', 'max:120', 'regex:/^\/[A-Za-z0-9_\/:.-]*$/'],
            'deviceClass' => ['required', Rule::in(['mobile', 'tablet', 'desktop'])],
            'releaseSha' => ['nullable', 'string', 'max:64', 'regex:/^[A-Za-z0-9._-]+$/'],
        ]);

        DB::table('performance_metrics')->insert([
            'user_id' => $request->user()->id,
            'metric' => $validated['metric'],
            'value' => round((float) $validated['value'], 3),
            'route_name' => $validated['routeName'],
            'device_class' => $validated['deviceClass'],
            'release_sha' => $validated['releaseSha'] ?? null,
            'created_at' => now(),
        ]);

        return response()->noContent(Response::HTTP_ACCEPTED);
    }
}
