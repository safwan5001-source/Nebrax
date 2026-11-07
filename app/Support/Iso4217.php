<?php

namespace App\Support;

/**
 * قائمة رموز العملات الصالحة كعملة أساس لمؤسسة — ISO 4217 (CUR-1).
 *
 * المصدر: SIX (جهة صيانة ISO 4217)، «list-one» المنشورة 2026-09-17، أخذنا منها رموز العملات
 * الوطنية المتداولة فقط. المستبعد عمداً (لا يصلح عملةَ دفتر مؤسسة): رموز الصناديق والوحدات
 * المؤشَّرة (BOV CHE CHW CLF COU MXV USN UYI UYW)، المعادن وحقوق السحب الخاصة والوحدات الحسابية
 * (XAD XAG XAU XBA XBB XBC XBD XDR XPD XPT XSU XUA)، ورمزا «لا عملة/اختبار» (XXX XTS).
 * بقيت رموز الاتحادات النقدية الحقيقية (XAF XCD XCG XOF XPF).
 *
 * رموز فقط — لا منازل عشرية هنا عمداً: المنزلتان وتفسير القيم المخزّنة قرار D-12 المنفصل (الخيار C)،
 * فلا يُستدلّ من وجود رمز في القائمة أن القيم المخزّنة لتلك العملة بوحدتها الصغرى الحقيقية.
 *
 * تحديث القائمة يتمّ بمراجعة صريحة (إصدار ISO جديد)، لا تلقائياً. نقية، بلا قراءة قاعدة بيانات.
 */
final class Iso4217
{
    public const CODES = [
        'AED', 'AFN', 'ALL', 'AMD', 'AOA', 'ARS', 'AUD', 'AWG', 'AZN', 'BAM',
        'BBD', 'BDT', 'BHD', 'BIF', 'BMD', 'BND', 'BOB', 'BRL', 'BSD', 'BTN',
        'BWP', 'BYN', 'BZD', 'CAD', 'CDF', 'CHF', 'CLP', 'CNY', 'COP', 'CRC',
        'CUP', 'CVE', 'CZK', 'DJF', 'DKK', 'DOP', 'DZD', 'EGP', 'ERN', 'ETB',
        'EUR', 'FJD', 'FKP', 'GBP', 'GEL', 'GHS', 'GIP', 'GMD', 'GNF', 'GTQ',
        'GYD', 'HKD', 'HNL', 'HTG', 'HUF', 'IDR', 'ILS', 'INR', 'IQD', 'IRR',
        'ISK', 'JMD', 'JOD', 'JPY', 'KES', 'KGS', 'KHR', 'KMF', 'KPW', 'KRW',
        'KWD', 'KYD', 'KZT', 'LAK', 'LBP', 'LKR', 'LRD', 'LSL', 'LYD', 'MAD',
        'MDL', 'MGA', 'MKD', 'MMK', 'MNT', 'MOP', 'MRU', 'MUR', 'MVR', 'MWK',
        'MXN', 'MYR', 'MZN', 'NAD', 'NGN', 'NIO', 'NOK', 'NPR', 'NZD', 'OMR',
        'PAB', 'PEN', 'PGK', 'PHP', 'PKR', 'PLN', 'PYG', 'QAR', 'RON', 'RSD',
        'RUB', 'RWF', 'SAR', 'SBD', 'SCR', 'SDG', 'SEK', 'SGD', 'SHP', 'SLE',
        'SOS', 'SRD', 'SSP', 'STN', 'SVC', 'SYP', 'SZL', 'THB', 'TJS', 'TMT',
        'TND', 'TOP', 'TRY', 'TTD', 'TWD', 'TZS', 'UAH', 'UGX', 'USD', 'UYU',
        'UZS', 'VED', 'VES', 'VND', 'VUV', 'WST', 'XAF', 'XCD', 'XCG', 'XOF',
        'XPF', 'YER', 'ZAR', 'ZMW', 'ZWG',
    ];

    /** تطبيع الرمز: قصّ المسافات وأحرف كبيرة. لا تحقق من الوجود. */
    public static function normalize(?string $code): string
    {
        return strtoupper(trim((string) $code));
    }

    public static function isValid(?string $code): bool
    {
        return in_array(self::normalize($code), self::CODES, true);
    }
}
