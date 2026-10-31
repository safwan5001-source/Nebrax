<?php

namespace App\Mail;

use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;

/**
 * H6 Batch M — wholesale-buyer password-reset message, through the platform's existing mail transport (same path as
 * {@see BuyerVerificationMail}). Carries only the link and the store name: no identity data, no password, no ids.
 */
class BuyerPasswordResetMail extends Mailable
{
    public function __construct(
        public readonly string $url,
        public readonly string $storeName,
        public readonly int $ttlMinutes,
    ) {}

    public function envelope(): Envelope
    {
        return new Envelope(subject: 'إعادة تعيين كلمة المرور / Reset your password — '.$this->storeName);
    }

    public function content(): Content
    {
        return new Content(view: 'emails.buyer-password-reset');
    }
}
