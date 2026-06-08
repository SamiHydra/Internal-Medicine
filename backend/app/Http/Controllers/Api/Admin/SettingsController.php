<?php

namespace App\Http\Controllers\Api\Admin;

use App\Http\Controllers\Api\Concerns\SerializesAdminResources;
use App\Http\Controllers\Controller;
use App\Models\AppSetting;
use App\Services\Admin\AdminAuditService;
use App\Services\Admin\AppSettingsService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;

class SettingsController extends Controller
{
    use SerializesAdminResources;

    public function __construct(
        private readonly AppSettingsService $settingsService,
        private readonly AdminAuditService $auditService,
    ) {}

    public function show(): JsonResponse
    {
        Gate::authorize('viewAny', AppSetting::class);

        return response()->json([
            'settings' => $this->settingsService->structured(),
            'rows' => AppSetting::query()
                ->orderBy('setting_key')
                ->get()
                ->map(fn (AppSetting $setting) => $this->serializeAppSetting($setting)),
        ]);
    }

    public function update(Request $request): JsonResponse
    {
        Gate::authorize('update', AppSetting::class);

        $validated = $request->validate([
            'deadline_enforced' => ['sometimes', 'boolean'],
            'deadlineEnforced' => ['sometimes', 'boolean'],
            'weekly_deadline_day' => ['sometimes', Rule::in(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'])],
            'weeklyDeadlineDay' => ['sometimes', Rule::in(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'])],
            'weekly_deadline_time' => ['sometimes', 'regex:/^\d{2}:\d{2}$/'],
            'weeklyDeadlineTime' => ['sometimes', 'regex:/^\d{2}:\d{2}$/'],
            'auto_lock_hours_after_deadline' => ['sometimes', 'integer', 'min:1'],
            'autoLockHoursAfterDeadline' => ['sometimes', 'integer', 'min:1'],
            'notable_rise_threshold_percent' => ['sometimes', 'integer', 'min:1'],
            'notableRiseThresholdPercent' => ['sometimes', 'integer', 'min:1'],
            'notable_drop_threshold_percent' => ['sometimes', 'integer', 'min:1'],
            'notableDropThresholdPercent' => ['sometimes', 'integer', 'min:1'],
            'reminder_in_app_hours_before_deadline' => ['sometimes', 'integer', 'min:0'],
            'reminderInAppHoursBeforeDeadline' => ['sometimes', 'integer', 'min:0'],
            'reminder_email_hours_before_deadline' => ['sometimes', 'integer', 'min:0'],
            'reminderEmailHoursBeforeDeadline' => ['sometimes', 'integer', 'min:0'],
            'reminder_sms_hours_before_deadline' => ['sometimes', 'integer', 'min:0'],
            'reminderSmsHoursBeforeDeadline' => ['sometimes', 'integer', 'min:0'],
            'reminder_overdue_hours_after_deadline' => ['sometimes', 'integer', 'min:0'],
            'reminderOverdueHoursAfterDeadline' => ['sometimes', 'integer', 'min:0'],
            'critical_non_zero_fields' => ['sometimes', 'array'],
            'criticalNonZeroFields' => ['sometimes', 'array'],
            'critical_non_zero_fields.*' => ['string', 'max:64'],
            'criticalNonZeroFields.*' => ['string', 'max:64'],
        ]);
        $oldValues = $this->settingsService->structured();
        $settings = $this->settingsService->update($request->user(), $validated);

        $this->auditService->record($request->user(), 'update', 'app_settings', null, $oldValues, $settings, $request);

        return response()->json([
            'settings' => $settings,
            'rows' => AppSetting::query()
                ->orderBy('setting_key')
                ->get()
                ->map(fn (AppSetting $setting) => $this->serializeAppSetting($setting)),
        ]);
    }
}
