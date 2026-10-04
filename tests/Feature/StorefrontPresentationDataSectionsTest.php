<?php

namespace Tests\Feature;

use App\Support\Commerce\StorefrontPresentationNormalizer;
use Tests\TestCase;

/**
 * FLOWERS-H9a / ADR-21 — محتوى الأقسام المرتبطة بالبيانات (productShelf / discovery / deliveryPromise): مراجع مصدر
 * ونصّ تحريري فقط، fail-closed، والمحتوى الفارغ يُحذف. الحالات مشتركة مع توأمَي TS (web + storefront) عبر
 * `tests/Fixtures/presentation/data-sections.json`، فلا ينحرف أحد الثلاثة بصمت.
 *
 * تشغيل: php artisan test --filter=StorefrontPresentationDataSectionsTest
 */
class StorefrontPresentationDataSectionsTest extends TestCase
{
    private StorefrontPresentationNormalizer $normalizer;

    protected function setUp(): void
    {
        parent::setUp();
        $this->normalizer = new StorefrontPresentationNormalizer();
    }

    /** @return array<string, mixed>|null */
    private function contentOf(string $type, mixed $input): ?array
    {
        $normalized = $this->normalizer->normalize([
            'version' => 2,
            'homepage' => ['sections' => [['id' => 'sec-a', 'type' => $type, 'visible' => true, 'content' => $input]]],
        ]);
        $row = collect($normalized['homepage']['sections'])->firstWhere('id', 'sec-a');
        $this->assertNotNull($row, "the {$type} section itself must survive normalization");

        return $row['content'] ?? null;
    }

    /** @param array<mixed> $value */
    private function canonical(array $value): array
    {
        ksort($value);
        foreach ($value as $k => $v) {
            if (is_array($v)) {
                $value[$k] = array_is_list($v) ? $v : $this->canonical($v);
            }
        }

        return $value;
    }

    /** @test */
    public function the_shared_fixture_cases_normalize_identically(): void
    {
        $fixture = json_decode((string) file_get_contents(dirname(__DIR__).'/Fixtures/presentation/data-sections.json'), true);
        $this->assertNotEmpty($fixture['cases']);

        foreach ($fixture['cases'] as $case) {
            $actual = $this->contentOf($case['type'], $case['input']);
            if ($case['expected'] === null) {
                $this->assertNull($actual, $case['name']);

                continue;
            }
            $this->assertIsArray($actual, $case['name']);
            $this->assertSame($this->canonical($case['expected']), $this->canonical($actual), $case['name']);
        }
    }

    /** @test */
    public function the_three_types_are_accepted_for_storage_without_changing_the_default_document_and_absent_content_is_omitted(): void
    {
        foreach (['productShelf', 'discovery', 'deliveryPromise'] as $type) {
            $this->assertContains($type, StorefrontPresentationNormalizer::HOME_DATA_SECTION_KEYS);
            $this->assertNotContains($type, StorefrontPresentationNormalizer::HOME_BUILDER_SECTION_KEYS, 'the default document must not change before the builder ships these');
            $normalized = $this->normalizer->normalize([
                'version' => 2,
                'homepage' => ['sections' => [['id' => 'sec-a', 'type' => $type, 'visible' => true]]],
            ]);
            $row = collect($normalized['homepage']['sections'])->firstWhere('id', 'sec-a');
            $this->assertSame($type, $row['type']);
            $this->assertArrayNotHasKey('content', $row);
        }
    }

    /** @test */
    public function normalization_is_idempotent_for_the_new_content(): void
    {
        $input = ['version' => 2, 'homepage' => ['sections' => [
            ['id' => 'shelf-a', 'type' => 'productShelf', 'visible' => true, 'content' => ['title' => 'مميزة', 'source' => ['kind' => 'facet', 'key' => 'occasion', 'value' => 'eid'], 'deliverToday' => true, 'limit' => 4]],
            ['id' => 'disc-a', 'type' => 'discovery', 'visible' => true, 'content' => ['dimension' => 'recipient', 'display' => 'chips']],
            ['id' => 'prom-a', 'type' => 'deliveryPromise', 'visible' => false, 'content' => ['title' => 'اليوم']],
        ]]];

        $once = $this->normalizer->normalize($input);
        $twice = $this->normalizer->normalize($once);

        $this->assertSame($once['homepage']['sections'], $twice['homepage']['sections']);
        $this->assertSame(3, count($once['homepage']['sections']));
    }
}
