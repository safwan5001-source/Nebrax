<?php

namespace App\Support;

/**
 * تعريف تقرير وقود واحد في سجل المحرك الموحَّد (`FuelReportCatalog`). قيمة ثابتة بلا سلوك:
 * المفتاح والعائلة والعنوانان (عربي/إنجليزي) وصلاحيات الاطلاع الدنيا والمرشّحات المسموحة واتجاه الصفحة وإمكان الطباعة الحرارية ومصدر البيانات.
 *
 * `permissionsAny`: يكفي واحدة منها لرؤية التقرير في الكتالوج وتشغيله (الحدّ الأدنى لرؤية بيانات الكميات). حقول المبالغ والتكلفة والائتمان
 * تُحذف من الحمولة نفسها لمن لا يملك سلطتها (انظر `FuelReportEngine::redact`) ولا يعتمد ذلك على إخفاء الواجهة.
 */
final class FuelReportDefinition
{
    public const SOURCE_METER = 'meter_derived';
    public const SOURCE_FORMAL = 'finalized_sales';
    public const SOURCE_OPERATIONS = 'operational_records';

    /**
     * @param  array{ar:string,en:string}  $title
     * @param  array{ar:string,en:string}  $description
     * @param  list<string>  $permissionsAny
     * @param  list<string>  $filters  مفاتيح المرشحات المسموحة لهذا التقرير
     */
    public function __construct(
        public readonly string $key,
        public readonly string $family,
        public readonly array $title,
        public readonly array $description,
        public readonly array $permissionsAny,
        public readonly array $filters,
        public readonly string $builder,
        public readonly string $source = self::SOURCE_METER,
        public readonly string $orientation = 'landscape',
        public readonly bool $thermal = false,
    ) {}

    /** نسخة بمفتاح آخر (تقارير مرادفة تعيد استعمال منطق بانٍ قائم بلا نسخه). */
    public function withKey(string $key): self
    {
        return new self($key, $this->family, $this->title, $this->description, $this->permissionsAny, $this->filters, $this->builder, $this->source, $this->orientation, $this->thermal);
    }

    /** @return array<string,mixed> */
    public function toArray(): array
    {
        return [
            'key' => $this->key,
            'family' => $this->family,
            'title' => $this->title,
            'description' => $this->description,
            'filters' => $this->filters,
            'source' => $this->source,
            'orientation' => $this->orientation,
            'thermal' => $this->thermal,
        ];
    }
}
