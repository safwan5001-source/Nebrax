<?php

namespace Tests\Feature;

use App\Models\ImportDocumentReservation;
use App\Models\ImportJob;
use App\Models\ImportPreview;
use App\Models\JournalEntry;
use App\Models\Partner;
use App\Models\Product;
use App\Models\Purchase;
use App\Models\Role;
use App\Models\StockMovement;
use App\Models\TenantApplicationState;
use App\Models\User;
use App\Models\Warehouse;
use App\Services\AiActionRegistry;
use App\Services\PurchaseImportAdapter;
use App\Support\ImportJobDomain;
use App\Support\SpreadsheetWriter;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * IMP-H5-S4a — نقاط استيراد فواتير المشتريات مسوداتٍ (قالب/حقول/فحص/معاينة) ومجال `purchase_import` في المحرك الدائم: مربوط بمعاينة تحمل خطتها، وحدته الفاتورة (`row_count` يُعاد
 * عدّه بالخيارات المجمَّدة)، بوابات `POST /purchases` + صلاحية المستودع على الفاعل، منع التكرار، انجراف الخطة، وعدم أي ترحيل أو قيد أو حركة مخزون.
 *
 * تشغيل: php artisan test --filter=PurchaseImportEndpointsTest
 */
class PurchaseImportEndpointsTest extends TestCase
{
    use CapturesThrowable;
    use InteractsWithApi;
    use RefreshDatabase;

    private array $auth;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
        $this->auth = $this->registerTenant();
        app(TenantContext::class)->set($this->auth['tenant_id']);
        Partner::create(['name' => 'مورّد الإسمنت', 'type' => 'supplier', 'code' => 'S-001']);
        Product::create(['name' => 'إسمنت', 'sku' => 'CEM-50', 'type' => 'good', 'sale_price' => 5000, 'purchase_price' => 2500, 'track_inventory' => true]);
        Product::create(['name' => 'رمل', 'sku' => 'SAND-1', 'type' => 'good', 'sale_price' => 5000, 'purchase_price' => 2500, 'track_inventory' => true]);
    }

    /** @param list<array<string,string>> $rows */
    private function file(array $rows): UploadedFile
    {
        $keys = array_values(array_unique(array_merge(...array_map('array_keys', $rows))));
        $table = array_map(fn (array $row): array => array_map(fn (string $key): string => $row[$key] ?? '', $keys), $rows);

        return UploadedFile::fake()->createWithContent('purchases.csv', SpreadsheetWriter::csv($keys, $table));
    }

    private function row(array $over = []): array
    {
        return $over + ['supplier_code' => 'S-001', 'supplier_invoice_ref' => 'INV-1', 'purchase_date' => '2026-10-01', 'sku' => 'CEM-50', 'quantity' => '10', 'unit_price' => '25.00', 'tax_rate' => '15'];
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
    private function bind(string $token, array $rows, array $options = []): array
    {
        return $this->upload($token, '/api/purchases/import/preview', ['file' => $this->file($rows)] + $options)->assertOk()->json('data.binding');
    }

    private function createJob(string $token, array $rows, array $options = [], ?array $binding = null)
    {
        $binding ??= $this->bind($token, $rows, $options);

        return $this->upload($token, '/api/import-jobs', [
            'domain' => 'purchase_import', 'file' => $this->file($rows), 'options' => $options, 'preview_id' => $binding['id'], 'preview_hash' => $binding['hash'],
        ]);
    }

    private function runJob(string $token, string $id, array $body = []): string
    {
        $status = null;
        for ($i = 0; $i < 15 && ! in_array($status, ['completed', 'failed'], true); $i++) {
            $status = $this->withToken($token)->postJson("/api/import-jobs/{$id}/apply", $i === 0 ? $body : [])->json('data.status')
                ?? $this->withToken($token)->getJson("/api/import-jobs/{$id}")->json('data.status');
        }

        return (string) $status;
    }

    private function disableCycle(): void
    {
        app(TenantContext::class)->set($this->auth['tenant_id']);
        TenantApplicationState::updateOrCreate(['application_key' => 'purchases.cycle'], ['requested_enabled' => false, 'status' => 'disabled']);
    }

    // ═══════════════════════════════ التسجيل والحدود ═══════════════════════════════

    /** @test */
    public function the_domain_is_a_bound_only_document_unit_and_no_purchase_ai_action_exists_yet(): void
    {
        $this->assertSame([AiActionRegistry::PRODUCT_IMPORT], app(AiActionRegistry::class)->types());
        $this->assertContains('purchase_import', ImportJobDomain::values());
        $this->assertContains('purchase_import', ImportJobDomain::PREVIEW_BOUND_ONLY);
        $this->assertSame('document', app(PurchaseImportAdapter::class)->unit());
    }

    /** @test */
    public function there_is_no_synchronous_apply_route(): void
    {
        $this->upload($this->auth['token'], '/api/purchases/import/apply', ['file' => $this->file([$this->row()])])->assertStatus(404);
        $this->assertSame(0, Purchase::query()->count());
    }

    // ═══════════════════════════════ النقاط ═══════════════════════════════

    /** @test */
    public function fields_template_inspect_and_preview_serve_the_contract_and_write_nothing(): void
    {
        $keys = array_column($this->withToken($this->auth['token'])->getJson('/api/purchases/import/fields')->assertOk()->json('data.fields'), 'key');
        $this->assertContains('supplier_invoice_ref', $keys);
        $this->assertNotContains('total', $keys);
        $this->assertStringContainsString('رقم فاتورة المورّد', $this->withToken($this->auth['token'])->get('/api/purchases/import/template')->assertOk()->streamedContent());

        $rows = [$this->row(), $this->row(['sku' => 'SAND-1', 'purchase_date' => '']), $this->row(['supplier_invoice_ref' => 'INV-2'])];
        $inspect = $this->upload($this->auth['token'], '/api/purchases/import/inspect', ['file' => $this->file($rows)])->assertOk()->json('data');
        $this->assertSame(['supplier_code', 'supplier_invoice_ref', 'purchase_date', 'sku', 'quantity', 'unit_price', 'tax_rate'], array_column($inspect['columns'], 'suggested_field'));

        $preview = $this->upload($this->auth['token'], '/api/purchases/import/preview', ['file' => $this->file($rows), 'default_tax_rate' => 5, 'tax_inclusive' => false])->assertOk()->json('data');
        $this->assertSame([3, 2, 2, 0], [$preview['total_rows'], $preview['total_units'], $preview['create_units'], $preview['error_units']]);
        $binding = ImportPreview::query()->whereKey($preview['binding']['id'])->firstOrFail();
        $this->assertSame('purchase_import', $binding->domain);
        $this->assertSame([5, false], [$binding->options['default_tax_rate'], $binding->options['tax_inclusive']]);
        $this->assertNotNull($binding->plan, 'المعاينة تحمل خطّة الفواتير لكشف الانجراف.');

        $this->assertSame([0, 0], [Purchase::query()->count(), ImportDocumentReservation::query()->count()]);
    }

    // ═══════════════════════════════ المهام ═══════════════════════════════

    /** @test */
    public function a_bound_job_counts_invoices_not_rows_creates_drafts_and_posts_nothing(): void
    {
        $rows = [
            $this->row(['supplier_invoice_ref' => 'A']),
            $this->row(['supplier_invoice_ref' => 'A', 'sku' => 'SAND-1', 'purchase_date' => '']),
            $this->row(['supplier_invoice_ref' => 'B']),
            $this->row(['supplier_invoice_ref' => 'A', 'sku' => 'SAND-1', 'quantity' => '3', 'purchase_date' => '']),   // A تمتد عبر حدّ الصفوف
            $this->row(['supplier_invoice_ref' => 'C']),
        ];
        $job = $this->createJob($this->auth['token'], $rows)->assertCreated()->json('data');
        $this->assertSame(5, $job['row_count'], 'تقدير وقت الفحص = صفوف البيانات');

        $status = $this->runJob($this->auth['token'], $job['id'], ['batch_size' => 1]);
        $this->assertSame('completed', $status);

        $done = ImportJob::query()->findOrFail($job['id']);
        $this->assertSame([3, 3], [(int) $done->row_count, (int) $done->processed_rows], 'وحدات: 3 فواتير');
        $this->assertSame(3, Purchase::query()->where('status', 'draft')->count());
        $this->assertCount(3, Purchase::query()->where('supplier_invoice_no', 'A')->firstOrFail()->lines);
        $this->assertSame(3, ImportDocumentReservation::query()->count());
        $this->assertSame(0, JournalEntry::query()->count(), 'مسودات فقط: لا قيد.');
        $this->assertSame(0, StockMovement::query()->count());
        $this->assertSame(User::query()->firstOrFail()->id, Purchase::query()->firstOrFail()->created_by);
    }

    /** @test */
    public function the_unit_recount_uses_the_frozen_mapping_and_default_supplier(): void
    {
        // العمود «مورّد» لا يُطابَق تلقائياً بالاسم المخصص، فتُمرَّر المطابقة صراحةً؛ والمورّد الافتراضي يخدم الصفوف الفارغة.
        $rows = [
            ['ذاك' => 'R-1', 'D' => '2026-10-01', 'S' => 'CEM-50', 'Q' => '2', 'P' => '10.00'],
            ['ذاك' => 'R-1', 'D' => '', 'S' => 'SAND-1', 'Q' => '1', 'P' => '5.00'],
            ['ذاك' => 'R-2', 'D' => '2026-10-02', 'S' => 'CEM-50', 'Q' => '1', 'P' => '7.00'],
        ];
        $supplier = Partner::query()->where('code', 'S-001')->firstOrFail();
        $options = ['default_supplier_id' => $supplier->id, 'mapping' => [0 => 'supplier_invoice_ref', 1 => 'purchase_date', 2 => 'sku', 3 => 'quantity', 4 => 'unit_price']];

        $job = $this->createJob($this->auth['token'], $rows, $options)->assertCreated()->json('data');
        $this->assertSame('completed', $this->runJob($this->auth['token'], $job['id']));

        $this->assertSame(2, ImportJob::query()->findOrFail($job['id'])->row_count);
        $this->assertSame(2, Purchase::query()->count());
        $this->assertSame($supplier->id, Purchase::query()->firstOrFail()->partner_id);
    }

    /** @test */
    public function the_job_requires_a_preview_and_rejects_options_that_differ_from_it(): void
    {
        $rows = [$this->row()];
        $this->upload($this->auth['token'], '/api/import-jobs', ['domain' => 'purchase_import', 'file' => $this->file($rows)])->assertUnprocessable();

        $binding = $this->bind($this->auth['token'], $rows);
        $this->upload($this->auth['token'], '/api/import-jobs', [
            'domain' => 'purchase_import', 'file' => $this->file($rows), 'options' => ['default_tax_rate' => 5], 'preview_id' => $binding['id'], 'preview_hash' => $binding['hash'],
        ])->assertUnprocessable();
    }

    /** @test */
    public function apply_cannot_change_the_frozen_policies_and_equal_values_in_other_forms_are_not_a_change(): void
    {
        $options = ['default_tax_rate' => 5, 'tax_inclusive' => false, 'default_payment_type' => 'credit'];
        $job = $this->createJob($this->auth['token'], [$this->row()], $options)->assertCreated()->json('data');

        foreach ([['default_tax_rate' => 0], ['tax_inclusive' => true], ['default_payment_type' => 'cash'], ['warehouse_id' => (string) \Illuminate\Support\Str::uuid()]] as $changed) {
            $this->withToken($this->auth['token'])->postJson("/api/import-jobs/{$job['id']}/apply", $changed)->assertStatus(422)->assertJsonPath('code', 'options_frozen');
        }
        // المنطقي false بصيغ مختلفة ليس تغييراً
        $this->withToken($this->auth['token'])->postJson("/api/import-jobs/{$job['id']}/apply", ['default_tax_rate' => '5', 'tax_inclusive' => false, 'default_payment_type' => 'credit'])->assertOk();
    }

    /** @test */
    public function a_duplicate_created_after_the_preview_is_plan_drift_and_nothing_is_written(): void
    {
        $job = $this->createJob($this->auth['token'], [$this->row()])->assertCreated()->json('data');

        // تظهر فاتورة المورّد نفسها بين المعاينة والتنفيذ
        $supplier = Partner::query()->where('code', 'S-001')->firstOrFail();
        $this->withToken($this->auth['token'])->postJson('/api/purchases', [
            'partner_id' => $supplier->id, 'supplier_invoice_no' => 'INV-1', 'payment_type' => 'credit',
            'items' => [['product_id' => Product::query()->where('sku', 'CEM-50')->firstOrFail()->id, 'quantity' => 1, 'unit_price' => 100, 'tax_rate' => 0]],
        ])->assertCreated();

        $this->assertSame('failed', $this->runJob($this->auth['token'], $job['id']));
        $this->assertSame(1, Purchase::query()->count(), 'الفاتورة اليدوية وحدها.');
        $this->assertStringContainsString('plan_drift', (string) ImportJob::query()->findOrFail($job['id'])->error_message);
    }

    /** @test */
    public function an_invalid_invoice_fails_the_job_with_a_message_naming_it_and_writes_nothing(): void
    {
        $rows = [$this->row(['supplier_invoice_ref' => 'OK-1']), $this->row(['supplier_invoice_ref' => 'BAD-1', 'sku' => 'NOPE'])];
        $preview = $this->upload($this->auth['token'], '/api/purchases/import/preview', ['file' => $this->file($rows)])->assertOk()->json('data');
        $this->assertSame(1, $preview['error_units']);

        $job = $this->createJob($this->auth['token'], $rows)->assertCreated()->json('data');
        $this->assertSame('failed', $this->runJob($this->auth['token'], $job['id']));

        $message = (string) ImportJob::query()->findOrFail($job['id'])->error_message;
        $this->assertStringContainsString('BAD-1', $message);
        $this->assertSame(0, Purchase::query()->count());
        $this->assertSame(0, ImportDocumentReservation::query()->count());
    }

    /** @test */
    public function multiple_chunks_with_a_frozen_mapping_and_default_supplier_complete_exactly_at_the_invoice_count(): void
    {
        $supplier = Partner::query()->where('code', 'S-001')->firstOrFail();
        $rows = [];
        foreach (['M-1', 'M-2', 'M-3', 'M-4'] as $ref) {
            $rows[] = ['ref' => $ref, 'date' => '2026-10-01', 'item' => 'CEM-50', 'qty' => '2', 'price' => '10.00'];
            $rows[] = ['ref' => $ref, 'date' => '', 'item' => 'SAND-1', 'qty' => '1', 'price' => '5.00'];
        }
        $options = ['default_supplier_id' => $supplier->id, 'mapping' => [0 => 'supplier_invoice_ref', 1 => 'purchase_date', 2 => 'sku', 3 => 'quantity', 4 => 'unit_price']];
        $job = $this->createJob($this->auth['token'], $rows, $options)->assertCreated()->json('data');
        $this->assertSame(8, $job['row_count']);

        $this->assertSame('completed', $this->runJob($this->auth['token'], $job['id'], ['batch_size' => 3]));

        $done = ImportJob::query()->findOrFail($job['id']);
        $this->assertSame([4, 4], [(int) $done->row_count, (int) $done->processed_rows]);
        $this->assertSame(4, Purchase::query()->count());
        $this->assertSame([2], Purchase::query()->withCount('lines')->pluck('lines_count')->unique()->values()->all());
    }

    /** @test */
    public function a_recount_failure_fails_the_job_cleanly_instead_of_stranding_it_ready(): void
    {
        $supplier = Partner::query()->where('code', 'S-001')->firstOrFail();
        $rows = [$this->row(['supplier_code' => ''])];
        $rows = array_map(fn ($r) => array_diff_key($r, ['supplier_code' => 1]), $rows);
        $job = $this->createJob($this->auth['token'], $rows, ['default_supplier_id' => $supplier->id])->assertCreated()->json('data');

        // المورّد الافتراضي يُعطَّل بعد المعاينة وقبل أول ترحيل
        $supplier->forceFill(['is_active' => false])->save();

        $this->assertSame('failed', $this->runJob($this->auth['token'], $job['id']));
        $this->assertSame(0, Purchase::query()->count());
        $this->assertStringContainsString('المورّد الافتراضي', (string) ImportJob::query()->findOrFail($job['id'])->error_message);
    }

    /** @test */
    public function tenant_preferences_are_frozen_with_the_preview_so_a_later_settings_change_cannot_change_a_runs_totals(): void
    {
        \App\Support\Settings::put('purchases', ['default_tax_rate' => 15, 'default_tax_inclusive' => false, 'default_payment_type' => 'credit']);
        $rows = [$this->row(['tax_rate' => '', 'supplier_invoice_ref' => 'F-1', 'quantity' => '10', 'unit_price' => '10.00'])];
        $job = $this->createJob($this->auth['token'], $rows)->assertCreated()->json('data');

        // يتبدّل التفضيل بعد إنشاء التشغيلة وقبل الترحيل
        \App\Support\Settings::put('purchases', ['default_tax_rate' => 0, 'default_tax_inclusive' => true, 'default_payment_type' => 'cash']);

        $this->assertSame('completed', $this->runJob($this->auth['token'], $job['id']));
        $p = Purchase::query()->firstOrFail();
        $this->assertSame([10000, 1500, 11500, 'credit'], [(int) $p->subtotal, (int) $p->tax_amount, (int) $p->total, $p->payment_type], 'قيم المعاينة (15% غير شاملة، آجل) لا التفضيل الجديد');
    }

    /** @test */
    public function a_preference_change_between_preview_and_job_creation_is_a_preview_mismatch_not_a_silent_drift(): void
    {
        \App\Support\Settings::put('purchases', ['default_tax_rate' => 15]);
        $rows = [$this->row(['tax_rate' => ''])];
        $binding = $this->bind($this->auth['token'], $rows);

        \App\Support\Settings::put('purchases', ['default_tax_rate' => 5]);

        $this->upload($this->auth['token'], '/api/import-jobs', [
            'domain' => 'purchase_import', 'file' => $this->file($rows), 'preview_id' => $binding['id'], 'preview_hash' => $binding['hash'],
        ])->assertUnprocessable();
    }

    /** @test */
    public function a_unit_count_that_changes_mid_run_fails_the_chunk_closed_and_never_completes_silently(): void
    {
        $rows = [];
        foreach (['G-1', 'G-2', 'G-3'] as $ref) {
            $rows[] = $this->row(['supplier_invoice_ref' => $ref]);
        }
        $job = $this->createJob($this->auth['token'], $rows)->assertCreated()->json('data');

        $this->withToken($this->auth['token'])->postJson("/api/import-jobs/{$job['id']}/apply", ['batch_size' => 1])->assertOk();
        $this->assertSame(1, Purchase::query()->count());
        // العدد المجمَّد يخالف ما تشتقه القطعة التالية (تعديل متزامن لمراجع الملف) ⇒ فشل مغلق بلا فواتير إضافية
        ImportJob::query()->whereKey($job['id'])->update(['row_count' => 2]);

        $this->assertSame('failed', $this->runJob($this->auth['token'], $job['id']));
        $this->assertSame(1, Purchase::query()->count(), 'القطعة الفاشلة تراجعت كلها');
        $this->assertStringContainsString('تغيّر عدد الفواتير', (string) ImportJob::query()->findOrFail($job['id'])->error_message);
    }

    /** @test */
    public function the_preview_echoes_the_resolved_company_defaults_that_will_be_frozen(): void
    {
        \App\Support\Settings::put('purchases', ['default_tax_rate' => 5, 'default_tax_inclusive' => true, 'default_payment_type' => 'cash']);

        $blank = $this->upload($this->auth['token'], '/api/purchases/import/preview', ['file' => $this->file([$this->row(['tax_rate' => ''])])])->assertOk()->json('data');
        $this->assertSame([5, true, 'cash'], [$blank['default_tax_rate'], $blank['tax_inclusive'], $blank['default_payment_type']]);

        $explicit = $this->upload($this->auth['token'], '/api/purchases/import/preview', ['file' => $this->file([$this->row()]), 'default_tax_rate' => 0, 'tax_inclusive' => false, 'default_payment_type' => 'credit'])->assertOk()->json('data');
        $this->assertSame([0, false, 'credit'], [$explicit['default_tax_rate'], $explicit['tax_inclusive'], $explicit['default_payment_type']]);
    }

    /** @test */
    public function a_null_tax_rate_means_the_company_default_and_round_trips_from_preview_to_job_to_apply(): void
    {
        \App\Support\Settings::put('purchases', ['default_tax_rate' => 5]);
        $rows = [$this->row(['tax_rate' => '', 'supplier_invoice_ref' => 'N-1', 'quantity' => '10', 'unit_price' => '10.00'])];

        $preview = $this->upload($this->auth['token'], '/api/purchases/import/preview', ['file' => $this->file($rows), 'default_tax_rate' => ''])->assertOk()->json('data');
        $binding = $preview['binding'];
        $job = $this->upload($this->auth['token'], '/api/import-jobs', [
            'domain' => 'purchase_import', 'file' => $this->file($rows), 'options' => ['default_tax_rate' => ''], 'preview_id' => $binding['id'], 'preview_hash' => $binding['hash'],
        ])->assertCreated()->json('data');

        // null صريحة في الطلب ليست تغييراً لما جُمِّد (5٪ من تفضيل المؤسسة)
        $this->withToken($this->auth['token'])->postJson("/api/import-jobs/{$job['id']}/apply", ['default_tax_rate' => null])->assertOk();
        $this->assertSame([10000, 500], [(int) Purchase::query()->firstOrFail()->subtotal, (int) Purchase::query()->firstOrFail()->tax_amount]);
    }

    // ═══════════════════════════════ البوابات والعزل ═══════════════════════════════

    /** @test */
    public function gates_follow_the_direct_purchase_route_and_a_viewer_cannot_preview_or_create(): void
    {
        $rows = [$this->row()];

        $viewer = $this->role('pur_viewer', ['purchases.view'], 'v@pi.test');
        $this->withToken($viewer)->getJson('/api/purchases/import/fields')->assertForbidden();
        $this->upload($viewer, '/api/purchases/import/preview', ['file' => $this->file($rows)])->assertForbidden();
        $this->upload($viewer, '/api/import-jobs', ['domain' => 'purchase_import', 'file' => $this->file($rows)])->assertForbidden();

        $manager = $this->role('pur_manager', ['purchases.view', 'purchases.manage'], 'm@pi.test');
        $b = $this->bind($manager, $rows);
        $this->upload($manager, '/api/import-jobs', ['domain' => 'purchase_import', 'file' => $this->file($rows), 'preview_id' => $b['id'], 'preview_hash' => $b['hash']])->assertCreated();
    }

    /** @test */
    public function a_disabled_purchases_cycle_refuses_the_endpoints_and_job_creation_and_apply(): void
    {
        $rows = [$this->row()];
        $job = $this->createJob($this->auth['token'], $rows)->assertCreated()->json('data');

        $this->disableCycle();

        $this->withToken($this->auth['token'])->getJson('/api/purchases/import/fields')->assertForbidden();
        $this->upload($this->auth['token'], '/api/purchases/import/preview', ['file' => $this->file($rows)])->assertForbidden();
        $this->upload($this->auth['token'], '/api/import-jobs', ['domain' => 'purchase_import', 'file' => $this->file($rows)])->assertForbidden();
        $this->withToken($this->auth['token'])->postJson("/api/import-jobs/{$job['id']}/apply", [])->assertForbidden();
        app(TenantContext::class)->set($this->auth['tenant_id']);
        $this->assertSame(0, Purchase::query()->count());
    }

    /** @test */
    public function the_warehouse_option_requires_the_actors_own_warehouse_access_at_preview_and_at_every_chunk(): void
    {
        app(TenantContext::class)->set($this->auth['tenant_id']);
        $mine = Warehouse::query()->where('is_active', true)->firstOrFail();
        $other = Warehouse::create(['code' => 'W-OTHER', 'name' => 'مستودع آخر', 'is_active' => true]);

        $token = $this->role('pur_scoped', ['purchases.view', 'purchases.manage'], 's@pi.test');
        $user = User::query()->where('email', 's@pi.test')->firstOrFail();
        $user->warehouses()->sync([$mine->id]);
        $rows = [$this->row()];

        // مستودع خارج نطاقه: مرفوض عند المعاينة
        $this->upload($token, '/api/purchases/import/preview', ['file' => $this->file($rows), 'warehouse_id' => $other->id])->assertUnprocessable();
        // مستودعه: يمرّ ويُكتب على المسودة
        $job = $this->createJob($token, $rows, ['warehouse_id' => $mine->id])->assertCreated()->json('data');
        // ثم يُسحب نطاقه قبل التنفيذ ⇒ القطعة ترفض (الفحص في كل قطعة لا عند المعاينة وحدها)
        $user->warehouses()->sync([$other->id]);
        $this->assertSame('failed', $this->runJob($token, $job['id']));
        $this->assertStringContainsString('خارج نطاق صلاحياتك', (string) ImportJob::query()->findOrFail($job['id'])->error_message);
        app(TenantContext::class)->set($this->auth['tenant_id']);
        $this->assertSame(0, Purchase::query()->count());

        $user->warehouses()->sync([$mine->id]);
        $job2 = $this->createJob($token, $rows, ['warehouse_id' => $mine->id])->assertCreated()->json('data');
        $this->assertSame('completed', $this->runJob($token, $job2['id']));
        app(TenantContext::class)->set($this->auth['tenant_id']);
        $this->assertSame($mine->id, Purchase::query()->firstOrFail()->warehouse_id);
    }

    /** @test */
    public function another_tenants_supplier_code_never_resolves_through_the_endpoint(): void
    {
        $other = $this->registerTenant('other', 'o@other.test');
        app(TenantContext::class)->set($other['tenant_id']);
        Partner::create(['name' => 'مورّد غيري', 'type' => 'supplier', 'code' => 'S-777']);
        app(TenantContext::class)->set($this->auth['tenant_id']);

        $preview = $this->upload($this->auth['token'], '/api/purchases/import/preview', ['file' => $this->file([$this->row(['supplier_code' => 'S-777'])])])->assertOk()->json('data');

        $this->assertSame(1, $preview['error_units']);
    }

    /** @test */
    public function the_adapter_canonicalises_equivalent_forms_and_keeps_invalid_values_for_the_service_to_refuse(): void
    {
        $adapter = app(PurchaseImportAdapter::class);
        $this->assertSame(
            $adapter->canonicalOptions(['default_tax_rate' => 5.0, 'tax_inclusive' => '0', 'default_supplier_id' => 'ABC']),
            $adapter->canonicalOptions(['default_tax_rate' => '5', 'tax_inclusive' => false, 'default_supplier_id' => 'abc']),
        );
        $bad = $adapter->canonicalOptions(['default_payment_type' => ['x'], 'tax_inclusive' => 'maybe']);
        $this->thrown(fn () => app(\App\Services\PurchaseImportService::class)->options($bad), 'array option', \RuntimeException::class);
    }
}
