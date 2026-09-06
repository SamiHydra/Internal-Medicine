<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Existing critical-alert notifications point at the source report, which carries
 * no acknowledge/assign/resolve control. Repoint them at the durable action item
 * the alert already created, matching new notifications written by
 * CriticalEventAlertService::notify().
 */
return new class extends Migration
{
    private const TYPES = ['critical_value_alert', 'critical_value_corrected'];

    public function up(): void
    {
        DB::table('notifications')
            ->whereIn('type', self::TYPES)
            // The route is the real invariant being fixed: a critical alert that
            // still opens the report. Catches both current rows and older ones
            // written before related_entity was populated.
            ->where('related_route', 'like', '/reports/%')
            ->whereNotNull('related_id')
            ->orderBy('id')
            ->chunkById(500, function ($notifications): void {
                $items = DB::table('action_items')
                    ->where('source', 'critical_event')
                    ->whereIn('report_id', $notifications->pluck('related_id')->unique()->all())
                    ->get(['id', 'report_id', 'title'])
                    ->groupBy('report_id');

                foreach ($notifications as $notification) {
                    $candidates = $items->get($notification->related_id);
                    if (! $candidates || $candidates->isEmpty()) {
                        continue;
                    }

                    // Every message variant is built as "<item title> ...", so the
                    // title prefix disambiguates a report that tripped several rules.
                    // Legacy rows predate that convention, but a report that
                    // raised exactly one item is unambiguous regardless.
                    $match = $candidates->count() === 1
                        ? $candidates->first()
                        : $candidates->first(fn ($item): bool => $item->title !== null
                            && str_starts_with($notification->message, $item->title));

                    // Ambiguous rows keep the old report link rather than guess.
                    if (! $match) {
                        continue;
                    }

                    DB::table('notifications')->where('id', $notification->id)->update([
                        'related_route' => sprintf('/admin/action-items?item=%s', $match->id),
                        'related_entity' => 'action_item',
                        'related_id' => $match->id,
                    ]);
                }
            });
    }

    /**
     * Best effort: rows that predated related_entity are restored as
     * 'critical_alert' rather than the blank they originally carried.
     */
    public function down(): void
    {
        DB::table('notifications')
            ->whereIn('type', self::TYPES)
            ->where('related_entity', 'action_item')
            ->whereNotNull('related_id')
            ->orderBy('id')
            ->chunkById(500, function ($notifications): void {
                $reports = DB::table('action_items')
                    ->join('reports', 'reports.id', '=', 'action_items.report_id')
                    ->whereIn('action_items.id', $notifications->pluck('related_id')->unique()->all())
                    ->get([
                        'action_items.id as action_item_id',
                        'reports.id as report_id',
                        'reports.assignment_id',
                        'reports.reporting_period_id',
                    ])
                    ->keyBy('action_item_id');

                foreach ($notifications as $notification) {
                    $report = $reports->get($notification->related_id);
                    if (! $report) {
                        continue;
                    }

                    DB::table('notifications')->where('id', $notification->id)->update([
                        'related_route' => sprintf('/reports/%s/%s', $report->assignment_id, $report->reporting_period_id),
                        'related_entity' => 'critical_alert',
                        'related_id' => $report->report_id,
                    ]);
                }
            });
    }
};
