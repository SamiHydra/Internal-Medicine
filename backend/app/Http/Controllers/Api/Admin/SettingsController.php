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
            // A real 24-hour clock time, not merely the NN:NN shape: "25:99" used
            // to pass and then rewrote every reporting-period deadline (QA-006).
            'weekly_deadline_time' => ['sometimes', 'string', 'date_format:H:i'],
            'weeklyDeadlineTime' => ['sometimes', 'string', 'date_format:H:i'],
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
            'metric_targets' => ['sometimes', 'array'],
            'metricTargets' => ['sometimes', 'array'],
            'metric_targets.*.enabled' => ['sometimes', 'boolean'],
            'metricTargets.*.enabled' => ['sometimes', 'boolean'],
            'metric_targets.*.direction' => ['sometimes', Rule::in(['atLeast', 'atMost'])],
            'metricTargets.*.direction' => ['sometimes', Rule::in(['atLeast', 'atMost'])],
            'metric_targets.*.amber' => ['sometimes', 'numeric', 'min:0'],
            'metricTargets.*.amber' => ['sometimes', 'numeric', 'min:0'],
            'metric_targets.*.green' => ['sometimes', 'numeric', 'min:0'],
            'metricTargets.*.green' => ['sometimes', 'numeric', 'min:0'],
            'morning_session_days' => ['sometimes', 'array'],
            'morningSessionDays' => ['sometimes', 'array'],
            'morning_session_days.*' => ['integer', 'between:1,7'],
            'morningSessionDays.*' => ['integer', 'between:1,7'],
            'morning_session_time' => ['sometimes', 'date_format:H:i'],
            'morningSessionTime' => ['sometimes', 'date_format:H:i'],
            'morning_recorder_ids' => ['sometimes', 'array'],
            'morningRecorderIds' => ['sometimes', 'array'],
            'morning_recorder_ids.*' => ['uuid', Rule::exists('users', 'id')],
            'morningRecorderIds.*' => ['uuid', Rule::exists('users', 'id')],
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
