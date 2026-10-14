<?php

namespace App\Support\Communications;

use InvalidArgumentException;

/**
 * عنوان المستلم لقناة واحدة. التحقق هنا شكلي (E.164 للهاتف، بريد صالح، معرّف جهاز غير فارغ)؛
 * التطبيع الكامل بمكتبة ترقيم حقيقية شريحة لاحقة. `masked()` هو الشكل الوحيد المسموح في أي نص تشخيصي.
 */
final readonly class MessageRecipient
{
    public const PHONE_PATTERN = '/^\+[1-9][0-9]{7,14}\z/';

    public const MAX_LENGTH = 320;

    public function __construct(
        public CommunicationChannel $channel,
        public string $address,
    ) {
        if ($address === '' || strlen($address) > self::MAX_LENGTH || preg_match('/[\x00-\x1f\x7f\s]/', $address) === 1) {
            throw new InvalidArgumentException('Recipient address is empty, too long or contains whitespace/control characters.');
        }

        $valid = match (true) {
            $channel->usesPhoneAddress() => preg_match(self::PHONE_PATTERN, $address) === 1,
            $channel === CommunicationChannel::Email => filter_var($address, FILTER_VALIDATE_EMAIL) !== false,
            default => true,
        };

        if (! $valid) {
            throw new InvalidArgumentException("Recipient address is not valid for channel {$channel->value}.");
        }
    }

    /** الأرقام والبريد تُقنَّع (آخر 2 من الهاتف، أول حرف من البريد)؛ معرّف الجهاز يُخفى كله. */
    public function masked(): string
    {
        return match (true) {
            $this->channel->usesPhoneAddress() => '+•••'.substr($this->address, -2),
            $this->channel === CommunicationChannel::Email => substr($this->address, 0, 1).'•••@'.substr(strrchr($this->address, '@'), 1),
            default => '••••',
        };
    }
}
