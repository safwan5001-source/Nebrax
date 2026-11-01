<?php

namespace App\Support;

use Carbon\Carbon;

/**
 * محلّل خلايا كشف الطرف (IMP-PS-A1) — دوال نقيّة بلا قاعدة بيانات. يتبع حكم المستوردات القائمة (تاريخ يومٌ-أولاً، أرقام عربية، لا فاصلة أوروبية ملتبسة) مع:
 *  - **مبلغ بإشارة** لعمود المبلغ الواحد (`-12.50` · `(12.50)` · `12.50-`) — الإشارة تقلب الاتجاه المُعلَن، ولا تُهمَل.
 *  - **العملة**: الريال السعودي فقط (D-PS-01)؛ غيرها يُرفض ولا يُحوَّل.
 */
final class PartnerStatementCellParser
{
    /** رموز الريال المقبولة بعد التطبيع (حروف صغيرة بلا نقاط/مسافات). */
    private const SAR = ['sar', 'sr', 'ريال', 'ريالسعودي', 'ر.س', 'رس', '﷼'];

    /** @return array{0:?string,1:?string} [Y-m-d, error] */
    public static function date(string $text): array
    {
        $value = trim(ProductImportValueNormalizer::digits($text));
        $year = $month = $day = null;
        if (preg_match('/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})(?:[ T].*)?$/', $value, $m) === 1) {
            [, $year, $month, $day] = $m;
        } elseif (preg_match('/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})$/', $value, $m) === 1) {
            [, $day, $month, $year] = $m;   // اليوم أولاً (العرف السعودي)
        } elseif (preg_match('/^\d{5}(?:\.\d+)?$/', $value) === 1) {
            $date = Carbon::create(1899, 12, 30)->addDays((int) $value);   // رقم تسلسلي لتاريخ Excel؛ الجزء الكسري يُهمل

            return $date->year >= 2000 && $date->year <= 2100 ? [$date->toDateString(), null] : [null, 'invalid_date'];
        }
        if ($year === null || ! checkdate((int) $month, (int) $day, (int) $year) || (int) $year < 2000 || (int) $year > 2100) {
            return [null, 'invalid_date'];
        }

        return [sprintf('%04d-%02d-%02d', (int) $year, (int) $month, (int) $day), null];
    }

    /** مبلغ غير سالب بمنزلتين عشريتين على الأكثر (أعمدة مدين/دائن). @return array{0:?int,1:?string} */
    public static function money(string $text): array
    {
        $clean = trim(ProductImportValueNormalizer::digits($text));
        // فاصلة عشرية أوروبية («85,50») كانت ستُقرأ فاصل آلاف فتتضاعف القيمة ×100: مرفوضة.
        if (preg_match('/[,،]\d{1,2}$/u', $clean) === 1) {
            return [null, 'invalid_money'];
        }
        [$minor, $error] = ProductImportValueNormalizer::money($text);
        if ($error !== null) {
            return [null, $error];
        }

        return $minor > PartnerStatementImportFields::MAX_AMOUNT_MINOR ? [null, 'money_out_of_range'] : [$minor, null];
    }

    /**
     * مبلغ بإشارة: `-x` · `(x)` · `x-` سالب؛ `+x` أو بلا إشارة موجب. الإشارة المزدوجة أو المختلطة (`(-x)` · `-x-` · `+-x`) غامضة فتُرفض ولا تُخمَّن.
     *
     * @return array{0:?int,1:?string}
     */
    public static function signedMoney(string $text): array
    {
        $value = trim(ProductImportValueNormalizer::digits($text));
        $dash = '[-−–]';
        $negative = false;

        if (preg_match('/^\(\s*([^()]*?)\s*\)$/u', $value, $m) === 1) {
            $negative = true;
            $value = $m[1];
        } elseif (preg_match('/^'.$dash.'\s*([^-−–+()]*)$/u', $value, $m) === 1) {
            $negative = true;
            $value = $m[1];
        } elseif (preg_match('/^([^-−–+()]*?)\s*'.$dash.'$/u', $value, $m) === 1) {
            $negative = true;
            $value = $m[1];
        } elseif (preg_match('/^\+\s*([^-−–+()]*)$/u', $value, $m) === 1) {
            $value = $m[1];
        }

        if ($value === '' || preg_match('/[-−–+()]/u', $value) === 1) {
            return [null, 'invalid_money'];
        }
        [$minor, $error] = self::money($value);
        if ($error !== null || $minor === null) {
            return [null, $error ?? 'invalid_money'];
        }

        return [$negative ? -$minor : $minor, null];
    }

    /** هل الخلية ريال سعودي؟ الفارغة ⇒ `true` (تتبع عملة التشغيلة المعلنة، وهي SAR وحدها في V1). */
    public static function isSar(string $text): bool
    {
        $code = mb_strtolower(preg_replace('/[\s.]+/u', '', trim($text)) ?? '', 'UTF-8');

        return $code === '' || in_array($code, self::SAR, true);
    }

    /** @return array{0:?string,1:bool} [kind|null, recognized] — الفارغ ⇒ [null, true]. */
    public static function kind(string $text): array
    {
        $value = ImportHeaderMatcher::normalize($text);
        if ($value === '') {
            return [null, true];
        }
        $map = [
            'invoice' => ['invoice', 'inv', 'bill', 'فاتوره', 'فاتورة'],
            'credit_note' => ['creditnote', 'cn', 'debitnote', 'dn', 'اشعاردائن', 'اشعارمدين', 'اشعار'],
            'payment' => ['payment', 'receipt', 'pay', 'دفعه', 'دفعة', 'سداد', 'سند', 'سندقبض', 'سندصرف'],
            'opening' => ['opening', 'openingbalance', 'رصيدافتتاحي', 'افتتاحي'],
            'other' => ['other', 'اخرى', 'أخرى'],
        ];
        foreach ($map as $kind => $aliases) {
            foreach ($aliases as $alias) {
                if ($value === ImportHeaderMatcher::normalize($alias)) {
                    return [$kind, true];
                }
            }
        }

        return [null, false];
    }
}
