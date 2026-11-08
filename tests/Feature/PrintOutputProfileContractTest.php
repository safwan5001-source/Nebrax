<?php

namespace Tests\Feature;

use App\Support\PrintOutputProfile;
use App\Support\PrintOutputProfileException;
use App\Support\PrintTemplateContract;
use PHPUnit\Framework\TestCase;

/**
 * عقد AWJ Output Profile v1 (نقي، بلا قاعدة بيانات): مقابل الملف المشترك مع الواجهة
 * `contracts/print-templates/output-profile.v1.json`، وتكامله مع `assertDefinition`.
 * تشغيل:  php artisan test --filter=PrintOutputProfileContractTest
 */
class PrintOutputProfileContractTest extends TestCase
{
    /** @return array<string, mixed> */
    private function fixture(): array
    {
        $path = dirname(__DIR__, 2).'/contracts/print-templates/output-profile.v1.json';

        return json_decode((string) file_get_contents($path), true, 512, JSON_THROW_ON_ERROR);
    }

    /** @test */
    public function constants_match_the_shared_contract_file(): void
    {
        $f = $this->fixture();

        $this->assertSame(1, $f['version']);
        $this->assertSame(PrintOutputProfile::VERSION, $f['version']);
        $this->assertSame($f['papers'], PrintOutputProfile::PAPERS);
        $this->assertSame($f['custom_paper_id'], PrintOutputProfile::CUSTOM);
        $this->assertSame($f['limits']['custom_width_mm'], PrintOutputProfile::CUSTOM_WIDTH_MM);
        $this->assertSame($f['limits']['custom_height_mm'], PrintOutputProfile::CUSTOM_HEIGHT_MM);
        $this->assertSame($f['limits']['margin_mm'], PrintOutputProfile::MARGIN_MM);
        $this->assertSame($f['limits']['min_printable_mm'], PrintOutputProfile::MIN_PRINTABLE_MM);
        $this->assertSame($f['limits']['custom_default_margin_mm_page'], PrintOutputProfile::CUSTOM_DEFAULT_MARGIN_PAGE_MM);
        $this->assertSame($f['limits']['custom_default_margin_mm_roll'], PrintOutputProfile::CUSTOM_DEFAULT_MARGIN_ROLL_MM);
        $this->assertSame($f['enums']['orientation'], PrintOutputProfile::ORIENTATIONS);
        $this->assertSame($f['enums']['output_mode'], PrintOutputProfile::MODES);
        $this->assertSame($f['thermal_template_papers'], PrintOutputProfile::THERMAL_TEMPLATE_PAPERS);
    }

    /** @test */
    public function every_valid_case_normalizes_to_the_shared_canonical_form_and_is_idempotent(): void
    {
        foreach ($this->fixture()['valid'] as $case) {
            $normalized = PrintOutputProfile::normalize($case['input']);

            $this->assertSame($case['normalized'], $normalized, $case['name']);
            $this->assertSame($normalized, PrintOutputProfile::normalize($normalized), "{$case['name']} (idempotent)");
        }
    }

    /** @test */
    public function every_invalid_case_is_rejected_with_the_shared_reason_code(): void
    {
        $known = $this->fixture()['reasons'];

        foreach ($this->fixture()['invalid'] as $case) {
            $this->assertContains($case['reason'], $known, $case['name']);
            try {
                PrintOutputProfile::normalize($case['input']);
                $this->fail("قُبل ملف يجب رفضه: {$case['name']}");
            } catch (PrintOutputProfileException $e) {
                $this->assertSame($case['reason'], $e->reason, $case['name']);
                $this->assertNotSame('', $e->getMessage(), $case['name']);
            }
        }
    }

    /** @test */
    public function the_exception_is_a_runtime_exception_so_the_existing_422_path_handles_it(): void
    {
        $this->expectException(\RuntimeException::class);
        PrintOutputProfile::normalize(['paper' => 'a3']);
    }

    /** @test */
    public function the_supported_sizes_and_their_dimensions_are_the_ones_the_task_names(): void
    {
        $dims = fn (string $id): array => [
            PrintOutputProfile::PAPERS[$id]['width_mm'],
            PrintOutputProfile::PAPERS[$id]['height_mm'],
        ];

        $this->assertSame([210, 297], $dims('a4'));
        $this->assertSame([297, 210], $dims('a4_landscape'));
        $this->assertSame([148, 210], $dims('a5'));
        $this->assertSame([210, 148], $dims('a5_landscape'));
        $this->assertSame([105, 148], $dims('a6'));
        $this->assertSame([148, 105], $dims('a6_landscape'));
        $this->assertSame([216, 279], $dims('letter'));
        $this->assertSame([216, 356], $dims('legal'));
        $this->assertSame([58, null], $dims('thermal_58'));
        $this->assertSame([80, null], $dims('thermal_80'));
        $this->assertSame(
            ['a4', 'a4_landscape', 'a5', 'a5_landscape', 'a6', 'a6_landscape', 'letter', 'legal', 'thermal_58', 'thermal_80'],
            array_keys(PrintOutputProfile::PAPERS),
        );
    }

    /** @test */
    public function dimensions_resolve_fixed_and_custom_papers(): void
    {
        $this->assertSame(['width_mm' => 148, 'height_mm' => 105], PrintOutputProfile::dimensions(
            PrintOutputProfile::normalize(['paper' => 'a6', 'orientation' => 'landscape']),
        ));
        $this->assertSame(['width_mm' => 80, 'height_mm' => null], PrintOutputProfile::dimensions(
            PrintOutputProfile::normalize(['paper' => 'thermal_80']),
        ));
        $this->assertSame(['width_mm' => 100, 'height_mm' => 150], PrintOutputProfile::dimensions(
            PrintOutputProfile::normalize(['paper' => 'custom', 'custom' => ['width_mm' => 100, 'height_mm' => 150]]),
        ));
        $this->assertSame(['width_mm' => 72, 'height_mm' => null], PrintOutputProfile::dimensions(
            PrintOutputProfile::normalize(['paper' => 'custom', 'custom' => ['width_mm' => 72]]),
        ));
    }

    /** @test */
    public function a_definition_without_an_output_profile_is_untouched_and_keeps_its_checksum(): void
    {
        $legacy = ['page' => ['size' => 'a4', 'direction' => 'rtl'], 'template' => 'classic'];
        $withLayout = ['template_id' => 'tax-invoice-classic', 'theme_id' => 'blue', 'footer_text' => 'تذييل'];

        foreach ([$legacy, $withLayout] as $definition) {
            $out = PrintTemplateContract::assertDefinition($definition, ['tax_invoice']);

            $this->assertSame(PrintTemplateContract::canonicalize($definition), $out);
            $this->assertArrayNotHasKey('output_profile', $out);
            $this->assertSame(
                PrintTemplateContract::checksum($definition),
                PrintTemplateContract::checksum($out),
            );
        }
    }

    /** @test */
    public function a_definition_with_a_profile_stores_it_normalized_and_changes_the_checksum(): void
    {
        $base = ['template_id' => 'tax-invoice-classic'];
        $out = PrintTemplateContract::assertDefinition(
            [...$base, 'output_profile' => ['paper' => 'a5', 'orientation' => 'landscape']],
            ['tax_invoice'],
        );

        $this->assertSame('a5_landscape', $out['output_profile']['paper']);
        $this->assertEquals(['top' => 10, 'right' => 10, 'bottom' => 10, 'left' => 10], $out['output_profile']['margins_mm']);
        $this->assertNotSame(PrintTemplateContract::checksum($base), PrintTemplateContract::checksum($out));

        // إعادة التحقق من المخزَّن (كما يفعل النشر) لا تغيّر شيئاً.
        $this->assertSame($out, PrintTemplateContract::assertDefinition($out, ['tax_invoice']));
    }

    /** @test */
    public function an_explicit_null_profile_is_dropped_instead_of_stored(): void
    {
        $out = PrintTemplateContract::assertDefinition(
            ['template_id' => 'tax-invoice-classic', 'output_profile' => null],
            ['tax_invoice'],
        );

        $this->assertArrayNotHasKey('output_profile', $out);
        $this->assertSame(['template_id' => 'tax-invoice-classic'], $out);
    }

    /** @test */
    public function the_profile_is_validated_for_every_document_type_and_layout_combination(): void
    {
        foreach (PrintTemplateContract::DOCUMENT_TYPES as $type) {
            $out = PrintTemplateContract::assertDefinition(['output_profile' => ['paper' => 'a6']], [$type]);
            $this->assertSame('a6', $out['output_profile']['paper'], $type);
        }
    }

    /** @test */
    public function an_invalid_profile_rejects_the_whole_definition(): void
    {
        $this->expectException(PrintOutputProfileException::class);
        PrintTemplateContract::assertDefinition(
            ['template_id' => 'tax-invoice-classic', 'output_profile' => ['paper' => 'a4', 'css' => 'x']],
            ['tax_invoice'],
        );
    }

    /** @test */
    public function a_registered_thermal_template_must_use_its_own_width(): void
    {
        $this->assertSame(
            'thermal_58',
            PrintTemplateContract::assertDefinition(
                ['template_id' => 'tax-invoice-thermal58', 'output_profile' => ['paper' => 'thermal_58']],
                ['tax_invoice'],
            )['output_profile']['paper'],
        );
        $this->assertSame(
            'thermal_80',
            PrintTemplateContract::assertDefinition(
                ['template_id' => 'tax-invoice-thermal80', 'output_profile' => ['paper' => 'thermal_80']],
                ['tax_invoice'],
            )['output_profile']['paper'],
        );

        foreach ([
            ['tax-invoice-thermal80', ['paper' => 'thermal_58']],
            ['tax-invoice-thermal58', ['paper' => 'thermal_80']],
            ['tax-invoice-thermal80', ['paper' => 'a4']],
            ['tax-invoice-thermal58', ['paper' => 'custom', 'custom' => ['width_mm' => 58]]],
        ] as [$templateId, $profile]) {
            try {
                PrintTemplateContract::assertDefinition(
                    ['template_id' => $templateId, 'output_profile' => $profile],
                    ['tax_invoice'],
                );
                $this->fail("قُبل ملف لا يطابق {$templateId}");
            } catch (PrintOutputProfileException $e) {
                $this->assertSame('thermal_template_paper_mismatch', $e->reason);
            }
        }
    }

    /** @test */
    public function a_non_thermal_template_is_not_restricted_by_the_contract_layer(): void
    {
        // ملاءمة التصميم لمقاس لم يُصمَّم له قرار طبقة الإخراج (PR3-B) عبر supportedPaper.
        $out = PrintTemplateContract::assertDefinition(
            ['template_id' => 'tax-invoice-classic', 'output_profile' => ['paper' => 'thermal_80']],
            ['tax_invoice'],
        );

        $this->assertSame('thermal_80', $out['output_profile']['paper']);
    }

    /** @test */
    public function the_profile_never_accepts_free_text_or_css(): void
    {
        $attacks = [
            ['paper' => 'a4', 'margins_mm' => ['top' => '10mm']],
            ['paper' => 'a4', 'margins_mm' => ['top' => 'calc(1px)']],
            ['paper' => 'a4', 'size' => 'A4 landscape; margin: 0'],
            ['paper' => 'a4', 'css' => '@page{size:1px}'],
            ['paper' => "a4\n@page{size:1px}"],
            ['paper' => 'custom', 'custom' => ['width_mm' => '100mm', 'height_mm' => 150]],
            ['paper' => 'custom', 'custom' => ['width_mm' => 100, 'height_mm' => 150, 'unit' => 'px']],
            ['paper' => 'a4', 'orientation' => 'landscape; transform: rotate(90deg)'],
            ['paper' => 'a4', 'output_mode' => 'roll; display: none'],
        ];

        foreach ($attacks as $attack) {
            try {
                PrintOutputProfile::normalize($attack);
                $this->fail('قُبل مدخل خطر: '.json_encode($attack, JSON_UNESCAPED_UNICODE));
            } catch (PrintOutputProfileException $e) {
                $this->assertContains($e->reason, $this->fixture()['reasons']);
            }
        }
    }
}
