<?php

namespace App\Mail;

use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

class LeadershipDigestMail extends Mailable
{
    use Queueable;
    use SerializesModels;

    /**
     * @param  array<string, mixed>  $digest
     */
    public function __construct(
        public readonly array $digest,
    ) {}

    public function envelope(): Envelope
    {
        return new Envelope(
            subject: 'Weekly leadership digest — '.($this->digest['periodLabel'] ?? 'St Paul Internal Medicine'),
        );
    }

    public function content(): Content
    {
        return new Content(
            view: 'mail.leadership-digest',
            with: ['digest' => $this->digest],
        );
    }
}
