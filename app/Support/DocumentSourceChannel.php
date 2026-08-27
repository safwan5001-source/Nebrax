<?php

namespace App\Support;

enum DocumentSourceChannel: string
{
    case WEB = 'web';
    case API = 'api';

    /** القنوات التي تملك تنفيذ استقبال داخلياً في هذه المرحلة فقط. */
    public function isInternallySupported(): bool
    {
        return $this === self::WEB;
    }

    /**
     * تطبيع خاص بالقناة بعد تحقق core من trim والطول. قناة الويب توثق أن
     * معرفاتها غير حساسة للحالة؛ أي قناة مستقبلية تبقى حساسة للحالة حتى
     * يثبت عقدها خلاف ذلك صراحةً.
     */
    public function canonicalizeIdentifier(string $value): string
    {
        return match ($this) {
            self::WEB => mb_strtolower($value),
            self::API => $value,
        };
    }
}
