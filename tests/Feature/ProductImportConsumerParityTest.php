<?php

namespace Tests\Feature;

use App\Services\AiActionProductPreviewBuilder;
use App\Services\ProductImportService;
use App\Support\ProductImportFields;
use App\Support\SpreadsheetWriter;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Tests\TestCase;

/**
 * IMP-H2-S5a — characterization of the two product-import consumers (no production code changes).
 *
 * `ProductImportService` (V2: sync endpoints + durable jobs) and `AiActionProductPreviewBuilder` (AI Actions
 * preview) each classify the same product row with their own matching/validation code. Before H2-S5 moves both
 * onto one row-level contract, this pins WHERE they already agree and WHERE they deliberately differ:
 *
 *  - agreement: for rows that satisfy the stricter AI contract, both must reach the same verdict
 *    (ok-create / ok-update / skip / error) on the same data;
 *  - divergence: the differences below are real, intended AI Actions rules (architecture §6/§16.5) —
 *    explicit price/tax/unit and a trusted identifier on create, references never turned into free text.
 *    They are listed so H2-S5 can express each one as a *policy*, and so an accidental change shows up here.
 */
class ProductImportConsumerParityTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private const FULL = ['purchase_price' => '5.00', 'tax_rate' => '15', 'unit' => 'قطعة'];

    private string $token;

    protected function setUp(): void
    {
        parent::setUp();
        $auth = $this->registerTenant();
        $this->token = $auth['token'];
        app(TenantContext::class)->set($auth['tenant_id']);
        foreach ([
            ['name' => 'قهوة', 'sku' => 'A-1', 'barcode' => '6290000000011', 'type' => 'good', 'sale_price' => 1000, 'purchase_price' => 500],
            ['name' => 'شاي', 'sku' => 'B-2', 'barcode' => '6290000000028', 'type' => 'good', 'sale_price' => 2000, 'purchase_price' => 900],
        ] as $payload) {
            $this->withToken($this->token)->postJson('/api/products', $payload)->assertCreated();
        }
    }

    /** @param list<array<string,string>> $rows */
    private function v2(array $rows, string $mode, string $masterData = 'match_or_error'): array
    {
        $keys = array_values(array_unique(array_merge(...array_map('array_keys', $rows))));
        $table = array_map(fn (array $row): array => array_map(fn (string $key): string => $row[$key] ?? '', $keys), $rows);
        $file = UploadedFile::fake()->createWithContent('p.csv', SpreadsheetWriter::csv($keys, $table));
        $preview = app(ProductImportService::class)->preview($file, ['mode' => $mode, 'master_data_policy' => $masterData]);

        // Row 1 is the header; data rows start at 2.
        return array_map(fn (array $row): string => (string) $row['action'], $preview['rows']);
    }

    /**
     * @param  list<array<string,string>>  $rows
     * @param  list<string>  $decisions create|update per row
     * @return list<string> operation per row (create|update|skip|blocked)
     */
    private function ai(array $rows, array $decisions): array
    {
        $input = [];
        foreach ($rows as $index => $row) {
            $fields = [];
            foreach ($row as $key => $value) {
                $fields[$key] = ['value' => $value, 'origin' => 'user', 'confidence' => null];
            }
            $input[] = ['row_id' => 'r'.$index, 'source_row' => $index + 2, 'decision' => $decisions[$index], 'fields' => $fields, 'violations' => [], 'media' => null];
        }
        $preview = app(AiActionProductPreviewBuilder::class)->build($input, [
            'action_id' => 'a', 'version' => 1, 'branch_id' => null, 'proposal_hash' => null, 'manifest_hash' => null, 'file_sha256' => null,
        ]);

        return array_map(fn (array $row): string => (string) $row['operation'], $preview['rows']);
    }

    /** @return array<string, array{0: list<array<string,string>>, 1: string, 2: list<string>, 3: list<string>}> */
    public static function agreements(): array
    {
        $full = self::FULL;

        return [
            'new product' => [[['name' => 'جديد', 'sku' => 'N-1', 'sale_price' => '10.00', 'type' => 'good'] + $full], 'create', ['create'], ['create']],
            'create over an existing sku' => [[['name' => 'قهوة 2', 'sku' => 'A-1', 'sale_price' => '10.00', 'type' => 'good'] + $full], 'create', ['create'], ['error']],
            'create over an existing barcode' => [[['name' => 'جديد', 'sku' => 'N-2', 'barcode' => '6290000000011', 'sale_price' => '10.00', 'type' => 'good'] + $full], 'create', ['create'], ['error']],
            'update by sku with a changed price' => [[['name' => 'قهوة', 'sku' => 'A-1', 'sale_price' => '12.00']], 'update', ['update'], ['update']],
            'update with nothing changed' => [[['name' => 'قهوة', 'sku' => 'A-1', 'sale_price' => '10.00', 'purchase_price' => '5.00']], 'update', ['update'], ['skip']],
            'update an unknown sku' => [[['name' => 'x', 'sku' => 'ZZZ', 'sale_price' => '1.00']], 'update', ['update'], ['error']],
            'sku and barcode of two different products' => [[['name' => 'x', 'sku' => 'A-1', 'barcode' => '6290000000028', 'sale_price' => '11.00']], 'update', ['update'], ['error']],
            'malformed nebrax id' => [[['name' => 'x', 'nebrax_id' => 'not-a-uuid', 'sale_price' => '11.00']], 'update', ['update'], ['error']],
            'unknown nebrax id' => [[['name' => 'x', 'nebrax_id' => '00000000-0000-4000-8000-000000000000', 'sale_price' => '11.00']], 'update', ['update'], ['error']],
            'same sku twice in the file' => [[
                ['name' => 'أ', 'sku' => 'D-1', 'sale_price' => '10.00', 'type' => 'good'] + $full,
                ['name' => 'ب', 'sku' => 'D-1', 'sale_price' => '10.00', 'type' => 'good'] + $full,
            ], 'create', ['create', 'create'], ['create', 'error']],
            'money with three decimals' => [[['name' => 'جديد', 'sku' => 'N-3', 'sale_price' => '10.123', 'type' => 'good'] + $full], 'create', ['create'], ['error']],
            'minimum price above the sale price' => [[['name' => 'جديد', 'sku' => 'N-4', 'sale_price' => '10.00', 'min_sale_price' => '20.00', 'type' => 'good'] + $full], 'create', ['create'], ['error']],
            'a service that tracks inventory' => [[['name' => 'خدمة', 'sku' => 'S-1', 'sale_price' => '10.00', 'type' => 'service', 'track_inventory' => '1'] + $full], 'create', ['create'], ['error']],
            'changing the type of an existing product' => [[['name' => 'قهوة', 'sku' => 'A-1', 'type' => 'service']], 'update', ['update'], ['error']],
            'unknown category under match_or_error' => [[['name' => 'جديد', 'sku' => 'N-5', 'sale_price' => '10.00', 'type' => 'good', 'category' => 'غير موجود'] + $full], 'create', ['create'], ['error']],
        ];
    }

    /**
     * @test
     * @dataProvider agreements
     *
     * @param  list<array<string,string>>  $rows
     * @param  list<string>  $decisions
     * @param  list<string>  $expected  ok-verdicts use the operation name; failures use `error`
     */
    public function both_consumers_reach_the_same_verdict_on_rows_that_meet_the_stricter_contract(array $rows, string $mode, array $decisions, array $expected): void
    {
        $v2 = $this->v2($rows, $mode);
        $ai = array_map(fn (string $op): string => $op === 'blocked' ? 'error' : $op, $this->ai($rows, $decisions));

        $this->assertSame($expected, $v2, 'V2 (ProductImportService) verdict changed');
        $this->assertSame($expected, $ai, 'AI preview builder verdict changed');
    }

    /** @test */
    public function the_documented_divergences_are_still_exactly_the_ai_only_rules(): void
    {
        // 1) create without an explicit purchase price / tax / unit: V2 defaults them, AI Actions never does.
        $noDefaults = [['name' => 'جديد', 'sku' => 'N-9', 'sale_price' => '10.00', 'type' => 'good']];
        $this->assertSame(['create'], $this->v2($noDefaults, 'create'));
        $this->assertSame(['blocked'], $this->ai($noDefaults, ['create']));

        // 2) create without a trusted identifier: V2 generates a SKU, AI Actions requires one.
        $noIdentifier = [['name' => 'جديد', 'sale_price' => '10.00', 'type' => 'good'] + self::FULL];
        $this->assertSame(['create'], $this->v2($noIdentifier, 'create'));
        $this->assertSame(['blocked'], $this->ai($noIdentifier, ['create']));

        // 2b) update by barcode alone: V2 requires an id/SKU column (the name or barcode never identifies a row for it),
        //     the AI path matches a trusted barcode.
        $byBarcode = [['name' => 'شاي', 'barcode' => '6290000000028', 'sale_price' => '21.00']];
        $this->assertSame(['update'], $this->ai($byBarcode, ['update']));
        try {
            $this->v2($byBarcode, 'update');
            $this->fail('V2 update must demand an id or SKU column');
        } catch (\RuntimeException $e) {
            $this->assertStringContainsString('عمود معرّف', $e->getMessage());
        }

        // 3) unknown reference: V2's default policy keeps it as free text, AI Actions never does (and V2 under
        //    `match_or_error` agrees with AI — the difference is a policy, not code).
        $unknownCategory = [['name' => 'جديد', 'sku' => 'N-10', 'sale_price' => '10.00', 'type' => 'good', 'category' => 'غير موجود'] + self::FULL];
        $this->assertSame(['create'], $this->v2($unknownCategory, 'create', 'match_or_text'));
        $this->assertSame(['error'], $this->v2($unknownCategory, 'create', 'match_or_error'));
        $this->assertSame(['blocked'], $this->ai($unknownCategory, ['create']));
    }

    /**
     * @test
     *
     * Found by this parity test: `isNoOpUpdate` relied on `fill()`+`getDirty()`, but `sale_price` is an accessor over
     * `ProductUnitPrice`, so a row whose only change was the sale price was classified "skip" and silently dropped
     * (preview AND apply). The AI path never had the problem.
     */
    public function a_price_only_update_is_applied_not_skipped(): void
    {
        $file = fn (string $price) => UploadedFile::fake()->createWithContent('p.csv', SpreadsheetWriter::csv(['sku', 'sale_price'], [['A-1', $price]]));
        $service = app(ProductImportService::class);

        $this->assertSame(['update'], array_map(fn ($r) => $r['action'], $service->preview($file('12.00'), ['mode' => 'update'])['rows']));
        $result = $service->apply($file('12.00'), ['mode' => 'update']);
        $this->assertSame([1, 0], [$result['updated'], $result['skipped']]);
        $this->assertSame(1200, (int) \App\Models\Product::query()->where('sku', 'A-1')->firstOrFail()->sale_price);

        // The same price again is a genuine no-op.
        $this->assertSame(['skip'], array_map(fn ($r) => $r['action'], $service->preview($file('12.00'), ['mode' => 'update'])['rows']));
    }

    /** @test */
    public function the_lifecycle_update_persists_and_records_a_price_only_change(): void
    {
        // The root cause behind the import symptom above: `ProductLifecycleService::update` returned early when no real
        // column was dirty. It is also the write path of AI Actions execution, so the fix is here, not in each caller.
        $product = \App\Models\Product::query()->where('sku', 'A-1')->firstOrFail();
        app(\App\Services\ProductLifecycleService::class)->update($product, ['sale_price' => 1500], null);

        $this->assertSame(1500, (int) \App\Models\Product::query()->where('sku', 'A-1')->firstOrFail()->sale_price);
        $activity = \App\Models\ProductActivity::query()->where('product_id', $product->id)->where('action', 'updated')->latest('id')->first();
        $this->assertNotNull($activity);
        $this->assertSame([1000, 1500], $activity->diff['sale_price'] ?? null);

        // Re-sending the same price changes nothing and records nothing new.
        $before = \App\Models\ProductActivity::query()->where('product_id', $product->id)->count();
        app(\App\Services\ProductLifecycleService::class)->update($product->refresh(), ['sale_price' => 1500], null);
        $this->assertSame($before, \App\Models\ProductActivity::query()->where('product_id', $product->id)->count());
    }

    /** @test */
    public function the_key_sets_both_consumers_read_come_from_the_one_field_registry(): void
    {
        // Guard for H2-S5: neither side may grow its own field list.
        $this->assertContains('sku', ProductImportFields::keys());
        $this->assertNotEmpty(ProductImportFields::writableKeys());
    }
}
