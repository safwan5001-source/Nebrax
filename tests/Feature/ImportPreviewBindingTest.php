<?php

namespace Tests\Feature;

use App\Models\ImportJob;
use App\Models\ImportPreview;
use App\Models\Product;
use App\Models\Warehouse;
use App\Services\ImportPreviewService;
use App\Services\ProductImportService;
use App\Support\ImportPreviewException;
use App\Support\SpreadsheetWriter;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * IMP-H1-S3b — ربط التنفيذ بمعاينته (القاعدة 5 و10 و12).
 *
 * المعاينة تُحفَظ في الخادم أحاديةَ الاستعمال وتُنفَق بإنشاء التشغيلة؛ ما يُنفَّذ هو ما عُوين حرفياً (ملف + خيارات + مطابقة +
 * فرع + مستخدم)، والخيارات تُجمَّد عند الإنشاء ولا يغيّرها طلب التطبيق.
 */
class ImportPreviewBindingTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
    }

    private function csv(string $sku = 'PB-1', string $name = 'منتج'): UploadedFile
    {
        return UploadedFile::fake()->createWithContent('catalog.csv', "sku,name,type,sale_price\n{$sku},{$name},good,10.00\n");
    }

    /** @return array{id:string,hash:string,expires_at:string} */
    private function previewCatalog(string $token, UploadedFile $file, array $fields = ['mode' => 'create'], array $headers = []): array
    {
        return $this->withToken($token)->withHeaders($headers)
            ->post('/api/products/import/preview', array_merge(['file' => $file], $fields), ['Accept' => 'application/json'])
            ->assertOk()->json('data.binding');
    }

    private function createJob(string $token, UploadedFile $file, ?array $binding, array $options = ['mode' => 'create'], array $extra = [], array $headers = [], string $domain = 'product_catalog')
    {
        $body = ['domain' => $domain, 'file' => $file, 'options' => $options] + $extra;
        if ($binding !== null) {
            $body['preview_id'] = $binding['id'];
            $body['preview_hash'] = $binding['hash'];
        }

        return $this->withToken($token)->withHeaders($headers)->post('/api/import-jobs', $body, ['Accept' => 'application/json']);
    }

    private function applyJob(string $token, string $id, array $body = [])
    {
        return $this->withToken($token)->postJson("/api/import-jobs/{$id}/apply", $body);
    }

    private function storedFileCount(): int
    {
        return count(Storage::disk('local')->allFiles());
    }

    // ── المعاينات تُصدِر ربطاً ───────────────────────────────────────────────

    /** @test */
    public function the_catalog_preview_issues_a_server_held_single_use_binding(): void
    {
        $auth = $this->registerTenant();

        $binding = $this->previewCatalog($auth['token'], $this->csv());

        $this->assertMatchesRegularExpression('/^[0-9a-f]{64}$/', $binding['hash']);
        $row = ImportPreview::query()->whereKey($binding['id'])->firstOrFail();
        $this->assertSame('product_catalog', $row->domain);
        $this->assertSame($binding['hash'], $row->preview_hash);
        $this->assertNull($row->consumed_at);
        $this->assertTrue($row->expires_at->isFuture());
        $this->assertSame('create', $row->options['mode']);
    }

    /** @test */
    public function the_workbook_and_opening_previews_issue_a_binding_too(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        Warehouse::create(['name' => 'مخزن', 'code' => 'WH-PB']);
        Product::create(['name' => 'صنف', 'sku' => 'SKU-PB', 'type' => 'good', 'sale_price' => 1000, 'track_inventory' => true]);

        $opening = UploadedFile::fake()->createWithContent('o.csv', SpreadsheetWriter::csv(
            ['sku', 'warehouse', 'opening_quantity', 'opening_unit_cost'], [['SKU-PB', 'WH-PB', '5', '2.00']]
        ));
        $binding = $this->withToken($auth['token'])
            ->post('/api/inventory-openings/import/preview', ['file' => $opening, 'opening_date' => '2026-01-01'], ['Accept' => 'application/json'])
            ->assertOk()->json('data.binding');

        $row = ImportPreview::query()->whereKey($binding['id'])->firstOrFail();
        $this->assertSame('inventory_opening', $row->domain);
        $this->assertSame('2026-01-01', $row->options['opening_date']);
    }

    // ── إنشاء التشغيلة بالمعاينة ─────────────────────────────────────────────

    /** @test */
    public function a_matching_preview_creates_a_bound_job_with_frozen_options_and_is_consumed(): void
    {
        $auth = $this->registerTenant();
        $binding = $this->previewCatalog($auth['token'], $this->csv());

        $response = $this->createJob($auth['token'], $this->csv(), $binding)->assertCreated();

        $this->assertTrue($response['data']['preview_bound']);
        $job = ImportJob::query()->whereKey($response['data']['id'])->firstOrFail();
        $this->assertSame($binding['id'], $job->preview_id);
        $this->assertSame($binding['hash'], $job->preview_hash);
        $this->assertSame('create', $job->apply_options['mode']);
        $preview = ImportPreview::query()->whereKey($binding['id'])->firstOrFail();
        $this->assertNotNull($preview->consumed_at);
        $this->assertSame($job->id, $preview->consumed_job_id);
    }

    /** @test */
    public function one_preview_yields_at_most_one_job_and_an_identical_replay_returns_it(): void
    {
        $auth = $this->registerTenant();
        $binding = $this->previewCatalog($auth['token'], $this->csv());
        $first = $this->createJob($auth['token'], $this->csv(), $binding)->assertCreated();
        $before = $this->storedFileCount();

        // ضاعت الاستجابة فأعاد العميل الطلب نفسه حرفياً (بلا مفتاح idempotency): التشغيلة نفسها لا `preview_consumed`.
        $replay = $this->createJob($auth['token'], $this->csv(), $binding)->assertOk();
        $this->assertSame($first['data']['id'], $replay['data']['id']);

        // أما أي اختلاف عن الطلب الأصلي (ملف/خيارات) فمعاينةٌ مستهلَكة تُرفض ولا تُنشئ ثانيةً.
        $this->createJob($auth['token'], $this->csv('PB-OTHER'), $binding)->assertStatus(422)->assertJsonPath('code', 'preview_consumed');
        $this->createJob($auth['token'], $this->csv(), $binding, ['mode' => 'upsert'])->assertStatus(422)->assertJsonPath('code', 'preview_consumed');

        $this->assertSame(1, ImportJob::query()->count());
        $this->assertSame($before, $this->storedFileCount(), 'لا ملف يتيم من الإعادة ولا من الرفض.');
    }

    /** @test */
    public function a_replay_by_another_user_or_branch_is_not_a_replay(): void
    {
        $auth = $this->registerTenant();
        $binding = $this->previewCatalog($auth['token'], $this->csv());
        $this->createJob($auth['token'], $this->csv(), $binding)->assertCreated();
        $colleague = $this->tokenForRole($auth['tenant_id'], 'admin', 'replay-colleague@pb.test');

        $this->createJob($colleague, $this->csv(), $binding)->assertStatus(422)->assertJsonPath('code', 'preview_consumed');
    }

    /** @test */
    public function a_different_file_or_options_or_mapping_is_a_mismatch_and_leaves_no_trace(): void
    {
        $auth = $this->registerTenant();
        $binding = $this->previewCatalog($auth['token'], $this->csv('PB-A'), ['mode' => 'create']);

        $this->createJob($auth['token'], $this->csv('PB-OTHER'), $binding)->assertStatus(422)->assertJsonPath('code', 'preview_mismatch');
        $this->createJob($auth['token'], $this->csv('PB-A'), $binding, ['mode' => 'upsert'])->assertStatus(422)->assertJsonPath('code', 'preview_mismatch');
        $this->createJob($auth['token'], $this->csv('PB-A'), $binding, ['mode' => 'create', 'mapping' => ['0' => 'sku']])->assertStatus(422)->assertJsonPath('code', 'preview_mismatch');

        $this->assertSame(0, ImportJob::query()->count());
        $this->assertSame(0, $this->storedFileCount());
        $this->assertNull(ImportPreview::query()->whereKey($binding['id'])->value('consumed_at'), 'الرفض لا ينفق المعاينة.');
        // والمعاينة ما زالت صالحة لطلبٍ مطابق.
        $this->createJob($auth['token'], $this->csv('PB-A'), $binding)->assertCreated();
    }

    /** @test */
    public function mapping_key_order_and_boolean_spelling_do_not_change_the_canonical_hash(): void
    {
        $auth = $this->registerTenant();
        $binding = $this->previewCatalog($auth['token'], $this->csv(), [
            'mode' => 'create',
            'mapping' => ['3' => 'sale_price', '2' => 'type', '1' => 'name', '0' => 'sku'],
            'apply_product_images' => '0',
        ]);

        $this->createJob($auth['token'], $this->csv(), $binding, [
            'mode' => 'create',
            'mapping' => ['0' => 'sku', '1' => 'name', '2' => 'type', '3' => 'sale_price'],
            'apply_product_images' => false,
        ])->assertCreated();
    }

    /** @test */
    public function an_unknown_wrong_hash_or_foreign_tenant_preview_is_invalid(): void
    {
        $auth = $this->registerTenant('pb-a', 'a@pb.test');
        $binding = $this->previewCatalog($auth['token'], $this->csv());

        $this->createJob($auth['token'], $this->csv(), ['id' => '00000000-0000-4000-8000-000000000000', 'hash' => $binding['hash']])
            ->assertStatus(422)->assertJsonPath('code', 'preview_invalid');
        $this->createJob($auth['token'], $this->csv(), ['id' => $binding['id'], 'hash' => str_repeat('a', 64)])
            ->assertStatus(422)->assertJsonPath('code', 'preview_invalid');

        $other = $this->registerTenant('pb-b', 'b@pb.test');
        $this->createJob($other['token'], $this->csv(), $binding)->assertStatus(422)->assertJsonPath('code', 'preview_invalid');
        $this->assertSame(0, ImportJob::withoutGlobalScopes()->count());
    }

    /** @test */
    public function a_preview_belongs_to_the_user_who_made_it(): void
    {
        $auth = $this->registerTenant();
        $binding = $this->previewCatalog($auth['token'], $this->csv());
        $colleague = $this->tokenForRole($auth['tenant_id'], 'admin', 'colleague@pb.test');

        $this->createJob($colleague, $this->csv(), $binding)->assertStatus(422)->assertJsonPath('code', 'preview_mismatch');
    }

    /** @test */
    public function an_expired_preview_is_refused(): void
    {
        $auth = $this->registerTenant();
        $binding = $this->previewCatalog($auth['token'], $this->csv());
        ImportPreview::query()->whereKey($binding['id'])->update(['expires_at' => now()->subMinute()]);

        $this->createJob($auth['token'], $this->csv(), $binding)->assertStatus(422)->assertJsonPath('code', 'preview_expired');
        $this->assertSame(0, ImportJob::query()->count());
    }

    /** @test */
    public function the_branch_is_part_of_the_binding(): void
    {
        $auth = $this->registerTenant();
        $other = $this->withToken($auth['token'])->postJson('/api/branches', ['name' => 'فرع الخبر'])->assertCreated()['data']['id'];
        $this->withoutHeader('X-Branch-Id');
        app(BranchContext::class)->forget();
        $binding = $this->previewCatalog($auth['token'], $this->csv());

        $this->createJob($auth['token'], $this->csv(), $binding, ['mode' => 'create'], [], ['X-Branch-Id' => $other])
            ->assertStatus(422)->assertJsonPath('code', 'preview_mismatch');
    }

    /** @test */
    public function a_preview_id_without_its_hash_is_a_validation_error(): void
    {
        $auth = $this->registerTenant();

        $this->withToken($auth['token'])->post('/api/import-jobs', [
            'domain' => 'product_catalog', 'file' => $this->csv(), 'preview_id' => '00000000-0000-4000-8000-000000000000',
        ], ['Accept' => 'application/json'])->assertStatus(422)->assertJsonValidationErrors(['preview_hash']);
    }

    // ── الإلزام (معطّل افتراضياً) ─────────────────────────────────────────────

    /** @test */
    public function a_job_without_a_preview_is_allowed_until_the_requirement_starts_then_refused(): void
    {
        $auth = $this->registerTenant();

        $this->createJob($auth['token'], $this->csv('PB-LEGACY'), null)->assertCreated()->assertJsonPath('data.preview_bound', false);

        config(['imports.preview_required_from' => now('UTC')->subMinute()->toIso8601String()]);
        $before = $this->storedFileCount();
        $this->createJob($auth['token'], $this->csv('PB-LEGACY-2'), null)->assertStatus(422)->assertJsonPath('code', 'preview_required');
        $this->assertSame($before, $this->storedFileCount());

        config(['imports.preview_required_from' => now('UTC')->addDay()->toIso8601String()]);
        $this->createJob($auth['token'], $this->csv('PB-LEGACY-3'), null)->assertCreated();
    }

    // ── التجميد عند التطبيق ───────────────────────────────────────────────────

    /** @test */
    public function apply_runs_the_frozen_options_and_rejects_a_different_option(): void
    {
        $auth = $this->registerTenant();
        $binding = $this->previewCatalog($auth['token'], $this->csv('PB-FZ'), ['mode' => 'create']);
        $jobId = $this->createJob($auth['token'], $this->csv('PB-FZ'), $binding)->assertCreated()['data']['id'];

        $this->applyJob($auth['token'], $jobId, ['mode' => 'upsert'])->assertStatus(422)->assertJsonPath('code', 'options_frozen');
        $this->applyJob($auth['token'], $jobId, ['master_data_policy' => ProductImportService::MASTER_DATA_ERROR])->assertStatus(422)->assertJsonPath('code', 'options_frozen');
        $this->assertSame(0, Product::withoutGlobalScopes()->where('sku', 'PB-FZ')->count());
        $this->assertSame('ready', ImportJob::query()->whereKey($jobId)->value('status'));

        // نفس الخيارات، أو بلا خيارات، أو `batch_size` التشغيلي: مقبولة.
        $this->applyJob($auth['token'], $jobId, ['mode' => 'create', 'batch_size' => 50])->assertOk()->assertJsonPath('data.status', 'completed');
        $this->assertSame(1, Product::withoutGlobalScopes()->where('sku', 'PB-FZ')->count());
    }

    /** @test */
    public function apply_without_any_options_runs_the_frozen_ones(): void
    {
        $auth = $this->registerTenant();
        $binding = $this->previewCatalog($auth['token'], $this->csv('PB-NOOPT'), ['mode' => 'create']);
        $jobId = $this->createJob($auth['token'], $this->csv('PB-NOOPT'), $binding)->assertCreated()['data']['id'];

        $this->applyJob($auth['token'], $jobId)->assertOk()->assertJsonPath('data.status', 'completed');
        $this->assertSame(1, Product::withoutGlobalScopes()->where('sku', 'PB-NOOPT')->count());
    }

    /** @test */
    public function an_unbound_legacy_job_still_freezes_the_options_of_its_first_apply(): void
    {
        $auth = $this->registerTenant();
        $jobId = $this->createJob($auth['token'], $this->csv('PB-OLD'), null, [])->assertCreated()['data']['id'];

        $this->applyJob($auth['token'], $jobId, ['mode' => 'create'])->assertOk();
        $this->assertSame('create', ImportJob::query()->whereKey($jobId)->value('apply_options')['mode']);
    }

    // ── هوية إعادة المحاولة (القاعدة 12) ──────────────────────────────────────

    /** @test */
    public function an_idempotent_retry_with_the_same_preview_returns_the_same_job(): void
    {
        $auth = $this->registerTenant();
        $binding = $this->previewCatalog($auth['token'], $this->csv('PB-IDEM'));

        $first = $this->createJob($auth['token'], $this->csv('PB-IDEM'), $binding, ['mode' => 'create'], ['idempotency_key' => 'pb-idem-1'])->assertCreated();
        $again = $this->createJob($auth['token'], $this->csv('PB-IDEM'), $binding, ['mode' => 'create'], ['idempotency_key' => 'pb-idem-1'])->assertOk();

        $this->assertSame($first['data']['id'], $again['data']['id']);
        $this->assertSame(1, ImportJob::query()->count());
    }

    /** @test */
    public function the_same_key_and_file_with_other_options_or_no_preview_is_not_a_retry(): void
    {
        $auth = $this->registerTenant();
        $binding = $this->previewCatalog($auth['token'], $this->csv('PB-ID2'));
        $this->createJob($auth['token'], $this->csv('PB-ID2'), $binding, ['mode' => 'create'], ['idempotency_key' => 'pb-idem-2'])->assertCreated();

        // نفس الملف والمفتاح، خياراتٌ مختلفة ⇒ ليست إعادة محاولة (حتى بمعاينةٍ جديدة صالحة لها).
        $second = $this->previewCatalog($auth['token'], $this->csv('PB-ID2'), ['mode' => 'upsert']);
        $this->createJob($auth['token'], $this->csv('PB-ID2'), $second, ['mode' => 'upsert'], ['idempotency_key' => 'pb-idem-2'])->assertStatus(422);
        // وبلا معاينة أصلاً.
        $this->createJob($auth['token'], $this->csv('PB-ID2'), null, ['mode' => 'create'], ['idempotency_key' => 'pb-idem-2'])->assertStatus(422);
        $this->assertSame(1, ImportJob::query()->count());
    }

    // ── الإنفاق الشرطي والتقليم ──────────────────────────────────────────────

    /** @test */
    public function consuming_is_a_conditional_update_so_a_second_consume_is_refused(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $binding = $this->previewCatalog($auth['token'], $this->csv());
        $service = app(ImportPreviewService::class);
        $preview = ImportPreview::query()->whereKey($binding['id'])->firstOrFail();

        $service->consume($preview, '11111111-1111-4111-8111-111111111111');

        $threw = null;
        try {
            $service->consume($preview->fresh(), '22222222-2222-4222-8222-222222222222');
        } catch (ImportPreviewException $e) {
            $threw = $e;
        }
        $this->assertNotNull($threw);
        $this->assertSame('preview_consumed', $threw->reason);
        $this->assertSame('11111111-1111-4111-8111-111111111111', ImportPreview::query()->whereKey($binding['id'])->value('consumed_job_id'));
    }

    /** @test */
    public function prune_removes_stale_previews_but_keeps_live_ones(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $live = $this->previewCatalog($auth['token'], $this->csv('PB-LIVE'));
        $stale = $this->previewCatalog($auth['token'], $this->csv('PB-STALE'));
        ImportPreview::query()->whereKey($stale['id'])->update(['expires_at' => now()->subDays(3)]);

        $this->artisan('imports:prune')->assertSuccessful();

        $this->assertNotNull(ImportPreview::query()->whereKey($live['id'])->first());
        $this->assertNull(ImportPreview::query()->whereKey($stale['id'])->first());
    }

    // ── مجالات أخرى ──────────────────────────────────────────────────────────

    /** @test */
    public function an_inventory_opening_job_is_bound_to_its_preview_and_options_are_frozen(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        Warehouse::create(['name' => 'مخزن', 'code' => 'WH-PB2']);
        Product::create(['name' => 'صنف', 'sku' => 'SKU-PB2', 'type' => 'good', 'sale_price' => 1000, 'track_inventory' => true]);
        $file = fn () => UploadedFile::fake()->createWithContent('o.csv', SpreadsheetWriter::csv(
            ['sku', 'warehouse', 'opening_quantity', 'opening_unit_cost'], [['SKU-PB2', 'WH-PB2', '5', '2.00']]
        ));
        $binding = $this->withToken($auth['token'])
            ->post('/api/inventory-openings/import/preview', ['file' => $file(), 'opening_date' => '2026-01-01'], ['Accept' => 'application/json'])
            ->assertOk()->json('data.binding');

        // تاريخٌ آخر ⇒ ليست المعاينة نفسها.
        $this->createJob($auth['token'], $file(), $binding, ['opening_date' => '2026-02-01'], [], [], 'inventory_opening')
            ->assertStatus(422)->assertJsonPath('code', 'preview_mismatch');

        $jobId = $this->createJob($auth['token'], $file(), $binding, ['opening_date' => '2026-01-01'], [], [], 'inventory_opening')->assertCreated()['data']['id'];
        $this->applyJob($auth['token'], $jobId, ['opening_date' => '2026-03-01'])->assertStatus(422)->assertJsonPath('code', 'options_frozen');
        $this->applyJob($auth['token'], $jobId, ['opening_date' => '2026-01-01'])->assertOk()->assertJsonPath('data.status', 'completed');
    }

    /** @test */
    public function the_job_exposes_only_a_boolean_never_the_preview_hash(): void
    {
        $auth = $this->registerTenant();
        $binding = $this->previewCatalog($auth['token'], $this->csv());

        $response = $this->createJob($auth['token'], $this->csv(), $binding)->assertCreated();

        $this->assertStringNotContainsString($binding['hash'], $response->getContent());
        $this->assertArrayNotHasKey('preview_hash', $response['data']);
    }

    // ── توقيت الانقضاء ────────────────────────────────────────────────────────

    /** @test */
    public function expiry_is_independent_of_the_application_timezone(): void
    {
        $auth = $this->registerTenant();
        $original = date_default_timezone_get();
        date_default_timezone_set('Asia/Riyadh'); // +03:00: القراءة بمنطقة التطبيق كانت تجعل المعاينة منتهيةً فوراً.
        try {
            $binding = $this->previewCatalog($auth['token'], $this->csv('PB-TZ'));
            $this->assertSame('+00:00', \Carbon\Carbon::parse($binding['expires_at'])->format('P'), 'الانقضاء المُعاد بتوقيت UTC.');
            $this->createJob($auth['token'], $this->csv('PB-TZ'), $binding)->assertCreated();

            // وفي الاتجاه المعاكس: منتهيةٌ فعلاً تُرفض مهما كانت منطقة التطبيق.
            $stale = $this->previewCatalog($auth['token'], $this->csv('PB-TZ2'));
            ImportPreview::query()->whereKey($stale['id'])->update(['expires_at' => now('UTC')->subMinute()]);
            $this->createJob($auth['token'], $this->csv('PB-TZ2'), $stale)->assertStatus(422)->assertJsonPath('code', 'preview_expired');
        } finally {
            date_default_timezone_set($original);
        }
    }

    // ── تنظيف الملفات عند فشل الإنفاق داخل المعاملة ───────────────────────────

    /** @test */
    public function a_preview_consumed_between_the_check_and_the_insert_rolls_back_the_job_and_deletes_the_upload(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $binding = $this->previewCatalog($auth['token'], $this->csv('PB-RACE'));

        // يحاكي سباقاً: يُنفَق السجل بعد اجتياز `assertConsumable` وقبل الإدراج.
        $this->app->singleton(ImportPreviewService::class, function ($app) {
            return new class($app->make(\App\Services\ImportDomainRegistry::class), $app->make(TenantContext::class), $app->make(BranchContext::class)) extends ImportPreviewService {
                public function assertConsumable(string $previewId, string $previewHash, ?string $userId, string $domain, string $fileSha, ?string $archiveSha, array $canonical): ImportPreview
                {
                    $preview = parent::assertConsumable($previewId, $previewHash, $userId, $domain, $fileSha, $archiveSha, $canonical);
                    ImportPreview::query()->whereKey($previewId)->update(['consumed_at' => now('UTC'), 'consumed_job_id' => '99999999-9999-4999-8999-999999999999']);

                    return $preview;
                }
            };
        });
        $this->app->forgetInstance(\App\Services\ImportJobService::class);
        $before = $this->storedFileCount();

        $this->createJob($auth['token'], $this->csv('PB-RACE'), $binding)->assertStatus(422)->assertJsonPath('code', 'preview_consumed');

        $this->assertSame(0, ImportJob::query()->count(), 'لا تشغيلة تبقى بلا إنفاق.');
        $this->assertSame($before, $this->storedFileCount(), 'الملف المخزَّن حُذف.');
    }

    // ── خيارات أخرى مقيَّدة ───────────────────────────────────────────────────

    /** @test */
    public function the_image_flag_is_part_of_the_binding(): void
    {
        $auth = $this->registerTenant();
        $binding = $this->previewCatalog($auth['token'], $this->csv('PB-IMG'), ['mode' => 'create']);

        // معاينةٌ بلا تطبيق صور ⇒ إنشاءٌ بتطبيقها ليس المعاينة نفسها (كانت واجهةٌ تُرسلهما مختلفتين فتفشل).
        $this->createJob($auth['token'], $this->csv('PB-IMG'), $binding, ['mode' => 'create', 'apply_product_images' => true])
            ->assertStatus(422)->assertJsonPath('code', 'preview_mismatch');

        $withImages = $this->previewCatalog($auth['token'], $this->csv('PB-IMG'), ['mode' => 'create', 'apply_product_images' => '1']);
        $this->createJob($auth['token'], $this->csv('PB-IMG'), $withImages, ['mode' => 'create', 'apply_product_images' => true])->assertCreated();
    }

    /** @test */
    public function apply_rejects_a_changed_mapping_but_accepts_the_same_one(): void
    {
        $auth = $this->registerTenant();
        $mapping = ['0' => 'sku', '1' => 'name', '2' => 'type', '3' => 'sale_price'];
        $binding = $this->previewCatalog($auth['token'], $this->csv('PB-MAP'), ['mode' => 'create', 'mapping' => $mapping]);
        $jobId = $this->createJob($auth['token'], $this->csv('PB-MAP'), $binding, ['mode' => 'create', 'mapping' => $mapping])->assertCreated()['data']['id'];

        $this->applyJob($auth['token'], $jobId, ['mapping' => ['0' => 'name', '1' => 'sku', '2' => 'type', '3' => 'sale_price']])
            ->assertStatus(422)->assertJsonPath('code', 'options_frozen');
        $this->applyJob($auth['token'], $jobId, ['approve_existing_media_updates' => true])
            ->assertStatus(422)->assertJsonPath('code', 'options_frozen');
        $this->assertSame(0, Product::withoutGlobalScopes()->where('sku', 'PB-MAP')->count());

        $this->applyJob($auth['token'], $jobId, ['mode' => 'create', 'mapping' => $mapping])->assertOk()->assertJsonPath('data.status', 'completed');
    }

    /** @test */
    public function an_empty_mapping_at_apply_is_not_a_change(): void
    {
        $auth = $this->registerTenant();
        $binding = $this->previewCatalog($auth['token'], $this->csv('PB-EMP'), ['mode' => 'create']);
        $jobId = $this->createJob($auth['token'], $this->csv('PB-EMP'), $binding)->assertCreated()['data']['id'];

        $this->applyJob($auth['token'], $jobId, ['mode' => 'create', 'mapping' => []])->assertOk()->assertJsonPath('data.status', 'completed');
        $this->assertSame(1, Product::withoutGlobalScopes()->where('sku', 'PB-EMP')->count());
    }

    /** @test */
    public function opening_notes_and_zero_cost_are_frozen(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        Warehouse::create(['name' => 'مخزن', 'code' => 'WH-PB3']);
        Product::create(['name' => 'صنف', 'sku' => 'SKU-PB3', 'type' => 'good', 'sale_price' => 1000, 'track_inventory' => true]);
        $file = fn () => UploadedFile::fake()->createWithContent('o.csv', SpreadsheetWriter::csv(
            ['sku', 'warehouse', 'opening_quantity', 'opening_unit_cost'], [['SKU-PB3', 'WH-PB3', '5', '2.00']]
        ));
        $binding = $this->withToken($auth['token'])
            ->post('/api/inventory-openings/import/preview', ['file' => $file(), 'opening_date' => '2026-01-01', 'notes' => 'ملاحظة'], ['Accept' => 'application/json'])
            ->assertOk()->json('data.binding');

        $this->createJob($auth['token'], $file(), $binding, ['opening_date' => '2026-01-01', 'notes' => 'غيرها'], [], [], 'inventory_opening')
            ->assertStatus(422)->assertJsonPath('code', 'preview_mismatch');
        $jobId = $this->createJob($auth['token'], $file(), $binding, ['opening_date' => '2026-01-01', 'notes' => 'ملاحظة'], [], [], 'inventory_opening')->assertCreated()['data']['id'];

        $this->applyJob($auth['token'], $jobId, ['notes' => 'تغيّرت'])->assertStatus(422)->assertJsonPath('code', 'options_frozen');
        $this->applyJob($auth['token'], $jobId, ['allow_zero_cost' => true])->assertStatus(422)->assertJsonPath('code', 'options_frozen');
    }

    /** @test */
    public function a_workbook_job_is_bound_including_its_price_list(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $priceList = $this->withToken($auth['token'])->postJson('/api/price-lists', ['name' => 'قائمة الجملة'])->assertCreated()['data']['id'];
        $otherList = $this->withToken($auth['token'])->postJson('/api/price-lists', ['name' => 'قائمة أخرى'])->assertCreated()['data']['id'];
        $this->withToken($auth['token'])->postJson('/api/products', ['name' => 'قائم', 'sku' => 'SKU-WBP', 'type' => 'good', 'sale_price' => 10000])->assertCreated();
        $file = function () {
            $path = tempnam(sys_get_temp_dir(), 'pb-wb-');
            SpreadsheetWriter::workbookXlsx($path, [
                ['name' => 'Products', 'headers' => ['sku', 'name', 'type', 'unit', 'sale_price'], 'rows' => []],
                ['name' => 'Barcodes', 'headers' => ['sku', 'code'], 'rows' => [['SKU-WBP', '6281234500099']]],
                ['name' => 'Unit Prices', 'headers' => ['sku', 'unit_name', 'price'], 'rows' => [['SKU-WBP', '', '55.00']]],
            ]);
            $f = UploadedFile::fake()->createWithContent('wb.xlsx', (string) file_get_contents($path));
            @unlink($path);

            return $f;
        };
        $binding = $this->withToken($auth['token'])
            ->post('/api/products/workbook/preview', ['file' => $file(), 'price_list_id' => $priceList], ['Accept' => 'application/json'])
            ->assertOk()->json('data.binding');

        $this->createJob($auth['token'], $file(), $binding, ['price_list_id' => $otherList], [], [], 'product_workbook')
            ->assertStatus(422)->assertJsonPath('code', 'preview_mismatch');
        $jobId = $this->createJob($auth['token'], $file(), $binding, ['price_list_id' => $priceList], [], [], 'product_workbook')->assertCreated()['data']['id'];

        $this->applyJob($auth['token'], $jobId, ['price_list_id' => $otherList])->assertStatus(422)->assertJsonPath('code', 'options_frozen');
        $this->applyJob($auth['token'], $jobId, ['price_list_id' => $priceList])->assertOk()->assertJsonPath('data.status', 'completed');
    }

    // ── هوية إعادة المحاولة ───────────────────────────────────────────────────

    /** @test */
    public function a_create_retry_after_the_first_apply_chunk_is_still_the_same_request(): void
    {
        $auth = $this->registerTenant();
        $binding = $this->previewCatalog($auth['token'], $this->csv('PB-RETRY'));
        $first = $this->createJob($auth['token'], $this->csv('PB-RETRY'), $binding, ['mode' => 'create'], ['idempotency_key' => 'pb-retry-1'])->assertCreated();
        // أول قطعة تُضيف `batch_size` التشغيلي إلى الخيارات المخزَّنة.
        $this->applyJob($auth['token'], $first['data']['id'], ['batch_size' => 10])->assertOk();

        $again = $this->createJob($auth['token'], $this->csv('PB-RETRY'), $binding, ['mode' => 'create'], ['idempotency_key' => 'pb-retry-1'])->assertOk();
        $this->assertSame($first['data']['id'], $again['data']['id']);
    }

    /** @test */
    public function a_different_option_under_the_same_key_says_why(): void
    {
        $auth = $this->registerTenant();
        $binding = $this->previewCatalog($auth['token'], $this->csv('PB-WHY'));
        $this->createJob($auth['token'], $this->csv('PB-WHY'), $binding, ['mode' => 'create'], ['idempotency_key' => 'pb-why-1'])->assertCreated();
        $second = $this->previewCatalog($auth['token'], $this->csv('PB-WHY'), ['mode' => 'upsert']);

        $response = $this->createJob($auth['token'], $this->csv('PB-WHY'), $second, ['mode' => 'upsert'], ['idempotency_key' => 'pb-why-1'])->assertStatus(422);
        $this->assertStringContainsString('idempotency', (string) $response->json('message'));
    }
}
