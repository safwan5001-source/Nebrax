<?php

namespace Tests\Feature;

use App\Models\ImportJob;
use App\Models\ImportPreview;
use App\Models\Product;
use App\Models\Warehouse;
use App\Services\ImportPreviewService;
use App\Support\SpreadsheetWriter;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use RuntimeException;
use Tests\TestCase;

/**
 * IMP-H1-S3c — خطّة المعاينة (`plan_drift`) وربط التطبيق **المتزامن** بمعاينته.
 *
 * الخطر الواقعي: معاينة بوضع «دمج» تقول «إنشاء» لرمزٍ غير موجود، ثم يُنشئه أحدٌ في الأثناء، فيتحوّل التنفيذ — بلا أن يعلم
 * المستخدم — إلى «تحديثٍ» فوق منتجٍ لم يُعاينه. الآن يفشل التنفيذ بـ`plan_drift` ولا يكتب شيئاً.
 */
class ImportPlanDriftTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
    }

    private function csv(array $rows, string $name = 'catalog.csv'): UploadedFile
    {
        $body = "sku,name,type,sale_price\n";
        foreach ($rows as [$sku, $productName]) {
            $body .= "{$sku},{$productName},good,10.00\n";
        }

        return UploadedFile::fake()->createWithContent($name, $body);
    }

    /** @return array{id:string,hash:string,expires_at:string} */
    private function preview(string $token, UploadedFile $file, array $fields = ['mode' => 'upsert']): array
    {
        return $this->withToken($token)->post('/api/products/import/preview', array_merge(['file' => $file], $fields), ['Accept' => 'application/json'])
            ->assertOk()->json('data.binding');
    }

    private function createJob(string $token, UploadedFile $file, array $binding, array $options = ['mode' => 'upsert'])
    {
        return $this->withToken($token)->post('/api/import-jobs', [
            'domain' => 'product_catalog', 'file' => $file, 'options' => $options,
            'preview_id' => $binding['id'], 'preview_hash' => $binding['hash'],
        ], ['Accept' => 'application/json']);
    }

    private function applyJob(string $token, string $id, array $body = [])
    {
        return $this->withToken($token)->postJson("/api/import-jobs/{$id}/apply", $body);
    }

    private function product(string $token, string $sku, string $name = 'خارجي'): array
    {
        return $this->withToken($token)->postJson('/api/products', ['name' => $name, 'sku' => $sku, 'type' => 'good', 'sale_price' => 5000])
            ->assertCreated()['data'];
    }

    // ── الخطّة تُحفَظ وتُنسَخ ────────────────────────────────────────────────

    /** @test */
    public function the_catalog_preview_stores_a_compressed_plan_that_the_job_reads_through_its_preview(): void
    {
        $auth = $this->registerTenant();
        $binding = $this->preview($auth['token'], $this->csv([['PD-1', 'واحد'], ['PD-2', 'اثنان']]));

        $plan = ImportPreviewService::decodePlan(ImportPreview::query()->whereKey($binding['id'])->value('plan'));
        $this->assertSame([2 => 'c', 3 => 'c'], $plan);

        $jobId = $this->createJob($auth['token'], $this->csv([['PD-1', 'واحد'], ['PD-2', 'اثنان']]), $binding)->assertCreated()['data']['id'];
        // التشغيلة لا تحمل نسخةً من الخطّة (عمودٌ ضخم يُحمَّل مع كل قراءة): تقرؤها من سجلّ معاينتها وقت القطعة.
        $this->assertSame($binding['id'], ImportJob::query()->whereKey($jobId)->value('preview_id'));
        $this->assertArrayNotHasKey('apply_plan', ImportJob::query()->whereKey($jobId)->firstOrFail()->getAttributes());
    }

    /** @test */
    public function the_plan_codec_round_trips_and_a_corrupt_plan_fails_closed(): void
    {
        $plan = [2 => 'c', 3 => 'u:'.str_repeat('a', 36), 4 => 's:'.str_repeat('b', 36)];
        $this->assertSame($plan, ImportPreviewService::decodePlan(ImportPreviewService::encodePlan($plan)));
        $this->assertNull(ImportPreviewService::decodePlan(null));

        $this->expectException(RuntimeException::class);
        ImportPreviewService::decodePlan('not-a-plan');
    }

    // ── plan_drift في المسار الدائم ──────────────────────────────────────────

    /** @test */
    public function an_unchanged_world_applies_exactly_the_previewed_plan(): void
    {
        $auth = $this->registerTenant();
        $rows = [['PD-OK-1', 'واحد'], ['PD-OK-2', 'اثنان'], ['PD-OK-3', 'ثلاثة']];
        $binding = $this->preview($auth['token'], $this->csv($rows));
        $jobId = $this->createJob($auth['token'], $this->csv($rows), $binding)->assertCreated()['data']['id'];

        // قطعٌ بسطر واحد: الخطّة تُقارَن لكل نافذة بأرقام الصفوف الأصلية.
        $last = null;
        for ($i = 0; $i < 3; $i++) {
            $last = $this->applyJob($auth['token'], $jobId, ['batch_size' => 1])->assertOk();
        }

        $this->assertSame('completed', $last['data']['status']);
        $this->assertSame(3, Product::withoutGlobalScopes()->where('sku', 'like', 'PD-OK-%')->count());
    }

    /** @test */
    public function a_row_planned_as_create_that_became_an_update_in_the_meantime_is_refused(): void
    {
        $auth = $this->registerTenant();
        $rows = [['PD-DRIFT', 'من الملف']];
        $binding = $this->preview($auth['token'], $this->csv($rows), ['mode' => 'upsert']);
        $jobId = $this->createJob($auth['token'], $this->csv($rows), $binding)->assertCreated()['data']['id'];

        // في الأثناء أنشأ أحدٌ الرمز نفسه.
        $external = $this->product($auth['token'], 'PD-DRIFT', 'منتج خارجي');

        $response = $this->applyJob($auth['token'], $jobId, ['mode' => 'upsert'])->assertStatus(422);
        $this->assertStringContainsString('plan_drift', (string) $response->json('message'));
        $this->assertSame('failed', ImportJob::query()->whereKey($jobId)->value('status'));
        $this->assertSame('منتج خارجي', Product::withoutGlobalScopes()->whereKey($external['id'])->value('name'), 'المنتج الخارجي لم يُمسّ.');
    }

    /** @test */
    public function a_planned_update_whose_target_changed_identity_is_refused(): void
    {
        $auth = $this->registerTenant();
        $first = $this->product($auth['token'], 'PD-TGT');
        $rows = [['PD-TGT', 'جديد']];
        $binding = $this->preview($auth['token'], $this->csv($rows), ['mode' => 'update']);
        $this->assertSame('u:'.$first['id'], ImportPreviewService::decodePlan(ImportPreview::query()->whereKey($binding['id'])->value('plan'))[2]);
        $jobId = $this->createJob($auth['token'], $this->csv($rows), $binding, ['mode' => 'update'])->assertCreated()['data']['id'];

        // المنتج المستهدف يُحذف ويُنشأ غيره بالرمز نفسه: «تحديث» الآن يستهدف منتجاً آخر.
        $this->withToken($auth['token'])->deleteJson("/api/products/{$first['id']}")->assertSuccessful();
        $second = $this->product($auth['token'], 'PD-TGT', 'منتج آخر بالرمز نفسه');

        $this->applyJob($auth['token'], $jobId, ['mode' => 'update'])->assertStatus(422);
        $this->assertSame('منتج آخر بالرمز نفسه', Product::withoutGlobalScopes()->whereKey($second['id'])->value('name'));
    }

    /** @test */
    public function a_planned_skip_that_would_now_change_the_product_is_refused(): void
    {
        $auth = $this->registerTenant();
        $this->withToken($auth['token'])->postJson('/api/products', ['name' => 'مطابق', 'sku' => 'PD-SKIP', 'type' => 'good', 'sale_price' => 1000])->assertCreated();
        $rows = [['PD-SKIP', 'مطابق']];
        $binding = $this->preview($auth['token'], $this->csv($rows), ['mode' => 'update']);
        $plan = ImportPreviewService::decodePlan(ImportPreview::query()->whereKey($binding['id'])->value('plan'));
        $this->assertStringStartsWith('s:', $plan[2], 'لا تغيير ⇒ تجاوز.');
        $jobId = $this->createJob($auth['token'], $this->csv($rows), $binding, ['mode' => 'update'])->assertCreated()['data']['id'];

        Product::withoutGlobalScopes()->where('sku', 'PD-SKIP')->update(['name' => 'تغيّر في الأثناء']);

        $this->applyJob($auth['token'], $jobId, ['mode' => 'update'])->assertStatus(422);
    }

    /** @test */
    public function a_job_without_a_plan_skips_the_comparison_and_keeps_the_old_contract(): void
    {
        $auth = $this->registerTenant();
        $jobId = $this->withToken($auth['token'])->post('/api/import-jobs', ['domain' => 'product_catalog', 'file' => $this->csv([['PD-LEG', 'قديم']])], ['Accept' => 'application/json'])
            ->assertCreated()['data']['id'];
        $this->product($auth['token'], 'PD-LEG', 'قائم');

        // بلا معاينة ⇒ لا خطّة ⇒ سلوك «دمج» القديم (تحديث) كما كان.
        $this->applyJob($auth['token'], $jobId, ['mode' => 'upsert'])->assertOk()->assertJsonPath('data.status', 'completed');
        $this->assertSame('قديم', Product::withoutGlobalScopes()->where('sku', 'PD-LEG')->value('name'));
    }

    // ── التطبيق المتزامن ──────────────────────────────────────────────────────

    /** @test */
    public function a_sync_catalog_apply_with_its_binding_runs_consumes_the_preview_and_cannot_be_replayed(): void
    {
        $auth = $this->registerTenant();
        $rows = [['PD-S1', 'متزامن']];
        $binding = $this->preview($auth['token'], $this->csv($rows), ['mode' => 'create']);
        $body = ['mode' => 'create', 'preview_id' => $binding['id'], 'preview_hash' => $binding['hash']];

        $this->withToken($auth['token'])->post('/api/products/import/apply', ['file' => $this->csv($rows)] + $body, ['Accept' => 'application/json'])->assertOk();
        $this->assertSame(1, Product::withoutGlobalScopes()->where('sku', 'PD-S1')->count());
        $this->assertNotNull(ImportPreview::query()->whereKey($binding['id'])->value('consumed_at'));

        $this->withToken($auth['token'])->post('/api/products/import/apply', ['file' => $this->csv($rows)] + $body, ['Accept' => 'application/json'])
            ->assertStatus(422)->assertJsonPath('code', 'preview_consumed');
    }

    /** @test */
    public function a_sync_apply_that_fails_does_not_burn_the_preview(): void
    {
        $auth = $this->registerTenant();
        $rows = [['PD-S2', 'واحد']];
        $binding = $this->preview($auth['token'], $this->csv($rows), ['mode' => 'upsert']);
        $this->product($auth['token'], 'PD-S2'); // انجراف: «إنشاء» المخطَّط صار تحديثاً.

        $this->withToken($auth['token'])->post('/api/products/import/apply', [
            'file' => $this->csv($rows), 'mode' => 'upsert', 'preview_id' => $binding['id'], 'preview_hash' => $binding['hash'],
        ], ['Accept' => 'application/json'])->assertStatus(422)->assertJsonPath('code', 'plan_drift');

        $this->assertNull(ImportPreview::query()->whereKey($binding['id'])->value('consumed_at'), 'الإنفاق رجع مع فشل التنفيذ.');
    }

    /** @test */
    public function a_sync_apply_with_other_options_or_file_is_a_mismatch(): void
    {
        $auth = $this->registerTenant();
        $binding = $this->preview($auth['token'], $this->csv([['PD-S3', 'واحد']]), ['mode' => 'create']);

        $this->withToken($auth['token'])->post('/api/products/import/apply', [
            'file' => $this->csv([['PD-S3', 'واحد']]), 'mode' => 'upsert', 'preview_id' => $binding['id'], 'preview_hash' => $binding['hash'],
        ], ['Accept' => 'application/json'])->assertStatus(422)->assertJsonPath('code', 'preview_mismatch');
        $this->withToken($auth['token'])->post('/api/products/import/apply', [
            'file' => $this->csv([['PD-S3-OTHER', 'آخر']]), 'mode' => 'create', 'preview_id' => $binding['id'], 'preview_hash' => $binding['hash'],
        ], ['Accept' => 'application/json'])->assertStatus(422)->assertJsonPath('code', 'preview_mismatch');
        $this->assertSame(0, Product::withoutGlobalScopes()->where('sku', 'like', 'PD-S3%')->count());
    }

    /** @test */
    public function the_three_sync_applies_require_a_preview_only_once_the_requirement_starts(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        Warehouse::create(['name' => 'مخزن', 'code' => 'WH-PD']);
        Product::create(['name' => 'صنف', 'sku' => 'SKU-PD', 'type' => 'good', 'sale_price' => 1000, 'track_inventory' => true]);
        $opening = fn () => UploadedFile::fake()->createWithContent('o.csv', SpreadsheetWriter::csv(
            ['sku', 'warehouse', 'opening_quantity', 'opening_unit_cost'], [['SKU-PD', 'WH-PD', '5', '2.00']]
        ));

        // قبل التفعيل: العقد القديم.
        $this->withToken($auth['token'])->post('/api/inventory-openings/import/apply', ['file' => $opening(), 'opening_date' => '2026-01-01'], ['Accept' => 'application/json'])->assertCreated();

        config(['imports.preview_required_from' => now('UTC')->subMinute()->toIso8601String()]);
        $this->withToken($auth['token'])->post('/api/inventory-openings/import/apply', ['file' => $opening(), 'opening_date' => '2026-01-01'], ['Accept' => 'application/json'])
            ->assertStatus(422)->assertJsonPath('code', 'preview_required');
        $this->withToken($auth['token'])->post('/api/products/import/apply', ['file' => $this->csv([['PD-REQ', 'x']]), 'mode' => 'create'], ['Accept' => 'application/json'])
            ->assertStatus(422)->assertJsonPath('code', 'preview_required');
        $priceList = $this->withToken($auth['token'])->postJson('/api/price-lists', ['name' => 'قائمة'])->assertCreated()['data']['id'];
        $this->withToken($auth['token'])->post('/api/products/workbook/apply', ['file' => $this->workbook('SKU-PD'), 'price_list_id' => $priceList], ['Accept' => 'application/json'])
            ->assertStatus(422)->assertJsonPath('code', 'preview_required');
        $this->assertSame(0, Product::withoutGlobalScopes()->where('sku', 'PD-REQ')->count());

        // ومع معاينتها تعمل.
        $binding = $this->withToken($auth['token'])->post('/api/inventory-openings/import/preview', ['file' => $opening(), 'opening_date' => '2026-02-01'], ['Accept' => 'application/json'])
            ->assertOk()->json('data.binding');
        $this->withToken($auth['token'])->post('/api/inventory-openings/import/apply', [
            'file' => $opening(), 'opening_date' => '2026-02-01', 'preview_id' => $binding['id'], 'preview_hash' => $binding['hash'],
        ], ['Accept' => 'application/json'])->assertCreated();
    }

    private function workbook(string $sku): UploadedFile
    {
        $path = tempnam(sys_get_temp_dir(), 'pd-wb-');
        SpreadsheetWriter::workbookXlsx($path, [
            ['name' => 'Products', 'headers' => ['sku', 'name', 'type', 'unit', 'sale_price'], 'rows' => []],
            ['name' => 'Barcodes', 'headers' => ['sku', 'code'], 'rows' => [[$sku, '6281234500123']]],
            ['name' => 'Unit Prices', 'headers' => ['sku', 'unit_name', 'price'], 'rows' => [[$sku, '', '55.00']]],
        ]);
        $file = UploadedFile::fake()->createWithContent('wb.xlsx', (string) file_get_contents($path));
        @unlink($path);

        return $file;
    }

    /** @test */
    public function a_sync_workbook_apply_with_its_binding_runs_and_consumes_the_preview(): void
    {
        $auth = $this->registerTenant();
        $priceList = $this->withToken($auth['token'])->postJson('/api/price-lists', ['name' => 'قائمة'])->assertCreated()['data']['id'];
        $this->product($auth['token'], 'SKU-WBS');
        $binding = $this->withToken($auth['token'])->post('/api/products/workbook/preview', ['file' => $this->workbook('SKU-WBS'), 'price_list_id' => $priceList], ['Accept' => 'application/json'])
            ->assertOk()->json('data.binding');
        $body = ['price_list_id' => $priceList, 'preview_id' => $binding['id'], 'preview_hash' => $binding['hash']];

        $this->withToken($auth['token'])->post('/api/products/workbook/apply', ['file' => $this->workbook('SKU-WBS')] + $body, ['Accept' => 'application/json'])->assertOk();
        $this->assertNotNull(ImportPreview::query()->whereKey($binding['id'])->value('consumed_at'));

        $this->withToken($auth['token'])->post('/api/products/workbook/apply', ['file' => $this->workbook('SKU-WBS')] + $body, ['Accept' => 'application/json'])
            ->assertStatus(422)->assertJsonPath('code', 'preview_consumed');
    }

    // ── نافذة المعاينة · قطعٌ لاحقة · التقليم ─────────────────────────────────

    /** @test */
    public function a_windowed_preview_stores_no_partial_plan(): void
    {
        $auth = $this->registerTenant();
        $binding = $this->preview($auth['token'], $this->csv([['PD-W1', 'واحد'], ['PD-W2', 'اثنان']]), ['mode' => 'create', 'batch_offset' => 0, 'batch_size' => 1]);

        $this->assertNull(ImportPreview::query()->whereKey($binding['id'])->value('plan'), 'خطّةٌ ناقصة كانت ستُنتج plan_drift زائفاً خارج النافذة.');
    }

    /** @test */
    public function a_drift_in_a_later_chunk_fails_the_job_after_the_earlier_chunks_were_written(): void
    {
        $auth = $this->registerTenant();
        $rows = [['PD-L1', 'واحد'], ['PD-L2', 'اثنان'], ['PD-L3', 'ثلاثة']];
        $binding = $this->preview($auth['token'], $this->csv($rows), ['mode' => 'upsert']);
        $jobId = $this->createJob($auth['token'], $this->csv($rows), $binding)->assertCreated()['data']['id'];

        $this->applyJob($auth['token'], $jobId, ['batch_size' => 1])->assertOk();
        $this->applyJob($auth['token'], $jobId, ['batch_size' => 1])->assertOk();
        $this->product($auth['token'], 'PD-L3', 'ظهر في الأثناء'); // الصف الأخير تغيّر من «إنشاء» إلى «تحديث»

        $this->applyJob($auth['token'], $jobId)->assertStatus(422);
        $this->assertSame('failed', ImportJob::query()->whereKey($jobId)->value('status'));
        // ما سبق التقاط الانجراف بقي مكتوباً (فشل على مستوى القطعة لا الملف — تحقّق الملف كاملاً قبل الكتابة = S5)، والمنتج الخارجي لم يُمسّ.
        $this->assertSame(2, Product::withoutGlobalScopes()->whereIn('sku', ['PD-L1', 'PD-L2'])->count());
        $this->assertSame('ظهر في الأثناء', Product::withoutGlobalScopes()->where('sku', 'PD-L3')->value('name'));
    }

    /** @test */
    public function prune_keeps_the_preview_of_an_unfinished_job_and_removes_it_once_the_job_ends(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $binding = $this->preview($auth['token'], $this->csv([['PD-PR', 'واحد']]), ['mode' => 'create']);
        $jobId = $this->createJob($auth['token'], $this->csv([['PD-PR', 'واحد']]), $binding, ['mode' => 'create'])->assertCreated()['data']['id'];
        ImportPreview::query()->whereKey($binding['id'])->update(['consumed_at' => now('UTC')->subDays(30), 'expires_at' => now('UTC')->subDays(30)]);

        $this->artisan('imports:prune')->assertSuccessful();
        $this->assertNotNull(ImportPreview::query()->whereKey($binding['id'])->first(), 'تشغيلةٌ لم تنتهِ ما زالت تقرأ خطّتها من هذه المعاينة.');

        $this->withToken($auth['token'])->postJson("/api/import-jobs/{$jobId}/cancel")->assertOk();
        $this->artisan('imports:prune')->assertSuccessful();
        $this->assertNull(ImportPreview::query()->whereKey($binding['id'])->first());
    }
}
