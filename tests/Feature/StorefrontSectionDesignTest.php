<?php

namespace Tests\Feature;

use App\Support\Commerce\StorefrontPresentationNormalizer;
use App\Support\Commerce\StorefrontSectionDesignNormalizer as N;
use PHPUnit\Framework\TestCase;

/**
 * CUST-HV V5b — عقد التصميم المكتوب للقسم (V0 §3): تكافؤ مع ملف الحالات المشترك
 * (يشغّله توأما TS) وسجلّ القدرات، وسلوك «غياب التصميم ⇒ بلا تغيير» داخل الوثيقة.
 */
class StorefrontSectionDesignTest extends TestCase
{
    /** @return array<string,mixed> */
    private function fixture(): array
    {
        return json_decode((string) file_get_contents(__DIR__.'/../Fixtures/presentation/section-design.json'), true, 512, JSON_THROW_ON_ERROR);
    }

    /** @test */
    public function the_shared_fixture_reproduces_exactly_including_key_order_and_idempotence(): void
    {
        foreach ($this->fixture()['cases'] as $case) {
            $out = N::normalize($case['type'], $case['input']);
            $this->assertSame($case['expected'], $out, $case['name']);
            $this->assertSame(json_encode($case['expected']), json_encode($out), $case['name'].' (key order)');
            $this->assertSame($out, N::normalize($case['type'], $out), $case['name'].' (idempotent)');
        }
    }

    /** @test */
    public function the_capability_registry_matches_the_shared_snapshot(): void
    {
        $this->assertSame($this->fixture()['capabilities'], N::capabilities());
    }

    /** @test */
    public function every_section_type_the_builder_knows_has_a_registry_entry(): void
    {
        $types = array_merge(StorefrontPresentationNormalizer::HOME_BUILDER_SECTION_KEYS, StorefrontPresentationNormalizer::HOME_DATA_SECTION_KEYS);
        foreach ($types as $type) {
            $this->assertArrayHasKey($type, N::capabilities(), "section type {$type} must declare its design capability");
        }
    }

    /** @test */
    public function a_document_without_design_is_byte_identical_and_the_version_stays_three(): void
    {
        $n = new StorefrontPresentationNormalizer;
        $plain = $n->normalize(['homepage' => ['sections' => [['id' => 's1', 'type' => 'hero', 'visible' => true]]]]);
        $this->assertArrayNotHasKey('design', $plain['homepage']['sections'][0]);
        $this->assertSame(3, $plain['version']);

        $junk = $n->normalize(['homepage' => ['sections' => [['id' => 's1', 'type' => 'hero', 'visible' => true, 'design' => ['radius' => 'nope', 'style' => 'x']]]]]);
        $this->assertSame($plain, $junk);
        foreach ($n->normalize([])['homepage']['sections'] as $section) {
            $this->assertArrayNotHasKey('design', $section);
        }
    }

    /** @test */
    public function a_declared_group_is_kept_after_content_and_the_document_is_idempotent(): void
    {
        $n = new StorefrontPresentationNormalizer;
        $config = $n->normalize(['homepage' => ['sections' => [
            ['id' => 'w1', 'type' => 'wholesale', 'visible' => true, 'design' => ['radius' => 'pill', 'spacing' => ['top' => 'sm']]],
            ['id' => 'h1', 'type' => 'hero', 'visible' => true, 'design' => ['spacing' => ['top' => 'lg'], 'radius' => 'md']],
        ]]]);
        $this->assertSame(['spacing' => ['top' => 'sm']], $config['homepage']['sections'][0]['design']);
        $this->assertSame(['spacing' => ['top' => 'lg'], 'radius' => 'md'], $config['homepage']['sections'][1]['design']);
        $this->assertSame($config, $n->normalize($config));
    }
}
