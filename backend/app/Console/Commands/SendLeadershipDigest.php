<?php

namespace App\Console\Commands;

use App\Mail\LeadershipDigestMail;
use App\Models\User;
use App\Services\Reports\LeadershipDigestService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Mail;

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
            ->pluck('email');

        if ($recipients->isEmpty()) {
            $this->info('No admin recipients with an email; leadership digest skipped.');

            return self::SUCCESS;
        }

        foreach ($recipients as $email) {
            // Queued (database queue) so shared hosting drains it via cron.
            Mail::to($email)->queue(new LeadershipDigestMail($digest));
        }

        $this->info(sprintf('Leadership digest queued for %d recipient(s).', $recipients->count()));

        return self::SUCCESS;
    }
}
