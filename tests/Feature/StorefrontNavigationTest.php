<?php

namespace Tests\Feature;

use App\Support\Commerce\IconRegistry;
use App\Support\Commerce\StorefrontPresentationNormalizer;
use PHPUnit\Framework\TestCase;

/**
 * CUST-HV V7d-2 — وثيقة التنقّل `navigation` (V0 §11): مفتاح اختياري إضافي، الإصدار يبقى 3.
 * نفس ملف الحالات يشغّله توأما TS (`navigation.test.ts` في web وstorefront).
 */
class StorefrontNavigationTest extends TestCase
{
    /** @return array<string,mixed> */
    private function normalize(array $input): array
    {
        return (new StorefrontPresentationNormalizer)->normalize($input);
    }

    /** @test */
    public function the_shared_fixture_reproduces_exactly(): void
    {
        $fixture = json_decode((string) file_get_contents(__DIR__.'/../Fixtures/presentation/navigation.json'), true, 512, JSON_THROW_ON_ERROR);
        $this->assertNotEmpty($fixture['cases']);
        foreach ($fixture['cases'] as $case) {
            $config = $this->normalize(['navigation' => $case['input']]);
            if ($case['expected'] === null) {
                $this->assertArrayNotHasKey('navigation', $config, $case['name']);
            } else {
                $this->assertSame($case['expected'], $config['navigation'], $case['name']);
            }
        }
    }

    /** @test */
    public function a_document_without_navigation_is_byte_identical_and_the_version_stays_three(): void
    {
        $plain = $this->normalize([]);
        $this->assertArrayNotHasKey('navigation', $plain);
        $this->assertSame(3, $plain['version']);
        $this->assertSame($plain, $this->normalize(['navigation' => ['menus' => 'nope']]));
    }

    /** @test */
    public function navigation_rides_beside_the_legacy_header_links_without_touching_them(): void
    {
        $config = $this->normalize([
            'header' => ['links' => [['id' => 'l1', 'label' => 'Legacy', 'kind' => 'internal', 'href' => '/', 'enabled' => true]]],
            'navigation' => ['menus' => [['id' => 'main', 'items' => [['id' => 'a', 'label' => 'A', 'target' => ['kind' => 'home']]]]]],
        ]);
        $this->assertCount(1, $config['header']['links']);
        $this->assertSame('main', $config['navigation']['menus'][0]['id']);
    }

    /** @test */
    public function external_targets_pass_through_the_shared_url_sanitiser(): void
    {
        $config = $this->normalize(['navigation' => ['menus' => [['id' => 'main', 'items' => [
            ['id' => 'a', 'label' => 'A', 'target' => ['kind' => 'external', 'href' => 'javascript:alert(1)']],
            ['id' => 'b', 'label' => 'B', 'target' => ['kind' => 'external', 'href' => 'https://example.com/x', 'newTab' => true]],
        ]]]]]);
        $items = $config['navigation']['menus'][0]['items'];
        $this->assertCount(1, $items);
        $this->assertSame('b', $items[0]['id']);
    }

    /** @test */
    public function the_icon_registry_is_the_pinned_twenty_four(): void
    {
        $this->assertCount(24, IconRegistry::KEYS);
        $this->assertSame(IconRegistry::KEYS, array_values(array_unique(IconRegistry::KEYS)));
    }
}
