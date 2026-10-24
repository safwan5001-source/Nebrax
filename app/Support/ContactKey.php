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
        // أرقام عربية/فارسية ⇒ لاتينية أولاً، وإلا انقسم نفس العميل (٠٥٠… لا تُطابق 050…).
        $ascii = strtr((string) $raw, ['٠' => '0', '١' => '1', '٢' => '2', '٣' => '3', '٤' => '4', '٥' => '5', '٦' => '6', '٧' => '7', '٨' => '8', '٩' => '9',
            '۰' => '0', '۱' => '1', '۲' => '2', '۳' => '3', '۴' => '4', '۵' => '5', '۶' => '6', '۷' => '7', '۸' => '8', '۹' => '9']);
        $digits = preg_replace('/\D+/', '', $ascii) ?? '';
        if (str_starts_with($digits, '00')) {
            $digits = substr($digits, 2);
        }
        if (strlen($digits) === 10 && str_starts_with($digits, '05')) {
            $digits = '966'.substr($digits, 1);   // 05XXXXXXXX
        } elseif (strlen($digits) === 9 && str_starts_with($digits, '5')) {
            $digits = '966'.$digits;              // 5XXXXXXXX
        }

        if (str_starts_with($digits, '9660') && strlen($digits) === 13) {
            $digits = '966'.substr($digits, 4);   // +966 0501234567 (صفر محلي بعد المفتاح الدولي)
        }

        // رقم يصلح مفتاح هوية: 7..15 خانة (حد E.164) وليس خانة واحدة مكررة (0000000، 1111111) ولا نصاً حراً بأكثر من رقم؛
        // غير الصالح ⇒ null فيسقط المفتاح إلى البريد/معرّف الطلب بدل دمج غرباء على طرف واحد.
        if (strlen($digits) < 7 || strlen($digits) > 15 || count(array_unique(str_split($digits))) === 1) {
            return null;
        }

        return $digits;
    }

    public static function email(?string $raw): ?string
    {
        $email = mb_strtolower(trim((string) $raw));

        return $email !== '' && filter_var($email, FILTER_VALIDATE_EMAIL) !== false ? $email : null;
    }
}
