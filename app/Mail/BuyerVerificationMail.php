<?php

namespace App\Mail;

use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;

/**
 * H6 Batch H — wholesale-buyer e-mail verification message. Sent through the platform's existing mail transport
 * (the same `Mail::to()->send()` path the staff verification/reset mails use; in production the Resend HTTPS
 * transport configured by `MailServiceProvider`). Carries only the link and the store name: no identity data,
 * no password, no internal ids.
 */
class BuyerVerificationMail extends Mailable
{
    public function __construct(
        public readonly string $url,
        public readonly string $storeName,
        public readonly int $ttlMinutes,
    ) {}

    public function envelope(): Envelope
    {
        return new Envelope(subject: 'تأكيد البريد الإلكتروني / Confirm your email — '.$this->storeName);
    }

    public function content(): Content
    {
        return new Content(view: 'emails.buyer-verification');
    }
}
