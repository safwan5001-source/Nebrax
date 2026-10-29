<?php

namespace Tests\Feature;

use App\Models\ImportJob;
use App\Models\JournalEntry;
use App\Models\Product;
use App\Models\Role;
use App\Models\StockMovement;
use App\Models\StockPermit;
use App\Models\TenantApplicationState;
use App\Models\Warehouse;
use App\Services\AiActionRegistry;
use App\Services\Accounting\InventoryService;
use App\Services\StockPermitImportAdapter;
use App\Support\ImportJobDomain;
use App\Support\SpreadsheetWriter;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * IMP-H7-S3 — نقاط استيراد بنود إذنٍ مخزني مسودة (قالب/حقول/فحص/معاينة) ومجال `stock_permit_import` في المحرك الدائم: مربوط بمعاينة وحدته الملف كله، بوابتا
 * `POST stock-permits` (`products.manage` + `inventory.core`)، عزل المستأجر، وعدم أي ترحيل أو قيد أو حركة مخزون. لا مسار ذكاء اصطناعي (D-09).
 *
 * تشغيل: php artisan test --filter=StockPermitImportEndpointsTest
 */
class StockPermitImportEndpointsTest extends TestCase
{
    use InteractsWithApi;
    use RefreshDatabase;

    private array $auth;

    private Warehouse $main;

    private Warehouse $second;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
        $this->auth = $this->registerTenant();
        app(TenantContext::class)->set($this->auth['tenant_id']);
        $this->main = Warehouse::create(['name' => 'المخزن الرئيسي', 'code' => 'WH-1', 'is_default' => true]);
        $this->second = Warehouse::create(['name' => 'مخزن ثانٍ', 'code' => 'WH-2']);
        $cement = Product::create(['name' => 'إسمنت', 'sku' => 'CEM-50', 'type' => 'good', 'sale_price' => 5000, 'purchase_price' => 2500, 'track_inventory' => true]);
        app(InventoryService::class)->receiveStock($cement, 100, 2500, ['warehouse_id' => $this->main->id]);
    }

    /** @param list<array<string,string>> $rows */
    private function file(array $rows): UploadedFile
    {
        $keys = array_values(array_unique(array_merge(...array_map('array_keys', $rows))));
        $table = array_map(fn (array $row): array => array_map(fn (string $key): string => $row[$key] ?? '', $keys), $rows);

        return UploadedFile::fake()->createWithContent('permit.csv', SpreadsheetWriter::csv($keys, $table));
    }

    private function rows(): array
    {
        return [['sku' => 'CEM-50', 'quantity' => '5', 'unit_cost' => '25.00']];
    }

    private function hdr(array $over = []): array
    {
        return $over + ['permit_type' => 'receipt', 'warehouse_id' => $this->main->id, 'permit_date' => '2026-03-10'];
    }

    private function upload(string $token, string $uri, array $body)
    {
        return $this->withToken($token)->post($uri, $body, ['Accept' => 'application/json']);
    }

    private function role(string $slug, array $permissions, string $email): string
    {
        app(TenantContext::class)->set($this->auth['tenant_id']);
        Role::create(['slug' => $slug, 'name' => $slug, 'permissions' => $permissions, 'is_system' => false]);

        return $this->tokenForRole($this->auth['tenant_id'], $slug, $email);
    }

    /** @return array{id: string, hash: string} */
    private function bind(string $token, array $rows, array $options): array
    {
        return $this->upload($token, '/api/stock-permits/import/preview', ['file' => $this->file($rows)] + $options)->assertOk()->json('data.binding');
    }

    private function createJob(string $token, array $rows, array $options, ?array $binding = null)
    {
        $binding ??= $this->bind($token, $rows, $options);

        return $this->upload($token, '/api/import-jobs', [
            'domain' => 'stock_permit_import', 'file' => $this->file($rows), 'options' => $options, 'preview_id' => $binding['id'], 'preview_hash' => $binding['hash'],
        ]);
    }

    private function disableInventory(): void
    {
        app(TenantContext::class)->set($this->auth['tenant_id']);
        TenantApplicationState::updateOrCreate(['application_key' => 'inventory.core'], ['requested_enabled' => false, 'status' => 'disabled']);
    }

    // ═══════════════════════════════ التسجيل والحدود ═══════════════════════════════

    /** @test */
    public function the_domain_is_a_bound_only_atomic_file_unit_with_the_direct_api_gates_and_no_ai_action(): void
    {
        $this->assertSame([AiActionRegistry::PRODUCT_IMPORT], app(AiActionRegistry::class)->types());
        $this->assertContains('stock_permit_import', ImportJobDomain::values());
        $this->assertContains('stock_permit_import', ImportJobDomain::PREVIEW_BOUND_ONLY);
        $this->assertSame('file', app(StockPermitImportAdapter::class)->unit());
        $this->assertSame(['view' => 'products.view', 'manage' => 'products.manage', 'app' => 'inventory.core'], ImportJobDomain::authorization('stock_permit_import'));
    }

    /** @test */
    public function there_is_no_synchronous_apply_route(): void
    {
        $this->upload($this->auth['token'], '/api/stock-permits/import/apply', ['file' => $this->file($this->rows())] + $this->hdr())->assertStatus(404);
        $this->assertSame(0, StockPermit::query()->count());
    }

    // ═══════════════════════════════ النقاط ═══════════════════════════════

    /** @test */
    public function fields_template_inspect_and_preview_serve_the_contract_and_write_nothing(): void
    {
        $keys = array_column($this->withToken($this->auth['token'])->getJson('/api/stock-permits/import/fields')->assertOk()->json('data.fields'), 'key');
        $this->assertSame(['product_id', 'sku', 'barcode', 'quantity', 'unit', 'unit_cost'], $keys);
        $this->assertStringContainsString('الكمية', $this->withToken($this->auth['token'])->get('/api/stock-permits/import/template')->assertOk()->streamedContent());

        $inspect = $this->upload($this->auth['token'], '/api/stock-permits/import/inspect', ['file' => $this->file($this->rows())] + $this->hdr())->assertOk()->json('data');
        $this->assertSame(['sku', 'quantity', 'unit_cost'], array_column($inspect['columns'], 'suggested_field'));

        $preview = $this->upload($this->auth['token'], '/api/stock-permits/import/preview', ['file' => $this->file($this->rows())] + $this->hdr())->assertOk()->json('data');
        $this->assertSame([1, 0, 12500], [$preview['line_rows'], $preview['error_rows'], $preview['total_cost']]);
        $this->assertSame('2026-03-10', $preview['permit_date']);
        $this->assertNotEmpty($preview['binding']['id']);
        $this->assertSame(0, StockPermit::query()->count());
    }

    /** @test */
    public function the_preview_freezes_the_default_date_and_rejects_an_invalid_header_with_a_validation_error(): void
    {
        $preview = $this->upload($this->auth['token'], '/api/stock-permits/import/preview', ['file' => $this->file($this->rows()), 'permit_type' => 'receipt', 'warehouse_id' => $this->main->id])->assertOk()->json('data');
        $this->assertSame(now()->toDateString(), $preview['permit_date']);

        $this->upload($this->auth['token'], '/api/stock-permits/import/preview', ['file' => $this->file($this->rows()), 'warehouse_id' => $this->main->id])->assertStatus(422)->assertJsonValidationErrors('permit_type');
        $this->upload($this->auth['token'], '/api/stock-permits/import/preview', ['file' => $this->file($this->rows())] + $this->hdr(['permit_type' => 'transfer']))->assertStatus(422);
        $this->upload($this->auth['token'], '/api/stock-permits/import/preview', ['file' => $this->file($this->rows())] + $this->hdr(['permit_date' => '10-03-2026']))->assertStatus(422)->assertJsonValidationErrors('permit_date');
    }

    // ═══════════════════════════════ المهام ═══════════════════════════════

    /** @test */
    public function a_bound_job_creates_one_draft_permit_and_posts_nothing(): void
    {
        $job = $this->createJob($this->auth['token'], $this->rows(), $this->hdr(['reason' => 'جرد أولي']))->assertCreated()->json('data');
        $this->assertTrue($job['preview_bound']);

        $applied = $this->withToken($this->auth['token'])->postJson("/api/import-jobs/{$job['id']}/apply", [])->assertOk()->json('data');
        $this->assertSame('completed', $applied['status']);

        $permit = StockPermit::query()->with('lines')->firstOrFail();
        $this->assertSame(['receipt', 'draft', 'جرد أولي', '2026-03-10'], [$permit->type, $permit->status, $permit->reason, $permit->permit_date->toDateString()]);
        $this->assertSame(1, $permit->lines->count());
        $this->assertSame(0, JournalEntry::query()->where('source_type', StockPermit::class)->count(), 'مسودة: لا قيد.');
        $this->assertSame(0, StockMovement::query()->where('source_type', StockPermit::class)->count());
        $this->assertSame($this->auth['user']['id'] ?? $permit->created_by, $permit->created_by);
        $this->assertSame($permit->id, ImportJob::query()->findOrFail($job['id'])->apply_result['permit_id']);
    }

    /** @test */
    public function an_unbound_job_and_options_that_differ_from_the_preview_are_refused(): void
    {
        $this->upload($this->auth['token'], '/api/import-jobs', ['domain' => 'stock_permit_import', 'file' => $this->file($this->rows()), 'options' => $this->hdr()])->assertStatus(422);

        $binding = $this->bind($this->auth['token'], $this->rows(), $this->hdr());
        $this->createJob($this->auth['token'], $this->rows(), $this->hdr(['permit_type' => 'issue']), $binding)->assertStatus(422);
        $this->assertSame(0, StockPermit::query()->count());
    }

    /** @test */
    public function apply_requests_that_change_any_frozen_header_field_are_refused_as_options_frozen(): void
    {
        foreach ([
            ['permit_type' => 'issue'],
            ['permit_date' => '2026-04-01'],
            ['reason' => 'سبب مختلف'],
            ['target_warehouse_id' => (string) \Illuminate\Support\Str::uuid()],
            ['warehouse_id' => (string) \Illuminate\Support\Str::uuid()],
        ] as $change) {
            $job = $this->createJob($this->auth['token'], $this->rows(), $this->hdr(['reason' => 'جرد أولي']))->assertCreated()->json('data');
            $res = $this->withToken($this->auth['token'])->postJson("/api/import-jobs/{$job['id']}/apply", $change);
            $this->assertSame(422, $res->status(), 'يجب رفض تغيير '.array_key_first($change));
            $this->assertSame('options_frozen', $res->json('code'), array_key_first($change));
        }
        $this->assertSame(0, StockPermit::query()->count());
    }

    /** @test */
    public function apply_requests_repeating_the_frozen_header_are_accepted(): void
    {
        $job = $this->createJob($this->auth['token'], $this->rows(), $this->hdr(['reason' => 'جرد أولي']))->assertCreated()->json('data');
        $this->withToken($this->auth['token'])->postJson("/api/import-jobs/{$job['id']}/apply", $this->hdr(['reason' => 'جرد أولي']))->assertOk();
        $this->assertSame(1, StockPermit::query()->count());
    }

    /** @test */
    public function a_failing_file_leaves_the_job_failed_and_writes_no_permit(): void
    {
        $rows = [['sku' => 'CEM-50', 'quantity' => '5', 'unit_cost' => '25.00'], ['sku' => 'CEM-50', 'quantity' => '5', 'unit_cost' => '25.00']];
        $binding = $this->bind($this->auth['token'], $rows, $this->hdr());
        // الملف المعاين نفسه صالح؛ نحوّله إلى فاشل بتعطيل المنتج قبل التنفيذ.
        Product::query()->where('sku', 'CEM-50')->update(['is_active' => false]);

        $job = $this->createJob($this->auth['token'], $rows, $this->hdr(), $binding)->assertCreated()->json('data');
        $this->withToken($this->auth['token'])->postJson("/api/import-jobs/{$job['id']}/apply", []);

        $failed = ImportJob::query()->findOrFail($job['id']);
        $this->assertSame('failed', (string) ($failed->status->value ?? $failed->status));
        $this->assertSame(0, (int) $failed->processed_rows);
        $this->assertSame(0, StockPermit::query()->count());
    }

    // ═══════════════════════════════ البوابات والعزل ═══════════════════════════════

    /** @test */
    public function the_direct_api_gates_apply_to_every_endpoint_and_the_job(): void
    {
        $viewer = $this->role('perm-viewer', ['products.view'], 'viewer@permits.test');
        $manager = $this->role('perm-manager', ['products.view', 'products.manage'], 'manager@permits.test');
        $body = ['file' => $this->file($this->rows())] + $this->hdr();

        foreach (['/api/stock-permits/import/preview', '/api/stock-permits/import/inspect'] as $uri) {
            $this->upload($viewer, $uri, $body)->assertForbidden();
            $this->upload($manager, $uri, $body)->assertOk();
        }
        $this->withToken($viewer)->getJson('/api/stock-permits/import/fields')->assertForbidden();

        $binding = $this->bind($manager, $this->rows(), $this->hdr());
        $this->upload($viewer, '/api/import-jobs', ['domain' => 'stock_permit_import', 'file' => $this->file($this->rows()), 'options' => $this->hdr(), 'preview_id' => $binding['id'], 'preview_hash' => $binding['hash']])->assertForbidden();
        $this->assertSame(0, StockPermit::query()->count());
    }

    /** @test */
    public function a_disabled_inventory_application_blocks_the_endpoints_and_the_job(): void
    {
        $binding = $this->bind($this->auth['token'], $this->rows(), $this->hdr());
        $this->disableInventory();

        $this->upload($this->auth['token'], '/api/stock-permits/import/preview', ['file' => $this->file($this->rows())] + $this->hdr())->assertForbidden();
        $this->upload($this->auth['token'], '/api/import-jobs', ['domain' => 'stock_permit_import', 'file' => $this->file($this->rows()), 'options' => $this->hdr(), 'preview_id' => $binding['id'], 'preview_hash' => $binding['hash']])->assertForbidden();
    }

    /** @test */
    public function a_binding_issued_to_another_tenant_or_user_is_never_accepted(): void
    {
        $binding = $this->bind($this->auth['token'], $this->rows(), $this->hdr());
        $other = $this->registerTenant('other-permit-co', 'owner@other-permit-co.test');

        $this->upload($other['token'], '/api/import-jobs', ['domain' => 'stock_permit_import', 'file' => $this->file($this->rows()), 'options' => $this->hdr(), 'preview_id' => $binding['id'], 'preview_hash' => $binding['hash']])->assertStatus(422);
        $this->assertSame(0, StockPermit::query()->count());
    }
}
