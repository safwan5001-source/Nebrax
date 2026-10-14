<?php

namespace Tests\Feature;

use App\Support\Commerce\DiscoveryTemplateRegistry;
use App\Support\Commerce\StorefrontPresentationNormalizer;
use Tests\TestCase;

/**
 * AWJ-VD-H1 / VD-4a — the `discovery` display contract (§3.7).
 *
 * `StorefrontPresentationDataSectionsTest` already compares the shared fixture after sorting keys; this test adds what
 * the contract needs on top: the **exact** key order (byte-identical documents), idempotency, the template registry
 * pinned to its own fixture, and legacy documents left untouched.
 */
class DiscoveryDisplayContractTest extends TestCase
{
    private StorefrontPresentationNormalizer $normalizer;

    protected function setUp(): void
    {
        parent::setUp();
        $this->normalizer = new StorefrontPresentationNormalizer();
    }

    /** @return array<string, mixed>|null */
    private function discovery(mixed $content): ?array
    {
        $normalized = $this->normalizer->normalize([
            'version' => 2,
            'homepage' => ['sections' => [['id' => 'sec-a', 'type' => 'discovery', 'visible' => true, 'content' => $content]]],
        ]);
        $row = collect($normalized['homepage']['sections'])->firstWhere('id', 'sec-a');

        return $row['content'] ?? null;
    }

    /** @return list<array{name: string, type: string, input: mixed, expected: array<string, mixed>|null}> */
    private function discoveryCases(): array
    {
        $fixture = json_decode((string) file_get_contents(dirname(__DIR__).'/Fixtures/presentation/data-sections.json'), true);

        return array_values(array_filter($fixture['cases'], static fn (array $case) => $case['type'] === 'discovery'));
    }

    /** @test */
    public function discovery_cases_normalize_to_the_exact_fixture_output_and_key_order(): void
    {
        $cases = $this->discoveryCases();
        $this->assertGreaterThanOrEqual(10, count($cases));

        foreach ($cases as $case) {
            $this->assertSame($case['expected'], $this->discovery($case['input']), $case['name']);
        }
    }

    /** @test */
    public function normalization_is_idempotent(): void
    {
        foreach ($this->discoveryCases() as $case) {
            $once = $this->discovery($case['input']);
            if ($once !== null) {
                $this->assertSame($once, $this->discovery($once), $case['name']);
            }
        }
    }

    /** @test */
    public function a_legacy_discovery_section_is_byte_identical_to_before(): void
    {
        $legacy = ['title' => 'تسوّق حسب المناسبة', 'axis' => 'facet', 'dimension' => 'occasion', 'display' => 'chips'];

        $this->assertSame(
            json_encode($legacy, JSON_UNESCAPED_UNICODE),
            json_encode($this->discovery($legacy), JSON_UNESCAPED_UNICODE),
        );
        // The default document carries no discovery section and is unchanged by this slice.
        $this->assertNotContains('discovery', StorefrontPresentationNormalizer::HOME_BUILDER_SECTION_KEYS);
    }

    /** @test */
    public function the_template_registry_equals_its_shared_fixture_in_ids_order_and_values(): void
    {
        $fixture = json_decode((string) file_get_contents(dirname(__DIR__).'/Fixtures/presentation/discovery-templates.json'), true);

        $this->assertSame($fixture['templates'], DiscoveryTemplateRegistry::TEMPLATES);
        // Append-only: the shipped ids keep their position.
        $this->assertSame(
            ['gift-circles', 'boutique-arches', 'editorial-portrait', 'market-icons', 'swipe-rail', 'minimal-text', 'catalog-rounded'],
            array_slice(DiscoveryTemplateRegistry::ids(), 0, 7),
        );
    }

    /** @test */
    public function every_template_is_itself_valid_content(): void
    {
        foreach (DiscoveryTemplateRegistry::TEMPLATES as $id => $template) {
            $normalized = $this->discovery(['dimension' => 'occasion', 'template' => $id] + $template);

            $this->assertSame($id, $normalized['template'], $id);
            foreach ($template as $key => $value) {
                $this->assertSame($value, $normalized[$key], "{$id}.{$key}");
            }
        }
    }
}
