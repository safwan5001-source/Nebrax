<?php

namespace App\Support;

/**
 * عقد التخصيص البصري لطريقة الدفع. القائمة البيضاء للأيقونات هي نفسها في `web/src/modules/payments/methods/visual.ts`
 * (يحرس تطابقهما اختبار الواجهة)؛ لا أيقونة ديناميكية ولا لون خارج `#RRGGBB`.
 */
final class PaymentMethodVisual
{
    public const MODE_DEFAULT = 'default';
    public const MODE_ICON = 'icon';
    public const MODE_IMAGE = 'image';
    public const MODES = [self::MODE_DEFAULT, self::MODE_ICON, self::MODE_IMAGE];

    /** مفاتيح Lucide المسموحة (kebab-case). */
    public const ICON_KEYS = [
        'banknote', 'coins', 'wallet', 'credit-card', 'landmark', 'receipt', 'smartphone', 'qr-code',
        'hand-coins', 'piggy-bank', 'badge-dollar-sign', 'building-2', 'send', 'scroll-text',
    ];

    public const COLOR_PATTERN = '/\A#[0-9A-Fa-f]{6}\z/';
}
