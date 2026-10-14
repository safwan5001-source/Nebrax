<?php

namespace Tests\Feature;

use App\Support\Commerce\CommerceFacetVisualNormalizer;
use App\Support\Commerce\CommerceFacetVisualResolver;
use App\Support\Commerce\FacetVisualRegistry;
use App\Support\Commerce\IconRegistry;
use Tests\TestCase;

/**
 * AWJ-VD-H1 / VD-1a — عقد الهوية المرئية للأبعاد الوصفية (§3.3–§3.6، D-08، D-09، D-10، D-11).
 *
 * الفيكستشران المشتركان يقودان PHP والتوأمين TS معاً، فلا يمكن أن تنحرف الثلاثة بصمت.
 * لا قاعدة بيانات ولا API هنا: هذه الشريحة كودٌ نقيّ.
 *
 * تشغيل: php artisan test --filter=CommerceFacetVisualContractTest
 */
class CommerceFacetVisualContractTest extends TestCase
{
    private const M1 = '0b8f6c2e-3d3a-4a53-9c7e-8f1a2b3c4d5e';

    /** @return array<string,mixed> */
    private function fixture(string $name): array
    {
        return json_decode((string) file_get_contents(base_path("tests/Fixtures/presentation/{$name}.json")), true, flags: JSON_THROW_ON_ERROR);
    }

    // ═════════════════ التطبيع: تكافؤ الفيكستشر ═════════════════

    /** @test */
    public function value_normalisation_matches_the_shared_fixture_in_key_order_and_is_idempotent(): void
    {
        $cases = $this->fixture('facet-visual')['value'];
        $this->assertGreaterThanOrEqual(25, count($cases));

        foreach ($cases as $case) {
            $actual = CommerceFacetVisualNormalizer::normalizeValue($case['input']);
            $this->assertEquals($case['expected'], $actual, $case['name']);
            $this->assertSame(array_keys($case['expected']), array_keys($actual), $case['name'].' (key order)');
            if (isset($actual['image'])) {
                $this->assertSame(array_keys($case['expected']['image']), array_keys($actual['image']), $case['name'].' (image key order)');
            }
            $this->assertEquals($actual, CommerceFacetVisualNormalizer::normalizeValue($actual), $case['name'].' (idempotent)');
        }
    }

    /** @test */
    public function facet_normalisation_matches_the_shared_fixture_and_is_idempotent(): void
    {
        foreach ($this->fixture('facet-visual')['facet'] as $case) {
            $actual = CommerceFacetVisualNormalizer::normalizeFacet($case['input']);
            $this->assertEquals($case['expected'], $actual, $case['name']);
            $this->assertSame(array_keys($case['expected']), array_keys($actual), $case['name'].' (key order)');
            foreach (['self', 'defaults'] as $part) {
                if (isset($actual[$part])) {
                    $this->assertSame(array_keys($case['expected'][$part]), array_keys($actual[$part]), "{$case['name']} ({$part} key order)");
                }
            }
            $this->assertEquals($actual, CommerceFacetVisualNormalizer::normalizeFacet($actual), $case['name'].' (idempotent)');
        }
    }

    /** @test */
    public function crop_and_rotate_can_never_reach_a_normalised_image(): void
    {
        $out = CommerceFacetVisualNormalizer::normalizeValue(['image' => [
            'mediaId' => self::M1,
            'crop' => ['x' => 0.1, 'y' => 0.1, 'w' => 0.5, 'h' => 0.5, 'aspect' => '1:1', 'zoom' => 2],
            'rotate' => 90,
        ]]);

        $this->assertSame(['image' => ['mediaId' => self::M1]], $out);
    }

    // ═════════════════ الوراثة لكل خاصية ═════════════════

    /** @test */
    public function value_resolution_matches_the_shared_inheritance_fixture(): void
    {
        $cases = $this->fixture('facet-visual-inheritance')['value'];
        $this->assertGreaterThanOrEqual(15, count($cases));

        foreach ($cases as $case) {
            $actual = CommerceFacetVisualResolver::resolveValue($case['facet'], $case['value'], $case['context']);
            $this->assertEquals($case['expected']['visual'], $actual['visual'], $case['name'].' (visual)');
            $this->assertSame(array_keys($case['expected']['visual']), array_keys($actual['visual']), $case['name'].' (visual key order)');
            $this->assertEquals($case['expected']['sources'], $actual['sources'], $case['name'].' (sources)');
        }
    }

    /** @test */
    public function facet_self_resolution_matches_the_shared_inheritance_fixture(): void
    {
        foreach ($this->fixture('facet-visual-inheritance')['self'] as $case) {
            $actual = CommerceFacetVisualResolver::resolveFacetSelf($case['facet'], $case['context']);
            $this->assertEquals($case['expected']['visual'], $actual['visual'], $case['name'].' (visual)');
            $this->assertSame(array_keys($case['expected']['visual']), array_keys($actual['visual']), $case['name'].' (visual key order)');
            $this->assertEquals($case['expected']['sources'], $actual['sources'], $case['name'].' (sources)');
        }
    }

    /**
     * @test
     *
     * D-08: تخصيص خاصية واحدة على القيمة لا يغيّر أيّ خاصية أخرى موروثة — لكل خاصية على حدة.
     */
    public function customising_one_property_never_cancels_inheritance_of_another(): void
    {
        $defaults = ['content' => 'icon', 'icon' => 'gift', 'iconColor' => '#9d2449', 'background' => '#fdf2f4',
            'shape' => 'arch', 'size' => 'lg', 'fit' => 'contain', 'showLabel' => false];
        $baseline = CommerceFacetVisualResolver::resolveValue(['defaults' => $defaults], [])['visual'];

        $overrides = [
            'shape' => 'heart', 'size' => 'sm', 'showLabel' => true, 'icon' => 'cake',
            'iconColor' => '#111111', 'background' => '#ffffff',
        ];
        foreach ($overrides as $key => $value) {
            $resolved = CommerceFacetVisualResolver::resolveValue(['defaults' => $defaults], [$key => $value])['visual'];
            $this->assertSame($value, $resolved[$key], "{$key} override applies");
            foreach (['shape', 'size', 'showLabel', 'icon', 'iconColor', 'background'] as $other) {
                if ($other !== $key) {
                    $this->assertSame($baseline[$other], $resolved[$other], "{$key} override keeps {$other} inherited");
                }
            }
        }

        // صورة القيمة نفسها: تغيّر المحتوى فقط؛ الشكل والحجم والاسم وفيت الافتراضات تبقى موروثة.
        $withImage = CommerceFacetVisualResolver::resolveValue(['defaults' => $defaults], ['image' => ['mediaId' => self::M1]])['visual'];
        $this->assertSame('image', $withImage['content']);
        $this->assertSame(['arch', 'lg', false, 'contain'], [$withImage['shape'], $withImage['size'], $withImage['showLabel'], $withImage['image']['fit']]);
    }

    // ═════════════════ التحقق الصارم لمسار الكتابة (D-11) ═════════════════

    /** @test */
    public function strict_validation_accepts_every_normalised_fixture_value(): void
    {
        foreach ($this->fixture('facet-visual')['value'] as $case) {
            if ($case['expected'] !== []) {
                $this->assertSame([], CommerceFacetVisualNormalizer::errors($case['expected'], 'value'), $case['name']);
            }
        }
        foreach ($this->fixture('facet-visual')['facet'] as $case) {
            if ($case['expected'] !== []) {
                $this->assertSame([], CommerceFacetVisualNormalizer::errors($case['expected'], 'facet'), $case['name']);
            }
        }
    }

    /** @test */
    public function strict_validation_reports_field_errors_instead_of_dropping_silently(): void
    {
        $errors = CommerceFacetVisualNormalizer::errors([
            'content' => 'video',
            'icon' => 'balloon',
            'shape' => 'blob',
            'size' => 'xl',
            'iconColor' => 'red',
            'showLabel' => 'yes',
            'html' => '<b>x</b>',
            'image' => [
                'mediaId' => 'nope',
                'crop' => ['x' => 0],
                'rotate' => 90,
                'fit' => 'fill',
                'focal' => ['x' => 120, 'y' => 0],
                'zoom' => 4,
                'alt' => ['ar' => str_repeat('ب', 151)],
                'decorative' => 'true',
                'url' => 'https://x',
            ],
        ], 'value');

        $this->assertEqualsCanonicalizing([
            ['field' => 'html', 'code' => 'unknown_field'],
            ['field' => 'content', 'code' => 'invalid_value'],
            ['field' => 'image.crop', 'code' => 'forbidden'],
            ['field' => 'image.rotate', 'code' => 'forbidden'],
            ['field' => 'image.url', 'code' => 'unknown_field'],
            ['field' => 'image.mediaId', 'code' => 'invalid_media_id'],
            ['field' => 'image.fit', 'code' => 'invalid_value'],
            ['field' => 'image.focal', 'code' => 'invalid_value'],
            ['field' => 'image.zoom', 'code' => 'out_of_range'],
            ['field' => 'image.alt', 'code' => 'invalid_value'],
            ['field' => 'image.decorative', 'code' => 'invalid_value'],
            ['field' => 'icon', 'code' => 'unknown_icon'],
            ['field' => 'iconColor', 'code' => 'invalid_color'],
            ['field' => 'shape', 'code' => 'unknown_shape'],
            ['field' => 'size', 'code' => 'invalid_value'],
            ['field' => 'showLabel', 'code' => 'invalid_value'],
        ], $errors);
    }

    /** @test */
    public function strict_validation_of_a_facet_scopes_errors_to_self_and_defaults(): void
    {
        $this->assertEqualsCanonicalizing([
            ['field' => 'extra', 'code' => 'unknown_field'],
            ['field' => 'self.fit', 'code' => 'unknown_field'],
            ['field' => 'defaults.image', 'code' => 'unknown_field'],
            ['field' => 'defaults.shape', 'code' => 'unknown_shape'],
        ], CommerceFacetVisualNormalizer::errors([
            'self' => ['fit' => 'contain', 'shape' => 'arch'],
            'defaults' => ['image' => ['mediaId' => self::M1], 'shape' => 'blob'],
            'extra' => 1,
        ], 'facet'));

        $this->assertSame([['field' => 'self', 'code' => 'invalid_object']], CommerceFacetVisualNormalizer::errors(['self' => 'arch'], 'facet'));
        $this->assertSame([['field' => 'visual', 'code' => 'invalid_object']], CommerceFacetVisualNormalizer::errors('arch', 'value'));
        $this->assertSame([['field' => 'visual', 'code' => 'invalid_object']], CommerceFacetVisualNormalizer::errors([['shape' => 'arch']], 'value'));
        // null لأي مفتاح = «ورِّث»، و{} = تفريغ صالح (tombstone، D-17).
        $this->assertSame([], CommerceFacetVisualNormalizer::errors(['shape' => null, 'image' => null], 'value'));
        $this->assertSame([], CommerceFacetVisualNormalizer::errors([], 'facet'));
    }

    // ═════════════════ القوائم المغلقة ═════════════════

    /** @test */
    public function the_closed_lists_are_pinned(): void
    {
        $this->assertSame(['circle', 'square', 'rounded', 'landscape', 'portrait', 'oval', 'star', 'heart', 'diamond', 'hexagon', 'vase', 'arch'], FacetVisualRegistry::SHAPES);
        $this->assertSame(['image', 'icon', 'none'], FacetVisualRegistry::CONTENTS);
        $this->assertSame(['sm', 'md', 'lg'], FacetVisualRegistry::SIZES);
        $this->assertSame(['cover', 'contain'], FacetVisualRegistry::FITS);
    }

    /** @test */
    public function the_icon_registry_only_grows_at_its_end(): void
    {
        $this->assertCount(52, IconRegistry::KEYS);
        $this->assertSame(IconRegistry::KEYS, array_values(array_unique(IconRegistry::KEYS)));
        // المفاتيح الأربعة والعشرون الأصلية في مواضعها نفسها: الإضافة إلحاقٌ لا إعادة ترتيب.
        $this->assertSame([
            'truck', 'shield-check', 'credit-card', 'gift', 'clock', 'phone', 'message-circle', 'mail',
            'map-pin', 'store', 'star', 'heart', 'tag', 'percent', 'package', 'refresh-ccw',
            'headphones', 'leaf', 'sparkles', 'badge-check', 'calendar', 'users', 'lock', 'globe',
        ], array_slice(IconRegistry::KEYS, 0, 24));
    }
}
