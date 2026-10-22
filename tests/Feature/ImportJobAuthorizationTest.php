<?php

namespace Tests\Feature;

use App\Models\ImportJob;
use App\Models\InventoryOpening;
use App\Models\Product;
use App\Models\TenantApplicationState;
use App\Models\Warehouse;
use App\Services\ImportJobFileStorage;
use App\Services\ImportJobService;
use App\Support\ImportJobDomain;
use App\Support\ImportJobStatus;
use App\Support\SpreadsheetWriter;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Storage;
use ReflectionClass;
use Tests\TestCase;

/**
 * IMP-H1-S1 — تفويض تشغيلات الاستيراد الدائم **حسب المجال** + تنظيف أرشيفات الصور المنتهية.
 *
 * قبل هذا التغيير: كل مسارات `/import-jobs` تشترط `products.view|manage` وحدها، فيرث `inventory_opening`
 * صلاحيات المنتجات ولا يخضع لقدرة `inventory.core` التي تحرس واجهته المباشرة (`inventory-openings/import/*`).
 * بعده: كل عملية تفرض بوابات **مجال التشغيلة** (`ImportJobDomain::authorization`) بالمنطق نفسه الذي يفرضه
 * `EnsurePermission`/`EnsureApplicationActive`.
 */
class ImportJobAuthorizationTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
    }

    /** مؤسسة بلا قدرات مفعّلة تلقائياً (القدرات الاختيارية معطّلة افتراضياً)، بمنتج ومخزن جاهزين. */
    private function scene(string $slug = 'acme', bool $inventoryEnabled = true): array
    {
        $auth = $this->registerTenant($slug, "owner@{$slug}.test", autoEnableApplications: false);
        app(TenantContext::class)->set($auth['tenant_id']);

        Warehouse::create(['name' => 'مستودع', 'code' => "WH-{$slug}"]);
        Product::create([
            'name' => 'قهوة', 'sku' => "SKU-{$slug}", 'type' => 'good',
            'sale_price' => 25000, 'purchase_price' => 15000, 'track_inventory' => true,
        ]);

        if ($inventoryEnabled) {
            $this->setInventoryStatus($auth['tenant_id'], 'enabled');
        }

        return $auth + ['slug' => $slug];
    }

    private function setInventoryStatus(string $tenantId, string $status): void
    {
        app(TenantContext::class)->set($tenantId);
        TenantApplicationState::updateOrCreate(
            ['application_key' => 'inventory.core'],
            ['requested_enabled' => $status === 'enabled', 'status' => $status],
        );
    }

    private function openingsFile(string $slug): UploadedFile
    {
        return UploadedFile::fake()->createWithContent('openings.csv', SpreadsheetWriter::csv(
            ['sku', 'warehouse', 'opening_quantity', 'opening_unit_cost'],
            [["SKU-{$slug}", "WH-{$slug}", '10', '5.00']]
        ));
    }

    private function catalogFile(string $name = 'catalog.csv'): UploadedFile
    {
        return UploadedFile::fake()->createWithContent($name, "sku,name,type,sale_price\nNEW-1,منتج جديد,good,100.00\n");
    }

    private function createOpeningJob(string $token, string $slug): string
    {
        return $this->withToken($token)
            ->post('/api/import-jobs', ['domain' => 'inventory_opening', 'file' => $this->openingsFile($slug)])
            ->assertCreated()
            ->json('data.id');
    }

    private function createCatalogJob(string $token): string
    {
        return $this->withToken($token)
            ->post('/api/import-jobs', ['domain' => 'product_catalog', 'file' => $this->catalogFile()])
            ->assertCreated()
            ->json('data.id');
    }

    // ═══════════════════════════════════════════════════════════
    //  حارس البنية: لا مجال بلا بوابات
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function every_registered_domain_declares_its_gates_and_unknown_domains_fail_closed(): void
    {
        foreach (ImportJobDomain::values() as $domain) {
            $gates = ImportJobDomain::authorization($domain);
            $this->assertNotSame('', $gates['view'], $domain);
            $this->assertNotSame('', $gates['manage'], $domain);
            $this->assertContains($gates['view'], \App\Support\Rbac::PERMISSIONS, "{$domain}: صلاحية العرض غير معروفة");
            $this->assertContains($gates['manage'], \App\Support\Rbac::PERMISSIONS, "{$domain}: صلاحية الإدارة غير معروفة");
            if ($gates['app'] !== null) {
                $this->assertTrue(\App\Support\ApplicationCatalog::exists($gates['app']), "{$domain}: مفتاح القدرة غير موجود في الكتالوج");
            }
        }

        // الخريطة نفسها لا تحمل مجالاً خارج `values()` (لا مجال مخفي بلا تسجيل).
        $declared = array_keys((new ReflectionClass(ImportJobDomain::class))->getReflectionConstant('AUTHORIZATION')->getValue());
        $this->assertEqualsCanonicalizing(ImportJobDomain::values(), $declared);

        $this->expectException(\InvalidArgumentException::class);
        ImportJobDomain::authorization('not_a_domain');
    }

    // ═══════════════════════════════════════════════════════════
    //  قدرة المجال (inventory.core) — الثغرة التي أُغلقت
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function creating_an_inventory_opening_job_is_refused_when_inventory_core_is_disabled(): void
    {
        $scene = $this->scene(inventoryEnabled: false);

        $this->withToken($scene['token'])
            ->post('/api/import-jobs', ['domain' => 'inventory_opening', 'file' => $this->openingsFile($scene['slug'])])
            ->assertForbidden();

        app(TenantContext::class)->set($scene['tenant_id']);
        $this->assertSame(0, ImportJob::query()->count(), 'لا تشغيلة ولا ملف مخزَّن عند الرفض.');
        $this->assertSame([], Storage::disk('local')->allFiles(), 'الرفض يسبق تخزين أي ملف.');
    }

    /** @test */
    public function applying_an_opening_job_is_refused_once_inventory_core_is_disabled_and_creates_no_draft(): void
    {
        $scene = $this->scene();
        $jobId = $this->createOpeningJob($scene['token'], $scene['slug']);

        $this->setInventoryStatus($scene['tenant_id'], 'disabled');

        $this->withToken($scene['token'])
            ->postJson("/api/import-jobs/{$jobId}/apply", ['opening_date' => '2026-01-01'])
            ->assertForbidden();

        app(TenantContext::class)->set($scene['tenant_id']);
        $this->assertSame(0, InventoryOpening::query()->count(), 'لا مسودة افتتاحية رغم صحة الطلب.');
        $this->assertSame(ImportJobStatus::READY, ImportJob::query()->findOrFail($jobId)->status, 'حالة التشغيلة لم تتغيّر.');
    }

    /** @test */
    public function a_suspended_inventory_core_allows_reading_a_job_but_not_applying_or_cancelling_it(): void
    {
        $scene = $this->scene();
        $jobId = $this->createOpeningJob($scene['token'], $scene['slug']);
        $this->setInventoryStatus($scene['tenant_id'], 'suspended');

        $this->withToken($scene['token'])->getJson("/api/import-jobs/{$jobId}")->assertOk();
        $this->withToken($scene['token'])
            ->postJson("/api/import-jobs/{$jobId}/apply", ['opening_date' => '2026-01-01'])
            ->assertForbidden();
        $this->withToken($scene['token'])->postJson("/api/import-jobs/{$jobId}/cancel")->assertForbidden();
        $this->withToken($scene['token'])
            ->post('/api/import-jobs', ['domain' => 'inventory_opening', 'file' => $this->openingsFile($scene['slug'])])
            ->assertForbidden();
    }

    /** @test */
    public function a_disabled_inventory_core_hides_opening_jobs_from_show_and_the_list(): void
    {
        $scene = $this->scene();
        $openingId = $this->createOpeningJob($scene['token'], $scene['slug']);
        $catalogId = $this->createCatalogJob($scene['token']);

        $this->setInventoryStatus($scene['tenant_id'], 'disabled');

        $this->withToken($scene['token'])->getJson("/api/import-jobs/{$openingId}")->assertForbidden();

        $ids = collect($this->withToken($scene['token'])->getJson('/api/import-jobs')->assertOk()->json('data'))->pluck('id')->all();
        $this->assertContains($catalogId, $ids, 'مجال المنتجات لا يتأثر بتعطيل قدرة المخزون.');
        $this->assertNotContains($openingId, $ids, 'تشغيلات مجالٍ قدرته معطّلة لا تظهر.');
    }

    /** @test */
    public function catalog_jobs_are_unaffected_by_a_disabled_inventory_core(): void
    {
        $scene = $this->scene(inventoryEnabled: false);

        $jobId = $this->createCatalogJob($scene['token']);
        $this->withToken($scene['token'])->getJson("/api/import-jobs/{$jobId}")->assertOk();
        $this->withToken($scene['token'])->postJson("/api/import-jobs/{$jobId}/apply", [])->assertOk();
    }

    // ═══════════════════════════════════════════════════════════
    //  صلاحيات RBAC حسب العملية
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function a_role_without_manage_cannot_create_apply_or_cancel_in_any_domain(): void
    {
        $scene = $this->scene();
        $ownerJobId = $this->createOpeningJob($scene['token'], $scene['slug']);
        $catalogJobId = $this->createCatalogJob($scene['token']);
        $staff = $this->tokenForRole($scene['tenant_id'], 'staff', 'staff@acme.test'); // products.view فقط

        foreach (['product_catalog', 'inventory_opening'] as $domain) {
            $file = $domain === 'product_catalog' ? $this->catalogFile('s.csv') : $this->openingsFile($scene['slug']);
            $this->withToken($staff)->post('/api/import-jobs', ['domain' => $domain, 'file' => $file])->assertForbidden();
        }
        foreach ([$ownerJobId, $catalogJobId] as $id) {
            $this->withToken($staff)->postJson("/api/import-jobs/{$id}/apply", ['opening_date' => '2026-01-01'])->assertForbidden();
            $this->withToken($staff)->postJson("/api/import-jobs/{$id}/cancel")->assertForbidden();
            // العرض متاح لمن يملك `products.view`.
            $this->withToken($staff)->getJson("/api/import-jobs/{$id}")->assertOk();
        }
    }

    /** @test */
    public function a_role_without_view_gets_forbidden_on_show_and_an_empty_list_not_other_users_jobs(): void
    {
        $scene = $this->scene();
        $jobId = $this->createCatalogJob($scene['token']);
        $selfService = $this->tokenForRole($scene['tenant_id'], 'self_service', 'ss@acme.test'); // لا products.*

        $this->withToken($selfService)->getJson("/api/import-jobs/{$jobId}")->assertForbidden();
        $this->assertSame([], $this->withToken($selfService)->getJson('/api/import-jobs')->assertOk()->json('data'));
        $this->withToken($selfService)->post('/api/import-jobs', ['domain' => 'product_catalog', 'file' => $this->catalogFile()])->assertForbidden();
        // مجال غير معروف: يُحاسَب على بوابات المنتجات (لا يتحوّل 403 إلى 422 لمن لا يملك أي صلاحية).
        $this->withToken($selfService)->post('/api/import-jobs', ['domain' => 'nope', 'file' => $this->catalogFile()])->assertForbidden();
        $this->withToken($scene['token'])->post('/api/import-jobs', ['domain' => 'nope', 'file' => $this->catalogFile()])->assertStatus(422);
    }

    /** @test */
    public function cross_tenant_access_is_still_not_found(): void
    {
        $a = $this->scene('tenant-a');
        $b = $this->scene('tenant-b');
        $jobId = $this->createCatalogJob($a['token']);

        $this->withToken($b['token'])->getJson("/api/import-jobs/{$jobId}")->assertNotFound();
        $this->withToken($b['token'])->postJson("/api/import-jobs/{$jobId}/apply", [])->assertNotFound();
        $this->withToken($b['token'])->postJson("/api/import-jobs/{$jobId}/cancel")->assertNotFound();
        $this->assertSame([], $this->withToken($b['token'])->getJson('/api/import-jobs')->assertOk()->json('data'));
    }

    // ═══════════════════════════════════════════════════════════
    //  احتفاظ: أرشيف الصور لا يتجاوز نافذة التقليم
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function prune_deletes_the_media_archive_of_a_completed_job_with_its_file(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);

        $service = app(ImportJobService::class);
        $job = $service->create($this->catalogFile('done.csv'), 'product_catalog', null, null);
        $job = $service->applyNextChunk($job, [], null, true);
        $this->assertSame(ImportJobStatus::COMPLETED, $job->status);

        // أرشيف صور بقي على تشغيلة منتهية (المسار الذي كان يُسرَّب).
        $storage = app(ImportJobFileStorage::class);
        $stored = $storage->storeMediaArchive($auth['tenant_id'], $job->id, UploadedFile::fake()->create('images.zip', 4, 'application/zip'));
        $job->forceFill(['media_archive_storage_path' => $stored['path'], 'purge_after' => now()->subDay()])->save();
        $disk = Storage::disk('local');
        $this->assertTrue($disk->exists($stored['path']));

        Artisan::call('imports:prune', ['--dry-run' => true]);
        $this->assertTrue($disk->exists($stored['path']), 'dry-run لا يحذف شيئاً.');
        $this->assertNotNull(ImportJob::withoutGlobalScopes()->find($job->id));

        Artisan::call('imports:prune');

        $this->assertNull(ImportJob::withoutGlobalScopes()->find($job->id));
        $this->assertFalse($disk->exists($stored['path']), 'أرشيف الصور يُحذف مع صفّ التشغيلة.');
    }

    /** @test */
    public function prune_does_not_touch_the_media_archive_of_a_job_still_inside_its_retention_window(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);

        $service = app(ImportJobService::class);
        $job = $service->create($this->catalogFile('fresh.csv'), 'product_catalog', null, null);
        $job = $service->applyNextChunk($job, [], null, true);
        $stored = app(ImportJobFileStorage::class)->storeMediaArchive($auth['tenant_id'], $job->id, UploadedFile::fake()->create('images.zip', 4, 'application/zip'));
        $job->forceFill(['media_archive_storage_path' => $stored['path'], 'purge_after' => now()->addDay()])->save();

        Artisan::call('imports:prune');

        $this->assertNotNull(ImportJob::withoutGlobalScopes()->find($job->id));
        $this->assertTrue(Storage::disk('local')->exists($stored['path']));
    }
}
