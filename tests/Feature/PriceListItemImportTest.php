<?php

namespace Tests\Feature;

use App\Models\JournalEntry;
use App\Models\PriceListItem;
use App\Models\Product;
use App\Services\PriceListItemImportAdapter;
use App\Services\PriceListItemImportService;
use App\Support\ImportChunk;
use App\Support\ImportPlanDriftException;
use App\Support\ImportUnitFailureException;
use App\Support\PriceListItemImportFields;
use App\Support\SpreadsheetWriter;
use App\Tenancy\TenantContext;
use App\Models\ImportJob;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Tests\TestCase;

/**
 * IMP-H4-S2 — استيراد عناصر قائمة السعر: العقد، المطابقة بالمنتج، حلّ الوحدات، الأوضاع، التكرار حتى بصيغتين، النوافذ، والمحوّل (غير مسجَّل بعد).
 *
 * تشغيل: php artisan test --filter=PriceListItemImportTest
 */
class PriceListItemImportTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private string $token;

    private string $listId;

    /** @var array<string, mixed> */
    private array $plain;

    /** @var array<string, mixed> */
    private array $boxed;

    protected function setUp(): void
    {
        parent::setUp();
        $auth = $this->registerTenant();
        $this->token = $auth['token'];
        app(TenantContext::class)->set($auth['tenant_id']);
        $this->listId = $this->withToken($this->token)->postJson('/api/price-lists', ['name' => 'قائمة الجملة'])->assertCreated()['data']['id'];
        $this->plain = $this->product('SKU-PLAIN');
        $template = $this->withToken($this->token)->postJson('/api/unit-templates', [
            'name' => 'كرتون/قطعة', 'base_unit' => 'قطعة', 'units' => [['name' => 'كرتون', 'factor' => 12]],
        ])->assertCreated()['data'];
        $this->boxed = $this->product('SKU-BOX', ['unit_template_id' => $template['id'], 'unit' => 'قطعة']);
    }

    /** @return array<string, mixed> */
    private function product(string $sku, array $extra = []): array
    {
        return $this->withToken($this->token)->postJson('/api/products', $extra + [
            'name' => 'منتج '.$sku, 'sku' => $sku, 'type' => 'good', 'sale_price' => 10000,
        ])->assertCreated()['data'];
    }

    private function service(): PriceListItemImportService
    {
        return app(PriceListItemImportService::class);
    }

    /** @return array<string, mixed> */
    private function opts(array $extra = []): array
    {
        return ['price_list_id' => $this->listId] + $extra;
    }

    /** @param list<array<string,string>> $rows */
    private function file(array $rows, string $name = 'prices.csv'): UploadedFile
    {
        $keys = array_values(array_unique(array_merge(...array_map('array_keys', $rows))));
        $table = array_map(fn (array $row): array => array_map(fn (string $key): string => $row[$key] ?? '', $keys), $rows);

        return UploadedFile::fake()->createWithContent($name, SpreadsheetWriter::csv($keys, $table));
    }

    /** @return list<string> */
    private function actions(array $preview): array
    {
        return array_map(fn (array $row): string => (string) $row['action'], $preview['rows']);
    }

    private function item(string $productId, ?string $unit = null): ?PriceListItem
    {
        $unit ??= (string) Product::query()->whereKey($productId)->value('unit');

        return PriceListItem::query()->where('price_list_id', $this->listId)->where('product_id', $productId)->where('unit_name', $unit)->first();
    }

    // ═══════════════════════════════ العقد ═══════════════════════════════

    /** @test */
    public function the_contract_has_no_price_list_column_no_variant_and_maps_arabic_headers(): void
    {
        foreach (['price_list_id', 'product_variant_id', 'tenant_id', 'cost', 'quantity'] as $forbidden) {
            $this->assertNotContains($forbidden, PriceListItemImportFields::keys(), $forbidden);
        }
        $map = PriceListItemImportFields::autoMap(['رمز الصنف', 'الوحدة', 'السعر', 'عمود غريب']);
        $this->assertSame(['sku', 'unit_name', 'price', null], array_values($map));
        $this->assertSame([null, 'price'], array_values(PriceListItemImportFields::autoMap(['id', 'السعر'])), 'رقم قديم باسم id لا يُربط بمعرّف نبراكس');
    }

    /** @test */
    public function the_template_is_importable_once_its_sample_sku_exists(): void
    {
        $this->product('SKU-1001', ['unit_template_id' => $this->boxed['unit_template_id'], 'unit' => 'قطعة']);
        $preview = $this->service()->preview(UploadedFile::fake()->createWithContent('t.csv', $this->service()->template()), $this->opts());

        $this->assertSame([0, 2], [$preview['error_rows'], $preview['create_rows']]);
    }

    /** @test */
    public function a_missing_or_inactive_price_list_and_bad_options_fail_closed(): void
    {
        $file = $this->file([['sku' => 'SKU-PLAIN', 'price' => '10']]);
        foreach ([[], ['price_list_id' => '00000000-0000-4000-8000-000000000000'], ['price_list_id' => 'x'], $this->opts(['mode' => 'delete']), $this->opts(['mapping' => [0 => 'cost']])] as $options) {
            try {
                $this->service()->preview($file, $options);
                $this->fail('كان يجب الرفض: '.json_encode($options));
            } catch (\RuntimeException $e) {
                $this->assertNotSame('', $e->getMessage());
            }
        }
        $this->withToken($this->token)->putJson("/api/price-lists/{$this->listId}", ['name' => 'قائمة الجملة', 'is_active' => false])->assertOk();
        $this->expectExceptionMessage('غير نشطة');
        $this->service()->preview($file, $this->opts());
    }

    // ═══════════════════════════════ الإنشاء والتحديث ═══════════════════════════════

    /** @test */
    public function prices_are_created_for_base_and_named_units_in_halalas(): void
    {
        $rows = [
            ['sku' => 'SKU-PLAIN', 'unit_name' => '', 'price' => '25.50'],
            ['sku' => 'SKU-BOX', 'unit_name' => 'كرتون', 'price' => '280'],
            ['nebrax_id' => $this->boxed['id'], 'unit_name' => '', 'price' => '٢٣٫٥٠'],
        ];
        $preview = $this->service()->preview($this->file($rows), $this->opts());
        $this->assertSame(['create', 'create', 'create'], $this->actions($preview));
        $this->assertSame([2550, 28000, 2350], array_column($preview['rows'], 'price'));

        $result = $this->service()->apply($this->file($rows), $this->opts());

        $this->assertSame([3, 0, 0], [$result['created'], $result['updated'], $result['skipped']]);
        $this->assertSame(2550, $this->item($this->plain['id'])->price);
        $this->assertSame(28000, $this->item($this->boxed['id'], 'كرتون')->price);
        $this->assertSame(2350, $this->item($this->boxed['id'])->price);
    }

    /** @test */
    public function upsert_is_the_default_and_distinguishes_create_update_and_skip(): void
    {
        $this->service()->apply($this->file([['sku' => 'SKU-PLAIN', 'price' => '10'], ['sku' => 'SKU-BOX', 'price' => '5']]), $this->opts());

        $rows = [['sku' => 'SKU-PLAIN', 'price' => '12'], ['sku' => 'SKU-BOX', 'price' => '5'], ['sku' => 'SKU-BOX', 'unit_name' => 'كرتون', 'price' => '60']];
        $preview = $this->service()->preview($this->file($rows), $this->opts());

        $this->assertSame(['update', 'skip', 'create'], $this->actions($preview));
        $this->assertSame([1000, 500, null], array_column($preview['rows'], 'current_price'));
        $this->service()->apply($this->file($rows), $this->opts());
        $this->assertSame(1200, $this->item($this->plain['id'])->price);
        $this->assertSame(1, PriceListItem::query()->where('product_id', $this->plain['id'])->count());
    }

    /** @test */
    public function create_mode_refuses_an_existing_price_and_update_mode_refuses_a_missing_one(): void
    {
        $this->service()->apply($this->file([['sku' => 'SKU-PLAIN', 'price' => '10']]), $this->opts());

        $create = $this->service()->preview($this->file([['sku' => 'SKU-PLAIN', 'price' => '11'], ['sku' => 'SKU-BOX', 'price' => '5']]), $this->opts(['mode' => 'create']));
        $this->assertSame(['error', 'create'], $this->actions($create));
        $this->assertStringContainsString('بالفعل', $create['errors'][0]['messages'][0]);

        $update = $this->service()->preview($this->file([['sku' => 'SKU-PLAIN', 'price' => '11'], ['sku' => 'SKU-BOX', 'price' => '5']]), $this->opts(['mode' => 'update']));
        $this->assertSame(['update', 'error'], $this->actions($update));
        $this->assertStringContainsString('لا يمكن التحديث', $update['errors'][0]['messages'][0]);
    }

    // ═══════════════════════════════ التحقق من الصفوف ═══════════════════════════════

    /** @test */
    public function product_resolution_never_uses_the_name_and_rejects_conflicts_unknowns_and_inactive_products(): void
    {
        $inactive = $this->product('SKU-OFF');
        $this->withToken($this->token)->putJson("/api/products/{$inactive['id']}", ['name' => $inactive['name'], 'type' => 'good', 'sale_price' => 10000, 'is_active' => false])->assertOk();

        $rows = [
            ['sku' => 'NOPE', 'price' => '1'],
            ['nebrax_id' => '00000000-0000-4000-8000-000000000000', 'price' => '1'],
            ['nebrax_id' => 'abc', 'price' => '1'],
            ['nebrax_id' => $this->plain['id'], 'sku' => 'SKU-BOX', 'price' => '1'],
            ['sku' => 'SKU-OFF', 'price' => '1'],
            ['sku' => '', 'price' => '1'],
        ];
        $preview = $this->service()->preview($this->file($rows), $this->opts());

        $this->assertSame(array_fill(0, 6, 'error'), $this->actions($preview));
        $messages = array_map(fn (array $e): string => $e['messages'][0], $preview['errors']);
        $this->assertStringContainsString('رمز الصنف لا يطابق', $messages[0]);
        $this->assertStringContainsString('لا يطابق أي منتج', $messages[1]);
        $this->assertStringContainsString('غير صالح', $messages[2]);
        $this->assertStringContainsString('منتجين مختلفين', $messages[3]);
        $this->assertStringContainsString('غير نشط', $messages[4]);
        $this->assertStringContainsString('يحتاج معرّف', $messages[5]);

        $byName = $this->file([['name' => 'منتج SKU-PLAIN', 'price' => '1']]);
        $this->expectExceptionMessage('الاسم لا يصلح');
        $this->service()->preview($byName, $this->opts());
    }

    /** @test */
    public function units_must_be_known_to_the_products_template_and_prices_must_be_valid_and_bounded(): void
    {
        $rows = [
            ['sku' => 'SKU-PLAIN', 'unit_name' => 'كرتون', 'price' => '1'],
            ['sku' => 'SKU-BOX', 'unit_name' => 'طن', 'price' => '1'],
            ['sku' => 'SKU-PLAIN', 'price' => 'abc'],
            ['sku' => 'SKU-BOX', 'price' => '-5'],
            ['sku' => 'SKU-BOX', 'unit_name' => 'كرتون', 'price' => '1000000000.01'],
            ['sku' => 'SKU-BOX', 'unit_name' => 'قطعة', 'price' => '1000000000.00'],
            ['sku' => 'SKU-BOX', 'unit_name' => 'كرتون', 'price' => ''],
        ];
        $preview = $this->service()->preview($this->file($rows), $this->opts());

        $this->assertSame(['error', 'error', 'error', 'error', 'error', 'create', 'error'], $this->actions($preview));
        $this->assertStringContainsString('لا قالب وحدات', $preview['errors'][0]['messages'][0]);
        $this->assertStringContainsString('غير معرَّفة', $preview['errors'][1]['messages'][0]);
        $this->assertStringContainsString('الحد الأقصى', $preview['errors'][4]['messages'][0]);
        $this->assertSame(100000000000, $preview['rows'][5]['price']);
        $this->assertSame(0, PriceListItem::query()->count());
    }

    // ═══════════════════════════════ التكرار والنوافذ ═══════════════════════════════

    /** @test */
    public function the_same_product_and_unit_twice_fails_the_whole_file_even_when_written_two_different_ways(): void
    {
        $rows = [
            ['sku' => 'SKU-PLAIN', 'price' => '1'],
            ['sku' => 'SKU-BOX', 'price' => '2'],
            ['nebrax_id' => $this->plain['id'], 'unit_name' => '', 'price' => '3'],   // نفس المنتج بمعرّف بدل الرمز
            ['sku' => 'SKU-BOX', 'unit_name' => 'قطعة', 'price' => '4'],              // وحدة الأساس صراحةً بدل الفراغ
        ];

        $preview = $this->service()->preview($this->file($rows), $this->opts());
        $this->assertSame(['create', 'create', 'error', 'error'], $this->actions($preview));

        try {
            $this->service()->apply($this->file($rows), $this->opts(['batch_offset' => 0, 'batch_size' => 1]));
            $this->fail('كان يجب أن يفشل الملف كله عند التكرار داخله.');
        } catch (ImportUnitFailureException $e) {
            $this->assertSame([2, 3], array_column($e->failures, 'ordinal'));
        }
        $this->assertSame(0, PriceListItem::query()->count());
    }

    /** @test */
    public function windows_apply_in_order_and_a_changed_state_is_refused_as_plan_drift(): void
    {
        $rows = [['sku' => 'SKU-PLAIN', 'price' => '1'], ['sku' => 'SKU-BOX', 'price' => '2'], ['sku' => 'SKU-BOX', 'unit_name' => 'كرتون', 'price' => '3']];
        $first = $this->service()->apply($this->file($rows), $this->opts(['batch_offset' => 0, 'batch_size' => 2]));
        $this->assertSame([2, 3], [$first['created'], $first['total_rows']]);
        $this->service()->apply($this->file($rows), $this->opts(['batch_offset' => 2, 'batch_size' => 2]));
        $this->assertSame(3, PriceListItem::query()->count());

        PriceListItem::query()->delete();
        $planned = $this->service()->previewWithPlan($this->file($rows), $this->opts())['plan'];
        $this->service()->apply($this->file([['sku' => 'SKU-PLAIN', 'price' => '9']]), $this->opts());   // ظهر في الأثناء

        $this->expectException(ImportPlanDriftException::class);
        $this->service()->apply($this->file($rows), $this->opts(['expected_plan' => $planned]));
    }

    /** @test */
    public function an_erroneous_row_aborts_the_window_with_no_partial_write(): void
    {
        try {
            $this->service()->apply($this->file([['sku' => 'SKU-PLAIN', 'price' => '1'], ['sku' => 'NOPE', 'price' => '1']]), $this->opts());
            $this->fail('كان يجب الفشل.');
        } catch (ImportUnitFailureException) {
            $this->assertSame(0, PriceListItem::query()->count());
        }
    }

    /** @test */
    public function a_row_wider_than_the_header_is_an_error_not_a_silent_truncation(): void
    {
        $file = UploadedFile::fake()->createWithContent('wide.csv', "sku,price\nSKU-PLAIN,10\nSKU-BOX,5, زائد\n");

        $preview = $this->service()->preview($file, $this->opts());

        $this->assertSame(['create', 'error'], $this->actions($preview));
        $this->assertStringContainsString('يتجاوز صف العناوين', $preview['errors'][0]['messages'][0]);
    }

    // ═══════════════════════════════ لا آثار جانبية ═══════════════════════════════

    /** @test */
    public function importing_touches_neither_the_product_card_price_nor_the_ledger(): void
    {
        $before = [JournalEntry::query()->count(), (int) Product::query()->whereKey($this->plain['id'])->first()->sale_price];

        $this->service()->apply($this->file([['sku' => 'SKU-PLAIN', 'price' => '99.99']]), $this->opts());

        $this->assertSame($before, [JournalEntry::query()->count(), (int) Product::query()->whereKey($this->plain['id'])->first()->sale_price]);
        $this->assertSame(9999, $this->item($this->plain['id'])->price);
    }

    /** @test */
    public function another_tenants_price_list_and_products_are_unreachable(): void
    {
        $other = $this->registerTenant('other-co', 'other@pi.test');
        app(TenantContext::class)->set($other['tenant_id']);
        $theirs = $this->withToken($other['token'])->postJson('/api/products', ['name' => 'غريب', 'sku' => 'SKU-THEIRS', 'type' => 'good', 'sale_price' => 100])->assertCreated()['data'];
        $theirList = $this->withToken($other['token'])->postJson('/api/price-lists', ['name' => 'قائمتهم'])->assertCreated()['data']['id'];

        // نحن في سياق المستأجر الأول مجدداً.
        app(TenantContext::class)->set(\App\Models\Product::withoutGlobalScopes()->where('sku', 'SKU-PLAIN')->value('tenant_id'));
        $preview = $this->service()->preview($this->file([['sku' => 'SKU-THEIRS', 'price' => '1'], ['nebrax_id' => $theirs['id'], 'price' => '1']]), $this->opts());
        $this->assertSame(['error', 'error'], $this->actions($preview));

        $this->expectExceptionMessage('غير موجودة');
        $this->service()->preview($this->file([['sku' => 'SKU-PLAIN', 'price' => '1']]), ['price_list_id' => $theirList]);
    }

    // ═══════════════════════════════ المحوّل ═══════════════════════════════

    /** @test */
    public function the_adapter_declares_its_domain_and_canonicalises_options(): void
    {
        $adapter = app(PriceListItemImportAdapter::class);

        $this->assertSame(['price_list_items', 'row'], [$adapter->domain(), $adapter->unit()]);
        $this->assertSame(PriceListItemImportService::DURABLE_MAX_ROWS, $adapter->maxRows());
        $this->assertSame([], $adapter->sensitiveColumnIndexes(['a'], []));
        $this->assertSame(
            ['price_list_id' => $this->listId, 'mode' => 'upsert', 'mapping' => ['0' => 'sku', '1' => 'price']],
            $adapter->canonicalOptions(['price_list_id' => $this->listId, 'mapping' => [1 => 'price', 0 => 'sku'], 'ignored_key' => 'x']),
        );
    }

    /** @test */
    public function the_adapter_chunk_writes_through_the_service_and_reports_processed_units(): void
    {
        $file = $this->file([['sku' => 'SKU-PLAIN', 'price' => '1'], ['sku' => 'SKU-BOX', 'price' => '2'], ['sku' => 'SKU-BOX', 'unit_name' => 'كرتون', 'price' => '3']]);
        $chunk = new ImportChunk(new ImportJob, $file, null, $this->opts(['mode' => 'upsert']), 0, 2, null, true);

        $result = app(PriceListItemImportAdapter::class)->applyChunk($chunk);

        $this->assertSame(2, $result->processedUnits);
        $this->assertSame(2, PriceListItem::query()->count());
    }
}
