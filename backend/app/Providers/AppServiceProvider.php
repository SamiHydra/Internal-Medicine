<?php

namespace App\Providers;

use App\Models\AccessRequest;
use App\Models\AccessRequestItem;
use App\Models\AdminAuditLog;
use App\Models\AppSetting;
use App\Models\AuditLog;
use App\Models\CalculatedMetric;
use App\Models\Department;
use App\Models\Notification;
use App\Models\Report;
use App\Models\ReportAssignment;
use App\Models\ReportFieldDefinition;
use App\Models\ReportFieldValue;
use App\Models\ReportingPeriod;
use App\Models\ReportStatusHistory;
use App\Models\ReportTemplate;
use App\Models\Role;
use App\Models\User;
use App\Policies\AccessRequestItemPolicy;
use App\Policies\AccessRequestPolicy;
use App\Policies\AdminAuditLogPolicy;
use App\Policies\AppSettingPolicy;
use App\Policies\AuditLogPolicy;
use App\Policies\CalculatedMetricPolicy;
use App\Policies\NotificationPolicy;
use App\Policies\ReferenceDataPolicy;
use App\Policies\ReportAssignmentPolicy;
use App\Policies\ReportFieldValuePolicy;
use App\Policies\ReportPolicy;
use App\Policies\ReportStatusHistoryPolicy;
use App\Policies\RolePolicy;
use App\Policies\UserPolicy;
use App\Support\Authorization\Permissions;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        //
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        Gate::before(fn (User $user) => $user->active ? null : false);

        foreach (Permissions::all() as $permission) {
            Gate::define($permission, fn (User $user) => Permissions::userCan($user, $permission));
        }

        Gate::policy(AccessRequest::class, AccessRequestPolicy::class);
        Gate::policy(AccessRequestItem::class, AccessRequestItemPolicy::class);
        Gate::policy(AdminAuditLog::class, AdminAuditLogPolicy::class);
        Gate::policy(AppSetting::class, AppSettingPolicy::class);
        Gate::policy(AuditLog::class, AuditLogPolicy::class);
        Gate::policy(CalculatedMetric::class, CalculatedMetricPolicy::class);
        Gate::policy(Department::class, ReferenceDataPolicy::class);
        Gate::policy(Notification::class, NotificationPolicy::class);
        Gate::policy(Report::class, ReportPolicy::class);
        Gate::policy(ReportAssignment::class, ReportAssignmentPolicy::class);
        Gate::policy(ReportFieldDefinition::class, ReferenceDataPolicy::class);
        Gate::policy(ReportFieldValue::class, ReportFieldValuePolicy::class);
        Gate::policy(ReportingPeriod::class, ReferenceDataPolicy::class);
        Gate::policy(ReportStatusHistory::class, ReportStatusHistoryPolicy::class);
        Gate::policy(ReportTemplate::class, ReferenceDataPolicy::class);
        Gate::policy(Role::class, RolePolicy::class);
        Gate::policy(User::class, UserPolicy::class);
    }
}
