<?php

namespace App\Mail;

use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

class AuthActionMail extends Mailable
{
    use Queueable, SerializesModels;

    public function __construct(
        public readonly string $action,
        public readonly string $url,
    ) {}

    public function envelope(): Envelope
    {
        return new Envelope(subject: $this->action === 'verify'
            ? 'تأكيد البريد الإلكتروني — أَوْج ERP'
            : 'استرداد كلمة المرور — أَوْج ERP');
    }

    public function content(): Content
    {
        return new Content(view: 'emails.auth-action');
    }
}
