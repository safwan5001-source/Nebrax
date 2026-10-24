<?php

namespace App\Support;

/**
 * تطبيع بيانات الاتصال لمفاتيح المطابقة الحتمية (H4-01): دوال نقيّة بلا قاعدة بيانات. الهدف مفتاح ثابت لنفس الشخص مهما اختلفت كتابة الرقم/البريد،
 * لا التحقق من الملكية (البيانات غير موثَّقة للضيف ولذلك لا تُدمج في أطراف قائمة).
 */
final class ContactKey
{
    /** أرقام فقط بصيغة دولية سعودية حين تُعرف؛ وإلا أرقام فقط. null إن لم يبقَ ما يصلح (أقل من 7 أرقام). */
    public static function phone(?string $raw): ?string
    {
        $digits = preg_replace('/\D+/', '', (string) $raw) ?? '';
        if (str_starts_with($digits, '00')) {
            $digits = substr($digits, 2);
        }
        if (strlen($digits) === 10 && str_starts_with($digits, '05')) {
            $digits = '966'.substr($digits, 1);   // 05XXXXXXXX
        } elseif (strlen($digits) === 9 && str_starts_with($digits, '5')) {
            $digits = '966'.$digits;              // 5XXXXXXXX
        }

        return strlen($digits) >= 7 ? $digits : null;
    }

    public static function email(?string $raw): ?string
    {
        $email = mb_strtolower(trim((string) $raw));

        return $email !== '' && filter_var($email, FILTER_VALIDATE_EMAIL) !== false ? $email : null;
    }
}
