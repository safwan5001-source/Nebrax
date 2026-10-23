<?php

namespace Tests\Feature;

use App\Models\ImportPreview;
use App\Models\Partner;
use App\Models\Role;
use App\Support\SpreadsheetWriter;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * IMP-H3-S2 — نقاط استيراد الأطراف (قالب/حقول/فحص/معاينة) ومجال `partner_master` في المحرك الدائم.
 *
 * تشغيل: php artisan test --filter=PartnerImportApiTest
 */
class PartnerImportApiTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
    }

    /** @param list<array<string,string>> $rows */
    private function file(array $rows, string $name = 'partners.csv'): UploadedFile
    {
        $keys = array_values(array_unique(array_merge(...array_map('array_keys', $rows))));
        $table = array_map(fn (array $row): array => array_map(fn (string $key): string => $row[$key] ?? '', $keys), $rows);

        return UploadedFile::fake()->createWithContent($name, SpreadsheetWriter::csv($keys, $table));
    }

    private function customRole(string $tenantId, string $slug, array $permissions, string $email): string
    {
        app(TenantContext::class)->set($tenantId);
        Role::create(['slug' => $slug, 'name' => $slug, 'permissions' => $permissions, 'is_system' => false]);

        return $this->tokenForRole($tenantId, $slug, $email);
    }

    private function upload(string $token, string $uri, array $body)
    {
        return $this->withToken($token)->post($uri, $body, ['Accept' => 'application/json']);
    }

    // ═══════════════════════════════ القالب والحقول والفحص ═══════════════════════════════

    /** @test */
    public function the_template_and_fields_contract_are_served_without_type_or_opening_balance(): void
    {
        $auth = $this->registerTenant();

        $template = $this->withToken($auth['token'])->get('/api/partners/import/template?type=supplier')->assertOk();
        $this->assertStringContainsString('الاسم', $template->streamedContent());
        $this->assertStringNotContainsString('opening_balance', $template->streamedContent());
        $this->withToken($auth['token'])->getJson('/api/partners/import/template')->assertUnprocessable();
        $this->withToken($auth['token'])->getJson('/api/partners/import/template?type=both')->assertUnprocessable();

        $keys = array_column($this->withToken($auth['token'])->getJson('/api/partners/import/fields')->assertOk()->json('data.fields'), 'key');
        $this->assertContains('vat_number', $keys);
        foreach (['type', 'opening_balance', 'tenant_id'] as $forbidden) {
            $this->assertNotContains($forbidden, $keys);
        }
    }

    /** @test */
    public function inspect_reports_columns_samples_and_suggested_mapping_and_writes_nothing(): void
    {
        $auth = $this->registerTenant();
        $file = $this->file([['الكود' => 'C-1', 'الاسم' => 'شركة', 'عمود غريب' => 'x']]);

        $data = $this->upload($auth['token'], '/api/partners/import/inspect', ['file' => $file, 'type' => 'customer'])->assertOk()->json('data');

        $this->assertSame(['code', 'name', null], array_column($data['columns'], 'suggested_field'));
        $this->assertSame(1, $data['total_rows']);
        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertSame(0, Partner::count());
    }

    // ═══════════════════════════════ المعاينة ═══════════════════════════════

    /** @test */
    public function preview_classifies_rows_issues_a_binding_and_writes_nothing(): void
    {
        $auth = $this->registerTenant();
        $file = $this->file([['code' => 'P-1', 'name' => 'أ'], ['code' => 'P-2', 'name' => ''], ['name' => 'ب', 'email' => 'bad']]);

        $data = $this->upload($auth['token'], '/api/partners/import/preview', ['file' => $file, 'type' => 'supplier', 'duplicate_signal_policy' => 'error'])
            ->assertOk()->json('data');

        $this->assertSame([1, 1, 1], [$data['create_rows'], $data['error_rows'] - 1, 1]);
        $this->assertSame(['create', 'error', 'error'], array_column($data['rows'], 'action'));
        $row = ImportPreview::query()->whereKey($data['binding']['id'])->firstOrFail();
        $this->assertSame('partner_master', $row->domain);
        $this->assertSame(['supplier', 'create', 'error'], [$row->options['type'], $row->options['mode'], $row->options['duplicate_signal_policy']]);
        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertSame(0, Partner::count());
    }

    /** @test */
    public function there_is_no_synchronous_apply_for_partners(): void
    {
        $auth = $this->registerTenant();
        $file = $this->file([['name' => 'أ']]);

        $this->upload($auth['token'], '/api/partners/import/apply', ['file' => $file, 'type' => 'customer'])->assertStatus(404);   // لا مسار أصلاً (لا 200 ولا 201)
        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertSame(0, Partner::count());
    }

    // ═══════════════════════════════ الصلاحيات ═══════════════════════════════

    /** @test */
    public function only_partners_manage_can_use_the_import_endpoints_and_the_gate_is_independent_of_products(): void
    {
        $auth = $this->registerTenant();
        $tid = $auth['tenant_id'];
        $file = fn () => $this->file([['name' => 'أ']]);

        $viewer = $this->customRole($tid, 'partner_viewer', ['partners.view'], 'viewer@pi.test');
        $this->withToken($viewer)->getJson('/api/partners/import/fields')->assertForbidden();
        $this->upload($viewer, '/api/partners/import/preview', ['file' => $file(), 'type' => 'customer'])->assertForbidden();

        $productsOnly = $this->customRole($tid, 'products_only', ['products.view', 'products.manage'], 'po@pi.test');
        $this->upload($productsOnly, '/api/partners/import/preview', ['file' => $file(), 'type' => 'customer'])->assertForbidden();

        $manager = $this->customRole($tid, 'partner_manager', ['partners.view', 'partners.manage'], 'pm@pi.test');
        $this->upload($manager, '/api/partners/import/preview', ['file' => $file(), 'type' => 'customer'])->assertOk();

        $this->flushHeaders()->getJson('/api/partners/import/fields')->assertUnauthorized();
    }

    // ═══════════════════════════════ المحرك الدائم ═══════════════════════════════

    /** @test */
    public function a_bound_durable_job_imports_in_several_chunks_and_reports_the_result(): void
    {
        $auth = $this->registerTenant();
        $rows = array_map(fn (int $i): array => ['code' => sprintf('S-%03d', $i), 'name' => "مورد {$i}", 'mobile' => '05'.str_pad((string) $i, 8, '0', STR_PAD_LEFT)], range(1, 250));
        $options = ['type' => 'supplier', 'mode' => 'create'];

        $binding = $this->upload($auth['token'], '/api/partners/import/preview', ['file' => $this->file($rows), 'type' => 'supplier', 'mode' => 'create'])
            ->assertOk()->json('data.binding');
        $job = $this->upload($auth['token'], '/api/import-jobs', [
            'domain' => 'partner_master', 'file' => $this->file($rows), 'options' => $options,
            'preview_id' => $binding['id'], 'preview_hash' => $binding['hash'],
        ])->assertCreated()->json('data');
        $this->assertSame(250, $job['row_count']);

        $status = null;
        for ($i = 0; $i < 6 && $status !== 'completed'; $i++) {
            $status = $this->withToken($auth['token'])->postJson("/api/import-jobs/{$job['id']}/apply", [])->assertOk()->json('data.status');
        }

        $this->assertSame('completed', $status);
        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertSame(250, Partner::where('type', 'supplier')->count());
        $this->assertSame(0, Partner::where('type', '!=', 'supplier')->count());
    }

    /** @test */
    public function an_invalid_row_fails_the_chunk_with_a_named_unit_and_writes_nothing_from_that_window(): void
    {
        $auth = $this->registerTenant();
        $rows = [['code' => 'OK-1', 'name' => 'سليم'], ['code' => 'BAD', 'name' => 'سيئ', 'email' => 'not-an-email']];
        $job = $this->upload($auth['token'], '/api/import-jobs', ['domain' => 'partner_master', 'file' => $this->file($rows), 'options' => ['type' => 'customer']])
            ->assertCreated()->json('data');

        $this->withToken($auth['token'])->postJson("/api/import-jobs/{$job['id']}/apply", ['type' => 'customer'])->assertStatus(422);

        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertSame(0, Partner::count());
        $shown = $this->withToken($auth['token'])->getJson("/api/import-jobs/{$job['id']}")->assertOk()->json('data');
        $this->assertSame('failed', $shown['status']);
        // الوحدة السيئة المسمّاة + شقيقتها التي تراجعت معها نافذتها (`window_rolled_back`).
        $this->assertSame(2, $shown['failed_units']);
    }

    /** @test */
    public function the_job_gate_follows_partners_manage_and_a_partner_job_requires_its_type(): void
    {
        $auth = $this->registerTenant();
        $tid = $auth['tenant_id'];
        $rows = [['name' => 'أ']];

        $this->upload($auth['token'], '/api/import-jobs', ['domain' => 'partner_master', 'file' => $this->file($rows)])->assertUnprocessable();
        $this->upload($auth['token'], '/api/import-jobs', ['domain' => 'partner_master', 'file' => $this->file($rows), 'options' => ['type' => 'both']])->assertUnprocessable();

        $manager = $this->customRole($tid, 'partner_manager', ['partners.view', 'partners.manage'], 'pm@pi.test');
        $this->upload($manager, '/api/import-jobs', ['domain' => 'partner_master', 'file' => $this->file($rows), 'options' => ['type' => 'customer']])->assertCreated();
        // the same user cannot create a product job: the gates are per domain, not inherited from products
        $this->upload($manager, '/api/import-jobs', ['domain' => 'product_catalog', 'file' => $this->file($rows)])->assertForbidden();

        $viewer = $this->customRole($tid, 'partner_viewer', ['partners.view'], 'pv@pi.test');
        $this->upload($viewer, '/api/import-jobs', ['domain' => 'partner_master', 'file' => $this->file($rows), 'options' => ['type' => 'customer']])->assertForbidden();
    }
}
