<?php

namespace App\Support;

/**
 * ملخّص **محجوب ومقصوص** لإسقاط مستند مراجَع قبل إرساله إلى مزوّد خارجي (AI-07ب).
 *
 * المدخل هو ناتج `AiDocumentProjectionReader` فقط — أي القيم **بعد المراجعة البشرية وبعد طبقات التنقيح** — فلا يصل إلى هنا
 * ملف أصلي ولا مفتاح كائن ولا رابط تخزين ولا قيمة منقَّحة. هنا يُضاف حجبٌ أخير:
 *  - اسم الجهة المُصدِرة والمستلِمة يُستبدلان برمزَي `Party-N` ويُعاد ربطهما **محلياً** بعد الجواب؛
 *  - لا معرّف مستند/مستأجر/فرع/مستخدم، لا مسار واجهة، لا أرقام ضريبية (مستبعدة أصلاً في القارئ)؛
 *  - القيم المنقَّحة تُذكر **بمفتاحها فقط** (`redacted_fields`) ولا تحمل قيمة؛
 *  - المبالغ نصوص عشرية (SAR) بلا float، والسطور تُقصّ بحدّ رموز صريح ويُعلَن ما قُصّ (`lines_omitted`).
 *
 * **حدّ صارم للرموز:** لا يخرج ملخّص يتجاوز `$maxTokens` مقيساً على **الصيغة المرسَلة فعلاً** (`encode()` — لا على تمثيل أخفّ منها؛
 * وسوم `<>&` المهرَّبة تتضخّم ست مرات). التقليص بسلّم ثابت: السطور ← قصّ نصوص الرأس ← حذف حقول اختيارية. إن لم يتّسع الأساس
 * يعود `fits = false` فيرفض الاستدعاء رفضاً آمناً قبل أي اتصال خارجي؛ لا يُرسَل أبداً ملخّص أكبر من الحدّ.
 *
 * كل نصوص المستند تعامَل بوصفها **بيانات غير موثوقة** (قد تحمل تعليمات حقن): تُرسَل داخل كتلة بيانات مُهرَّبة بـJSON،
 * ويقيّد النموذج بلا أدوات أصلاً (لا قدرة له على فعل شيء إن تأثّر بها).
 */
final class AiDocumentDigest
{
    private const LINE_STEPS = [50, 25, 10, 5, 0];

    /** سلّم قصّ نصوص الرأس (حرف) بعد استنفاد السطور. */
    private const TEXT_STEPS = [100, 60, 30];

    /** حقول اختيارية تُحذف أولاً (بهذا الترتيب) إن لم يكفِ القصّ. */
    private const OPTIONAL_DROPS = ['warnings', 'external_reference', 'purchase_order_number', 'discount', 'price_includes_tax'];

    /** حقول الرأس التي تُستبدل قيمها برموز أطراف. */
    private const PARTY_FIELDS = ['issuer_name', 'recipient_name'];

    /**
     * @param  array<string,mixed>  $projection  كما يعيدها `AiDocumentProjectionReader::read`.
     * @return array{digest:array<string,mixed>, names:array<string,string>, fields:int, lines:int, redacted:int, tokens:int, fits:bool}
     */
    public static function build(array $projection, int $maxTokens): array
    {
        $plans = [];
        foreach (self::LINE_STEPS as $lines) {
            $plans[] = [$lines, null, 0];
        }
        foreach (self::TEXT_STEPS as $limit) {
            $plans[] = [0, $limit, 0];
        }
        foreach (range(1, count(self::OPTIONAL_DROPS)) as $drop) {
            $plans[] = [0, self::TEXT_STEPS[array_key_last(self::TEXT_STEPS)], $drop];
        }

        foreach ($plans as [$lines, $limit, $drop]) {
            $shaped = self::shape($projection, $lines, $limit, $drop);
            $tokens = self::estimateTokens($shaped['digest']);
            if ($tokens <= $maxTokens) {
                return $shaped + ['tokens' => $tokens, 'fits' => true];
            }
        }

        // لا يتّسع حتى الأساس: لا يُسلَّم للإرسال (المستدعي يرفض قبل أي اتصال).
        return $shaped + ['tokens' => $tokens, 'fits' => false];
    }

    /** تقدير متحفظ (رمز لكل 3 بايت) على الصيغة المرسَلة فعلاً. */
    public static function estimateTokens(array $digest): int
    {
        return intdiv(strlen(self::encode($digest)) + 2, 3);
    }

    /** نصّ JSON مُهرَّب للإرسال: `<`/`>`/`&` مهرَّبة كي لا تُغلق وسماً ولا تُقلّد بنية. */
    public static function encode(array $digest): string
    {
        return (string) json_encode($digest, JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_AMP | JSON_THROW_ON_ERROR);
    }

    /** @return array{digest:array<string,mixed>, names:array<string,string>, fields:int, lines:int, redacted:int} */
    private static function shape(array $projection, int $maxLines, ?int $textLimit, int $drop): array
    {
        $dropped = array_slice(self::OPTIONAL_DROPS, 0, $drop);
        $truncated = false;
        $clip = static function (string $value) use ($textLimit, &$truncated): string {
            if ($textLimit !== null && mb_strlen($value) > $textLimit) {
                $truncated = true;

                return mb_substr($value, 0, $textLimit);
            }

            return $value;
        };
        $names = [];
        $tokens = [];
        $party = static function (string $name) use (&$names, &$tokens): string {
            if (isset($tokens[$name])) {
                return $tokens[$name];
            }
            $token = 'Party-' . (count($tokens) + 1);
            $tokens[$name] = $token;
            $names[$token] = $name;

            return $token;
        };

        $redacted = [];
        $fields = [];
        foreach ((array) ($projection['fields'] ?? []) as $entry) {
            self::put($fields, $redacted, (array) $entry, $party, $clip, $dropped);
        }

        $rawLines = array_values((array) ($projection['lines'] ?? []));
        $lines = [];
        foreach (array_slice($rawLines, 0, $maxLines) as $line) {
            $row = [];
            $lineRedacted = [];
            foreach ((array) ($line['fields'] ?? []) as $entry) {
                self::put($row, $lineRedacted, (array) $entry, $party, $clip, $dropped);
            }
            if ($lineRedacted !== []) {
                $row['redacted_fields'] = $lineRedacted;
            }
            if ($row !== []) {
                $lines[] = $row;
            }
        }

        $digest = [
            'document_type' => (string) ($projection['document']['document_type'] ?? ''),
            'language' => $projection['document']['language'] ?? null,
            'currency_note' => 'amounts are decimal strings in the document currency',
            'fields' => $fields,
            'redacted_fields' => $redacted,
            'lines' => $lines,
            'lines_omitted' => max(0, count($rawLines) - count($lines)),
            'warnings' => in_array('warnings', $dropped, true) ? [] : array_values(array_map(static fn ($w): string => $clip((string) $w), array_slice((array) ($projection['warnings'] ?? []), 0, 5))),
        ];
        if ($truncated || $dropped !== []) {
            // يُعلَن القصّ للنموذج كي لا يتعامل مع القيمة المقصوصة كأنها كاملة.
            $digest['truncated'] = true;
        }

        return [
            'digest' => $digest,
            'names' => $names,
            'fields' => count($fields),
            'lines' => count($lines),
            'redacted' => (int) ($projection['basis']['redacted_values'] ?? 0),
        ];
    }

    /**
     * @param  array<string,mixed>  $into
     * @param  list<string>  $redacted
     * @param  array<string,mixed>  $entry
     */
    private static function put(array &$into, array &$redacted, array $entry, \Closure $party, \Closure $clip, array $dropped): void
    {
        $key = (string) ($entry['key'] ?? '');
        if ($key === '' || preg_match('/^[a-z][a-z0-9_]{0,40}$/', $key) !== 1) {
            return;
        }
        if (($entry['redacted'] ?? false) === true) {
            $redacted[] = $key;

            return;
        }
        $name = str_ends_with($key, '_minor') ? substr($key, 0, -6) : $key;
        if (in_array($name, $dropped, true)) {
            return;
        }
        $value = match ($entry['type'] ?? 'text') {
            'money' => (string) ($entry['decimal'] ?? ''),
            'flag' => (bool) ($entry['value'] ?? false),
            default => $clip((string) ($entry['value'] ?? '')),
        };
        if ($value === '' && ! is_bool($value)) {
            return;
        }
        $into[$name] = in_array($key, self::PARTY_FIELDS, true) ? $party((string) $value) : $value;
    }
}
