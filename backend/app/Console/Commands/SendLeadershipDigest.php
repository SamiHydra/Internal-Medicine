<?php

namespace App\Console\Commands;

use App\Mail\LeadershipDigestMail;
use App\Models\User;
use App\Services\Reports\LeadershipDigestService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;

class SendLeadershipDigest extends Command
{
    protected $signature = 'reports:send-digest';

    protected $description = 'Email the weekly leadership digest to admins/maintenance.';

    public function handle(LeadershipDigestService $service): int
    {
        $digest = $service->build();

        if (! ($digest['hasData'] ?? false)) {
            $this->info('No reporting data available; leadership digest skipped.');

            return self::SUCCESS;
        }

        $recipients = User::query()
            ->whereIn('role_key', ['superadmin', 'admin'])
            ->where('active', true)
            ->whereNotNull('email')
            ->get(['id', 'email']);

        if ($recipients->isEmpty()) {
            $this->info('No admin recipients with an email; leadership digest skipped.');

            return self::SUCCESS;
        }

        $queued = $recipients->sum(function (User $recipient) use ($digest): int {
            return DB::transaction(function () use ($recipient, $digest): int {
                $inserted = DB::table('leadership_digest_deliveries')->insertOrIgnore([
                    'id' => (string) Str::uuid(),
                    'reporting_period_id' => $digest['periodId'],
                    'recipient_id' => $recipient->id,
                    'recipient_email' => $recipient->email,
                    'queued_at' => now(),
                    'created_at' => now(),
                    'updated_at' => now(),
                ]);

                if ($inserted === 0) {
                    return 0;
                }

                // Production uses the database queue, so the job insert and
                // unique delivery marker commit in the same transaction.
                Mail::to($recipient->email)->queue(new LeadershipDigestMail($digest));

                return 1;
            });
        });

        $this->info(sprintf('Leadership digest queued for %d recipient(s).', $queued));

        return self::SUCCESS;
    }
}
