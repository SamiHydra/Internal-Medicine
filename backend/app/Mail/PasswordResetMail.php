<?php

namespace App\Mail;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

/**
 * Queued so a slow/unreachable SMTP relay never blocks the forgot-password HTTP
 * request (which returns an enumeration-safe 202 regardless of delivery).
 */
class PasswordResetMail extends Mailable implements ShouldQueue
{
    use Queueable;
    use SerializesModels;

    public function __construct(public readonly string $resetUrl) {}

    public function envelope(): Envelope
    {
        return new Envelope(subject: 'St Paul reporting password reset');
    }

    public function content(): Content
    {
        return new Content(
            text: 'mail.password-reset',
            with: ['resetUrl' => $this->resetUrl],
        );
    }
}
