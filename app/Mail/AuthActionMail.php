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
        public readonly ?string $tenantName = null,
        public readonly ?string $userName = null,
        public readonly ?string $loginEmail = null,
    ) {}

    public function envelope(): Envelope
    {
        return new Envelope(subject: match ($this->action) {
            'verify' => 'تأكيد البريد الإلكتروني — أَوْج ERP',
            'invite' => 'دعوة الدخول إلى أَوْج ERP',
            default => 'استرداد كلمة المرور — أَوْج ERP',
        });
    }

    public function content(): Content
    {
        return new Content(view: 'emails.auth-action');
    }
}
