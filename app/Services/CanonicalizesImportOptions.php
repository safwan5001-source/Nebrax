<?php

namespace App\Services;

/**
 * أدوات التحويل القانوني لخيارات الاستيراد (IMP-H1-S3b) المشتركة بين محوّلات المجالات: `canonicalOptions()` في كل محوّل
 * تعلن مفاتيح مجالها وأنواعها، وهذه الأدوات تُطبّع المطابقة والمنطقيات بصيغةٍ واحدة فتتطابق بصمة المعاينة بين المراحل.
 */
trait CanonicalizesImportOptions
{
    /**
     * تُضاف `mapping` **فقط** إن أُرسلت: غيابها يعني «مطابقة تلقائية من الترويسات»، أمّا المصفوفة الفارغة الصريحة فتعني «لا
     * عمود مطابَق» (فتفشل الحقول المطلوبة) — معنيان مختلفان لا يجوز أن يتحوّل أحدهما إلى الآخر بالتحويل القانوني.
     *
     * @param  array<string, mixed>  $options
     * @param  array<string, mixed>  $raw
     * @return array<string, mixed>
     */
    protected function withMapping(array $options, array $raw): array
    {
        if (array_key_exists('mapping', $raw) && is_array($raw['mapping'])) {
            $options['mapping'] = $this->canonicalMapping($raw['mapping']);
        }

        return $options;
    }

    /**
     * مطابقة الأعمدة قانونياً: فهرس العمود (نصّ) → مفتاح الحقل، مرتّبةً بالفهرس عددياً؛ القيمة الفارغة تبقى `null` كما وردت
     * (لا يُعاد تفسيرها هنا — التفسير للخدمة). غياب المطابقة = مصفوفة فارغة.
     *
     * @return array<string, ?string>
     */
    protected function canonicalMapping(mixed $mapping): array
    {
        if (! is_array($mapping)) {
            return [];
        }

        $canonical = [];
        foreach ($mapping as $index => $field) {
            $canonical[(string) $index] = $field === null ? null : (string) $field;
        }
        uksort($canonical, static fn (string $a, string $b): int => (int) $a <=> (int) $b);

        return $canonical;
    }

    protected function canonicalBool(mixed $value): bool
    {
        return filter_var($value, FILTER_VALIDATE_BOOL, FILTER_NULL_ON_FAILURE) ?? false;
    }
}
