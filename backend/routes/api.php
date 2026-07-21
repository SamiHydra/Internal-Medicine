<?php

use App\Http\Controllers\Api\AcademicAnalyticsController;
use App\Http\Controllers\Api\AcademicEvaluationController;
use App\Http\Controllers\Api\AcademicOperationsAnalyticsController;
use App\Http\Controllers\Api\AcademicRegistrationController;
use App\Http\Controllers\Api\AccessRequestSubmissionController;
use App\Http\Controllers\Api\Admin\AcademicEvaluationController as AdminAcademicEvaluationController;
use App\Http\Controllers\Api\Admin\AcademicStructureController;
use App\Http\Controllers\Api\Admin\AccessRequestController;
use App\Http\Controllers\Api\Admin\ActionItemController;
use App\Http\Controllers\Api\Admin\AdminAccessRequestController;
use App\Http\Controllers\Api\Admin\AuditLogController;
use App\Http\Controllers\Api\Admin\DutyRosterController;
use App\Http\Controllers\Api\Admin\EvaluationFormController;
use App\Http\Controllers\Api\Admin\ReferenceDataController;
use App\Http\Controllers\Api\Admin\ReportAssignmentController;
use App\Http\Controllers\Api\Admin\ReportImportController;
use App\Http\Controllers\Api\Admin\RotationController;
use App\Http\Controllers\Api\Admin\SettingsController;
use App\Http\Controllers\Api\Admin\TransferRequestController as AdminTransferRequestController;
use App\Http\Controllers\Api\Admin\UndergraduateAdminController;
use App\Http\Controllers\Api\Admin\UserController;
use App\Http\Controllers\Api\AdminRegistrationController;
use App\Http\Controllers\Api\AnalyticsController;
use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\MorningSessionController;
use App\Http\Controllers\Api\NotificationController;
use App\Http\Controllers\Api\PasswordResetController;
use App\Http\Controllers\Api\ReportCommentController;
use App\Http\Controllers\Api\ReportWorkflowController;
use App\Http\Controllers\Api\TeachingSessionController;
use App\Http\Controllers\Api\TransferRequestController;
use App\Http\Controllers\Api\WorkspaceController;
use Illuminate\Support\Facades\Route;

Route::prefix('auth')->group(function (): void {
    Route::post('/login', [AuthController::class, 'login'])->middleware('throttle:10,1');
    Route::post('/forgot-password', [PasswordResetController::class, 'forgot'])->middleware('throttle:5,1');
    Route::post('/reset-password', [PasswordResetController::class, 'reset'])->middleware('throttle:5,1');

    Route::middleware('auth:sanctum')->group(function (): void {
        Route::get('/me', [AuthController::class, 'me'])->middleware('active');
        Route::post('/logout', [AuthController::class, 'logout']);
        // Reachable while password_change_required is set (no 'password-changed'
        // gate here) so a user can clear a temporary/new-account password.
        Route::post('/change-password', [AuthController::class, 'changePassword'])->middleware('active');
    });
});

Route::post('/access-requests', [AccessRequestSubmissionController::class, 'store'])->middleware('throttle:10,1');
Route::post('/academic-access-requests', [AcademicRegistrationController::class, 'store'])->middleware('throttle:10,1');
Route::post('/admin-access-requests', [AdminRegistrationController::class, 'store'])->middleware('throttle:10,1');

// A generous per-user ceiling (300/min) - far above any legitimate session
// (the admin dashboard's burst + 20s poll is a fraction of this) - so a single
// compromised or runaway client cannot hammer the read/analytics endpoints.
Route::middleware(['auth:sanctum', 'active', 'password-changed', 'throttle:300,1'])->group(function (): void {
    // Workspace bootstrap stays reachable even with password_change_required set,
    // so the SPA can resolve currentUser (incl. passwordChangeRequired) and render
    // the forced change-password gate. Every other endpoint stays behind the gate.
    Route::get('/workspace', [WorkspaceController::class, 'show'])->withoutMiddleware('password-changed');

    Route::get('/reports', [ReportWorkflowController::class, 'index']);
    Route::post('/reports', [ReportWorkflowController::class, 'store']);
    Route::get('/reports/details', [ReportWorkflowController::class, 'details']);
    Route::get('/reports/{report}', [ReportWorkflowController::class, 'show']);
    Route::put('/reports/{report}', [ReportWorkflowController::class, 'update']);
    Route::post('/reports/{report}/submit', [ReportWorkflowController::class, 'submit']);
    Route::post('/reports/{report}/lock', [ReportWorkflowController::class, 'lock']);
    Route::post('/reports/{report}/unlock', [ReportWorkflowController::class, 'unlock']);

    Route::get('/reports/{report}/comments', [ReportCommentController::class, 'index']);
    Route::post('/reports/{report}/comments', [ReportCommentController::class, 'store']);
    Route::delete('/reports/{report}/comments/{comment}', [ReportCommentController::class, 'destroy']);

    Route::get('/notifications', [NotificationController::class, 'index'])->middleware('permission:notifications.view');
    Route::patch('/notifications/read', [NotificationController::class, 'markRead'])->middleware('permission:notifications.view');
    Route::patch('/notifications/read-all', [NotificationController::class, 'markAllRead'])->middleware('permission:notifications.view');
    Route::delete('/notifications', [NotificationController::class, 'destroy'])->middleware('permission:notifications.view');
    Route::post('/notifications/restore', [NotificationController::class, 'restore'])->middleware('permission:notifications.view');

    Route::prefix('analytics')
        ->middleware('permission:analytics.view')
        ->group(function (): void {
            Route::get('/overview', [AnalyticsController::class, 'overview']);
            Route::get('/dashboard', [AnalyticsController::class, 'dashboard']);
            Route::get('/inpatient', [AnalyticsController::class, 'inpatient']);
            Route::get('/outpatient', [AnalyticsController::class, 'outpatient']);
            Route::get('/procedures', [AnalyticsController::class, 'procedures']);
            Route::get('/weekly', [AnalyticsController::class, 'weekly']);
            Route::get('/monthly', [AnalyticsController::class, 'monthly']);
            Route::get('/quarterly', [AnalyticsController::class, 'quarterly']);
            Route::get('/yearly', [AnalyticsController::class, 'yearly']);
            Route::get('/departments', [AnalyticsController::class, 'departments']);
            Route::get('/wards', [AnalyticsController::class, 'wards']);
            Route::get('/export', [AnalyticsController::class, 'export']);
        });

    Route::prefix('academic')->group(function (): void {
        Route::get('/form-options', [AcademicEvaluationController::class, 'formOptions'])->middleware('permission:academic.submit');
        Route::post('/consultant-evaluations', [AcademicEvaluationController::class, 'storeConsultantEvaluation'])->middleware('permission:academic.submit');
        Route::post('/resident-evaluations', [AcademicEvaluationController::class, 'storeResidentEvaluation'])->middleware('permission:academic.submit');
        Route::get('/my-submissions', [AcademicEvaluationController::class, 'mySubmissions'])->middleware('permission:academic.submit');
        Route::get('/my-performance', [AcademicEvaluationController::class, 'myPerformance'])->middleware('permission:academic.submit');
        Route::get('/evaluation-forms/{key}', [AcademicEvaluationController::class, 'form'])->middleware('permission:academic.submit');

        Route::get('/analytics/summary', [AcademicAnalyticsController::class, 'summary'])->middleware('permission:academic.view');
        Route::get('/analytics/trend', [AcademicAnalyticsController::class, 'trend'])->middleware('permission:academic.view');
        Route::get('/analytics/people', [AcademicAnalyticsController::class, 'people'])->middleware('permission:academic.view');

        // Operations analytics (V2 Phase 7): morning punctuality, teaching
        // occurrence, student progress. Content-stamp cached, never polled.
        Route::get('/analytics/morning', [AcademicOperationsAnalyticsController::class, 'morning'])->middleware('permission:academic.view');
        Route::get('/analytics/teaching', [AcademicOperationsAnalyticsController::class, 'teaching'])->middleware('permission:academic.view');
        Route::get('/analytics/students', [AcademicOperationsAnalyticsController::class, 'students'])->middleware('permission:academic.view');

        // Morning sessions, recorder side (V2 Phase 6). The policy narrows the
        // coarse permission to the designated recorders (same-day) and admins.
        Route::get('/morning-sessions/today', [MorningSessionController::class, 'today'])->middleware('permission:morningAttendance.record');
        Route::post('/morning-sessions/{morningSession}/record', [MorningSessionController::class, 'record'])->middleware('permission:morningAttendance.record');
        Route::post('/morning-sessions/{morningSession}/cancel', [MorningSessionController::class, 'cancel'])->middleware('permission:morningAttendance.record');

        // Student evaluations (V2 Phase 5): any consultant, any student, one-way.
        Route::get('/students', [AcademicEvaluationController::class, 'students'])->middleware('permission:academic.submit');
        Route::post('/student-evaluations', [AcademicEvaluationController::class, 'storeStudentEvaluation'])->middleware('permission:academic.submit');

        // Section transfers, consultant side (V2 Phase 2).
        Route::get('/transfer-requests/options', [TransferRequestController::class, 'formOptions'])->middleware('permission:transfers.create');
        Route::post('/transfer-requests', [TransferRequestController::class, 'store'])->middleware('permission:transfers.create');
        Route::get('/transfer-requests/mine', [TransferRequestController::class, 'mine'])->middleware('permission:transfers.create');
        Route::post('/transfer-requests/{transferRequest}/cancel', [TransferRequestController::class, 'cancel'])->middleware('permission:transfers.create');
    });

    // Undergraduate teaching (V2 Phase 5): the rep's held / not-held log and
    // the consultant's attendance surface. student_rep reaches ONLY these.
    Route::prefix('teaching')->group(function (): void {
        Route::get('/my-sessions', [TeachingSessionController::class, 'mySessions'])->middleware('permission:teachingLog.record');
        Route::post('/sessions/{teachingSession}/record', [TeachingSessionController::class, 'record'])->middleware('permission:teachingLog.record');
        Route::get('/today', [TeachingSessionController::class, 'today'])->middleware('permission:studentAttendance.record');
        Route::put('/sessions/{teachingSession}/attendance', [TeachingSessionController::class, 'attendance'])->middleware('permission:studentAttendance.record');
    });

    Route::prefix('admin')->group(function (): void {
        Route::get('/admin-access-requests', [AdminAccessRequestController::class, 'index'])->middleware('permission:admins.approve');
        Route::post('/admin-access-requests/{adminAccessRequest}/approve', [AdminAccessRequestController::class, 'approve'])->middleware('permission:admins.approve');
        Route::post('/admin-access-requests/{adminAccessRequest}/reject', [AdminAccessRequestController::class, 'reject'])->middleware('permission:admins.approve');

        Route::get('/users', [UserController::class, 'index'])->middleware('permission:users.view');
        Route::post('/users', [UserController::class, 'store'])->middleware('permission:users.manage');
        Route::get('/users/{user}', [UserController::class, 'show'])->middleware('permission:users.view');
        Route::patch('/users/{user}', [UserController::class, 'update'])->middleware('permission:users.manage');
        Route::patch('/users/{user}/active', [UserController::class, 'setActive'])->middleware('permission:users.manage');
        Route::post('/users/{user}/reset-password', [UserController::class, 'resetPassword'])->middleware('permission:users.manage');
        Route::delete('/users/{user}', [UserController::class, 'destroy'])->middleware('permission:users.manage');

        Route::get('/assignments', [ReportAssignmentController::class, 'index'])->middleware('permission:assignments.manage');
        Route::post('/assignments', [ReportAssignmentController::class, 'store'])->middleware('permission:assignments.manage');
        Route::patch('/assignments/{assignment}', [ReportAssignmentController::class, 'update'])->middleware('permission:assignments.manage');
        Route::delete('/assignments/{assignment}', [ReportAssignmentController::class, 'destroy'])->middleware('permission:assignments.manage');

        Route::get('/templates', [ReferenceDataController::class, 'templates'])->middleware('permission:templates.manage');
        Route::post('/templates', [ReferenceDataController::class, 'storeTemplate'])->middleware('permission:templates.manage');
        Route::get('/templates/{template}', [ReferenceDataController::class, 'showTemplate'])->middleware('permission:templates.manage');
        Route::patch('/templates/{template}', [ReferenceDataController::class, 'updateTemplate'])->middleware('permission:templates.manage');
        Route::patch('/templates/{template}/active', [ReferenceDataController::class, 'setTemplateActive'])->middleware('permission:templates.manage');
        Route::patch('/templates/{template}/fields/{field}/active', [ReferenceDataController::class, 'setFieldActive'])->middleware('permission:templates.manage');
        Route::delete('/templates/{template}', [ReferenceDataController::class, 'destroyTemplate'])->middleware('permission:templates.manage');

        Route::get('/departments', [ReferenceDataController::class, 'departments'])->middleware('permission:departments.manage');
        Route::post('/departments', [ReferenceDataController::class, 'storeDepartment'])->middleware('permission:departments.manage');
        Route::get('/departments/{department}', [ReferenceDataController::class, 'showDepartment'])->middleware('permission:departments.manage');
        Route::patch('/departments/{department}', [ReferenceDataController::class, 'updateDepartment'])->middleware('permission:departments.manage');
        Route::patch('/departments/{department}/active', [ReferenceDataController::class, 'setDepartmentActive'])->middleware('permission:departments.manage');
        Route::delete('/departments/{department}', [ReferenceDataController::class, 'destroyDepartment'])->middleware('permission:departments.manage');
        Route::get('/wards', [ReferenceDataController::class, 'wards'])->middleware('permission:departments.manage');

        Route::get('/settings', [SettingsController::class, 'show'])->middleware('permission:settings.manage');
        Route::put('/settings', [SettingsController::class, 'update'])->middleware('permission:settings.manage');
        Route::patch('/settings', [SettingsController::class, 'update'])->middleware('permission:settings.manage');

        Route::get('/access-requests', [AccessRequestController::class, 'index'])->middleware('permission:accessRequests.review');
        Route::get('/access-requests/{accessRequest}', [AccessRequestController::class, 'show'])->middleware('permission:accessRequests.review');
        Route::patch('/access-requests/{accessRequest}/review', [AccessRequestController::class, 'review'])->middleware('permission:accessRequests.review');
        Route::post('/access-requests/{accessRequest}/approve', [AccessRequestController::class, 'approve'])->middleware('permission:accessRequests.review');
        Route::post('/access-requests/{accessRequest}/reject', [AccessRequestController::class, 'reject'])->middleware('permission:accessRequests.review');

        Route::get('/audit-logs', [AuditLogController::class, 'cellEdits'])->middleware('permission:audit.view');
        Route::get('/admin-audit-logs', [AuditLogController::class, 'adminActions'])->middleware('permission:audit.view');

        Route::get('/reports/import-template', [ReportImportController::class, 'template'])->middleware('permission:reports.import');
        Route::post('/reports/import', [ReportImportController::class, 'import'])->middleware('permission:reports.import');

        Route::get('/action-items', [ActionItemController::class, 'index'])->middleware('permission:actionItems.view');
        Route::post('/action-items', [ActionItemController::class, 'store'])->middleware('permission:actionItems.manage');
        Route::patch('/action-items/{actionItem}', [ActionItemController::class, 'update'])->middleware('permission:actionItems.manage');

        Route::get('/academic/evaluations', [AdminAcademicEvaluationController::class, 'index'])->middleware('permission:academic.view');
        Route::get('/academic/audit', [AdminAcademicEvaluationController::class, 'audit'])->middleware('permission:academic.view');
        Route::post('/academic/external-evaluations', [AdminAcademicEvaluationController::class, 'storeExternal'])->middleware('permission:academic.manage');

        // The evaluation form editor (V2 Phase 4). Content edits in place;
        // structural edits (Maintenance only) via draft + publish.
        Route::get('/academic/evaluation-forms', [EvaluationFormController::class, 'index'])->middleware('permission:evaluationForms.editContent');
        Route::patch('/academic/evaluation-forms/{evaluationForm}/content', [EvaluationFormController::class, 'updateContent'])->middleware('permission:evaluationForms.editContent');
        Route::post('/academic/evaluation-forms/{key}/draft', [EvaluationFormController::class, 'storeDraft'])->middleware('permission:evaluationForms.editStructure');
        Route::put('/academic/evaluation-forms/{evaluationForm}/structure', [EvaluationFormController::class, 'updateStructure'])->middleware('permission:evaluationForms.editStructure');
        Route::post('/academic/evaluation-forms/{evaluationForm}/publish', [EvaluationFormController::class, 'publish'])->middleware('permission:evaluationForms.editStructure');

        // Academic structure (V2 Phase 1). Mounted under /academic/ because the
        // clinical pillar already aliases /admin/wards to inpatient departments.
        Route::get('/academic/wards', [AcademicStructureController::class, 'wards'])->middleware('permission:academicStructure.manage');
        Route::post('/academic/wards', [AcademicStructureController::class, 'storeWard'])->middleware('permission:academicStructure.manage');
        Route::patch('/academic/wards/{ward}', [AcademicStructureController::class, 'updateWard'])->middleware('permission:academicStructure.manage');
        Route::delete('/academic/wards/{ward}', [AcademicStructureController::class, 'destroyWard'])->middleware('permission:academicStructure.manage');

        Route::get('/academic/sections', [AcademicStructureController::class, 'sections'])->middleware('permission:academicStructure.manage');
        Route::post('/academic/sections', [AcademicStructureController::class, 'storeSection'])->middleware('permission:academicStructure.manage');
        Route::patch('/academic/sections/{section}', [AcademicStructureController::class, 'updateSection'])->middleware('permission:academicStructure.manage');
        Route::delete('/academic/sections/{section}', [AcademicStructureController::class, 'destroySection'])->middleware('permission:academicStructure.manage');

        Route::post('/academic/sections/{section}/set-consultant', [AcademicStructureController::class, 'setSectionConsultant'])->middleware('permission:roster.manage');

        Route::get('/academic/duty-types', [AcademicStructureController::class, 'dutyTypes'])->middleware('permission:academicStructure.manage');
        Route::post('/academic/duty-types', [AcademicStructureController::class, 'storeDutyType'])->middleware('permission:academicStructure.manage');
        Route::patch('/academic/duty-types/{dutyType}', [AcademicStructureController::class, 'updateDutyType'])->middleware('permission:academicStructure.manage');
        Route::delete('/academic/duty-types/{dutyType}', [AcademicStructureController::class, 'destroyDutyType'])->middleware('permission:academicStructure.manage');

        Route::get('/rotations/calendars', [RotationController::class, 'calendars'])->middleware('permission:rotations.manage');
        Route::post('/rotations/calendars', [RotationController::class, 'storeCalendar'])->middleware('permission:rotations.manage');
        Route::patch('/rotations/calendars/{calendar}/active', [RotationController::class, 'setCalendarActive'])->middleware('permission:rotations.manage');
        Route::get('/rotations/{calendar}/plan', [RotationController::class, 'plan'])->middleware('permission:rotations.manage');
        Route::post('/rotations/{calendar}/plan', [RotationController::class, 'savePlan'])->middleware('permission:rotations.manage');

        // Transfer review: permission is coarse; the policy narrows consultants
        // to the head of the destination section.
        Route::get('/transfer-requests', [AdminTransferRequestController::class, 'index'])->middleware('permission:transfers.review');
        Route::post('/transfer-requests/{transferRequest}/approve', [AdminTransferRequestController::class, 'approve'])->middleware('permission:transfers.review');
        Route::post('/transfer-requests/{transferRequest}/reject', [AdminTransferRequestController::class, 'reject'])->middleware('permission:transfers.review');

        // Morning session oversight (V2 Phase 6).
        Route::get('/morning-sessions', [MorningSessionController::class, 'index'])->middleware('permission:academic.view');
        Route::patch('/morning-sessions/{morningSession}', [MorningSessionController::class, 'update'])->middleware('permission:academic.manage');
        Route::post('/morning-sessions/{morningSession}/cancel', [MorningSessionController::class, 'cancel'])->middleware('permission:academic.manage');
        Route::get('/morning-roster-overrides', [MorningSessionController::class, 'overrides'])->middleware('permission:academic.view');
        Route::post('/morning-roster-overrides', [MorningSessionController::class, 'storeOverride'])->middleware('permission:academic.manage');
        Route::delete('/morning-roster-overrides/{override}', [MorningSessionController::class, 'destroyOverride'])->middleware('permission:academic.manage');

        // Undergraduate module administration (V2 Phase 5).
        Route::middleware('permission:students.manage')->group(function (): void {
            Route::get('/student-batches', [UndergraduateAdminController::class, 'batches']);
            Route::post('/student-batches', [UndergraduateAdminController::class, 'storeBatch']);
            Route::get('/student-batches/{batch}', [UndergraduateAdminController::class, 'showBatch']);
            Route::patch('/student-batches/{batch}', [UndergraduateAdminController::class, 'updateBatch']);
            Route::delete('/student-batches/{batch}', [UndergraduateAdminController::class, 'destroyBatch']);

            Route::get('/students', [UndergraduateAdminController::class, 'students']);
            Route::post('/students', [UndergraduateAdminController::class, 'storeStudent']);
            Route::post('/students/import', [UndergraduateAdminController::class, 'importStudents']);
            Route::get('/students/{student}', [UndergraduateAdminController::class, 'showStudent']);
            Route::patch('/students/{student}', [UndergraduateAdminController::class, 'updateStudent']);
            Route::delete('/students/{student}', [UndergraduateAdminController::class, 'destroyStudent']);

            Route::get('/subgroup-placements', [UndergraduateAdminController::class, 'placements']);
            Route::post('/subgroup-placements', [UndergraduateAdminController::class, 'storePlacement']);
            Route::get('/subgroup-placements/{placement}', [UndergraduateAdminController::class, 'showPlacement']);
            Route::patch('/subgroup-placements/{placement}', [UndergraduateAdminController::class, 'updatePlacement']);
            Route::delete('/subgroup-placements/{placement}', [UndergraduateAdminController::class, 'destroyPlacement']);

            Route::get('/teaching-schedules', [UndergraduateAdminController::class, 'schedules']);
            Route::post('/teaching-schedules', [UndergraduateAdminController::class, 'storeSchedule']);
            Route::get('/teaching-schedules/{schedule}', [UndergraduateAdminController::class, 'showSchedule']);
            Route::patch('/teaching-schedules/{schedule}', [UndergraduateAdminController::class, 'updateSchedule']);
            Route::patch('/teaching-schedules/{schedule}/active', [UndergraduateAdminController::class, 'setScheduleActive']);
            Route::delete('/teaching-schedules/{schedule}', [UndergraduateAdminController::class, 'destroySchedule']);

            Route::get('/rep-assignments', [UndergraduateAdminController::class, 'repAssignments']);
            Route::post('/rep-assignments', [UndergraduateAdminController::class, 'storeRepAssignment']);
            Route::get('/rep-assignments/{repAssignment}', [UndergraduateAdminController::class, 'showRepAssignment']);
            Route::patch('/rep-assignments/{repAssignment}', [UndergraduateAdminController::class, 'updateRepAssignment']);
            Route::patch('/rep-assignments/{repAssignment}/active', [UndergraduateAdminController::class, 'setRepAssignmentActive']);
            Route::delete('/rep-assignments/{repAssignment}', [UndergraduateAdminController::class, 'destroyRepAssignment']);

            Route::get('/teaching-sessions', [UndergraduateAdminController::class, 'sessions']);
            Route::post('/teaching-sessions/{teachingSession}/cancel', [UndergraduateAdminController::class, 'cancelSession']);
        });

        Route::get('/roster/{year}/{month}', [DutyRosterController::class, 'month'])->whereNumber('year')->whereNumber('month')->middleware('permission:roster.manage');
        Route::put('/roster/{year}/{month}', [DutyRosterController::class, 'saveMonth'])->whereNumber('year')->whereNumber('month')->middleware('permission:roster.manage');
        Route::post('/roster/daily', [DutyRosterController::class, 'saveDaily'])->middleware('permission:roster.manage');
    });
});
