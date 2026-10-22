<?php

namespace Tests\Feature;

use App\Support\ProductImportValueNormalizer;
use Tests\TestCase;

/**
 * IMP-H2-S2 — جدول صدقٍ واحد لمصدر الحكم المشترك بين الاستخراج والمراجعة والمعاينة (`ProductImportValueNormalizer::isValid`).
 */
class ProductImportValueAgreementTest extends TestCase
{
    /** @return array<string, array{0: string, 1: mixed, 2: bool}> */
    public static function cells(): array
    {
        return [
            'money plain' => ['sale_price', '10.50', true],
            'money arabic digits and separators' => ['sale_price', '١٬٢٣٤٫٥٠', true],
            'money three decimals' => ['sale_price', '10.123', false],
            'money negative' => ['sale_price', '-5', false],
            'money text' => ['sale_price', 'abc', false],
            'blank is valid (required is a separate check)' => ['sale_price', '', true],
            'null is valid' => ['sale_price', null, true],
            'percent with sign' => ['tax_rate', '15%', true],
            'percent decimal' => ['tax_rate', '15.5', false],
            'percent over 100' => ['tax_rate', '101', false],
            'integer' => ['reorder_level', '25', true],
            'integer arabic grouping' => ['reorder_level', '١٬٢٠٠', true],
            'integer negative' => ['reorder_level', '-1', false],
            'boolean yes' => ['track_inventory', 'نعم', true],
            'boolean junk' => ['track_inventory', 'ربما', false],
            'enum alias' => ['type', 'خدمة', true],
            'enum junk' => ['type', 'شيء', false],
            'array is invalid' => ['name', ['x'], false],
            'too long text' => ['tags', str_repeat('x', 501), false],
            'unknown field is left alone' => ['not_a_field', 'whatever', true],
        ];
    }

    /**
     * @test
     *
     * @dataProvider cells
     */
    public function the_shared_verdict(string $field, mixed $raw, bool $expected): void
    {
        $this->assertSame($expected, ProductImportValueNormalizer::isValid($field, $raw));
    }
}
