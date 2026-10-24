<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Expense;
use App\Models\ImportDocumentReservation;
use App\Models\ImportJobUnit;
use App\Models\ImportPreview;
use App\Models\JournalEntry;
use App\Models\Role;
use App\Models\TenantApplicationState;
use App\Models\User;
use App\Services\AiActionRegistry;
use App\Services\ExpenseImportAdapter;
use App\Support\SpreadsheetWriter;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * IMP-H5-S2 — نقاط استيراد المصروفات مسوداتٍ (قالب/حقول/فحص/معاينة) ومجال `expense_import` في المحرك الدائم: مربوط بمعاينة تحمل خطتها، بوابات `POST /expenses`،
 * منع التكرار (داخل الملف/القائم/المؤكَّد)، انجراف الخطة، عدم أي ترحيل أو قيد، ولا تطبيق متزامن ولا مسار ذكاء اصطناعي (H5-S5 لاحقاً).
 *
 * تشغيل: php artisan test --filter=H5ImportEndpointsTest
 */
class H5ImportEndpointsTest extends TestCase
{
    use CapturesThrowable;
    use InteractsWithApi;
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
    }

    /** @param list<array<string,string>> $rows */
    private function file(array $rows): UploadedFile
    {
        $keys = array_values(array_unique(array_merge(...array_map('array_keys', $rows))));
        $table = array_map(fn (array $row): array => array_map(fn (string $key): string => $row[$key] ?? '', $keys), $rows);

        return UploadedFile::fake()->createWithContent('expenses.csv', SpreadsheetWriter::csv($keys, $table));
    }

    private function row(array $over = []): array
    {
        return $over + ['expense_date' => '2026-10-01', 'amount' => '1000.00', 'account_code' => '5130', 'vendor_name' => 'شركة الأمل'];
    }

    private function upload(string $token, string $uri, array $body)
    {
        return $this->withToken($token)->post($uri, $body, ['Accept' => 'application/json']);
    }

    private function role(string $tenantId, string $slug, array $permissions, string $email): string
    {
        app(TenantContext::class)->set($tenantId);
        Role::create(['slug' => $slug, 'name' => $slug, 'permissions' => $permissions, 'is_system' => false]);

        return $this->tokenForRole($tenantId, $slug, $email);
    }

    /** @return array{id: string, hash: string} */
    private function bind(string $token, array $rows, array $options = []): array
    {
        return $this->upload($token, '/api/expenses/import/preview', ['file' => $this->file($rows)] + $options)->assertOk()->json('data.binding');
    }

    private function createJob(string $token, array $rows, array $options = [], ?array $binding = null)
    {
        $binding ??= $this->bind($token, $rows, $options);

        return $this->upload($token, '/api/import-jobs', [
            'domain' => 'expense_import', 'file' => $this->file($rows), 'options' => $options, 'preview_id' => $binding['id'], 'preview_hash' => $binding['hash'],
        ]);
    }

    private function runJob(string $token, string $id): string
    {
        $status = null;
        for ($i = 0; $i < 12 && ! in_array($status, ['completed', 'failed'], true); $i++) {
            // التشغيلة الفاشلة تردّ 422 بلا جسم حالة: الحالة تُقرأ من عرض التشغيلة.
            $status = $this->withToken($token)->postJson("/api/import-jobs/{$id}/apply", [])->json('data.status')
                ?? $this->withToken($token)->getJson("/api/import-jobs/{$id}")->json('data.status');
        }

        return (string) $status;
    }

    private function disableFinance(string $tenantId): void
    {
        app(TenantContext::class)->set($tenantId);
        TenantApplicationState::updateOrCreate(['application_key' => 'finance.operations'], ['requested_enabled' => false, 'status' => 'disabled']);
    }

    // ═══════════════════════════════ التسجيل والحدود ═══════════════════════════════

    /** @test */
    public function the_domain_is_bound_only_and_no_expense_ai_action_exists_yet(): void
    {
        $this->assertSame([AiActionRegistry::PRODUCT_IMPORT], app(AiActionRegistry::class)->types());
        $this->assertContains('expense_import', \App\Support\ImportJobDomain::values());
        $this->assertContains('expense_import', \App\Support\ImportJobDomain::PREVIEW_BOUND_ONLY);
    }

    /** @test */
    public function there_is_no_synchronous_apply_route(): void
    {
        $auth = $this->registerTenant();

        $this->upload($auth['token'], '/api/expenses/import/apply', ['file' => $this->file([$this->row()])])->assertStatus(404);
        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertSame(0, Expense::query()->count());
    }

    // ═══════════════════════════════ النقاط ═══════════════════════════════

    /** @test */
    public function fields_template_inspect_and_preview_serve_the_contract_and_write_nothing(): void
    {
        $auth = $this->registerTenant();

        $keys = array_column($this->withToken($auth['token'])->getJson('/api/expenses/import/fields')->assertOk()->json('data.fields'), 'key');
        $this->assertContains('expense_date', $keys);
        $this->assertNotContains('total', $keys);
        $this->assertStringContainsString('كود حساب المصروف', $this->withToken($auth['token'])->get('/api/expenses/import/template')->assertOk()->streamedContent());

        $rows = [$this->row(), $this->row(['vendor_name' => 'مطعم', 'amount' => '85.50'])];
        $inspect = $this->upload($auth['token'], '/api/expenses/import/inspect', ['file' => $this->file($rows)])->assertOk()->json('data');
        $this->assertSame(['expense_date', 'amount', 'account_code', 'vendor_name'], array_column($inspect['columns'], 'suggested_field'));

        $preview = $this->upload($auth['token'], '/api/expenses/import/preview', ['file' => $this->file($rows), 'default_tax_rate' => 5, 'reference_policy' => 'optional'])->assertOk()->json('data');
        $this->assertSame([2, 0, 108550], [$preview['create_rows'], $preview['error_rows'], $preview['create_amount_minor']]);
        $binding = ImportPreview::query()->whereKey($preview['binding']['id'])->firstOrFail();
        $this->assertSame('expense_import', $binding->domain);
        $this->assertSame([5, 'optional'], [$binding->options['default_tax_rate'], $binding->options['reference_policy']]);
        $this->assertNotNull($binding->plan, 'المعاينة تحمل خطّة الصفوف لكشف الانجراف.');

        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertSame([0, 0], [Expense::query()->count(), ImportDocumentReservation::query()->count()]);
    }

    // ═══════════════════════════════ المهام ═══════════════════════════════

    /** @test */
    public function a_bound_job_creates_drafts_reserves_identities_and_posts_nothing(): void
    {
        $auth = $this->registerTenant();
        $rows = [$this->row(['reference' => 'INV-1', 'tax_rate' => '15']), $this->row(['vendor_name' => 'مطعم', 'amount' => '85.50', 'payment_method' => 'bank'])];

        $job = $this->createJob($auth['token'], $rows)->assertCreated()->json('data');
        $this->assertSame(2, $job['row_count']);
        $this->assertSame('completed', $this->runJob($auth['token'], $job['id']));

        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertSame([2, 2], [Expense::query()->where('status', 'draft')->count(), ImportDocumentReservation::query()->count()]);
        $this->assertSame(0, JournalEntry::query()->count(), 'مسودات فقط: لا قيد.');
        $first = Expense::query()->where('amount', 100000)->firstOrFail();
        $this->assertSame([15000, 115000], [(int) $first->tax_amount, (int) $first->total]);
        $this->assertSame(User::query()->firstOrFail()->id, $first->created_by);
    }

    /** @test */
    public function the_job_requires_a_preview_and_rejects_options_that_differ_from_it(): void
    {
        $auth = $this->registerTenant();
        $rows = [$this->row()];

        $this->upload($auth['token'], '/api/import-jobs', ['domain' => 'expense_import', 'file' => $this->file($rows)])->assertUnprocessable();

        $binding = $this->bind($auth['token'], $rows);
        $this->upload($auth['token'], '/api/import-jobs', [
            'domain' => 'expense_import', 'file' => $this->file($rows), 'options' => ['reference_policy' => 'required'], 'preview_id' => $binding['id'], 'preview_hash' => $binding['hash'],
        ])->assertUnprocessable();
    }

    /** @test */
    public function apply_cannot_change_the_frozen_policies_or_add_confirmed_repeats(): void
    {
        $auth = $this->registerTenant();
        $rows = [$this->row()];
        $job = $this->createJob($auth['token'], $rows)->assertCreated()->json('data');

        foreach ([['default_tax_rate' => 0], ['reference_policy' => 'required'], ['default_payment_method' => 'bank'], ['confirmed_repeat_rows' => [2]]] as $changed) {
            $this->withToken($auth['token'])->postJson("/api/import-jobs/{$job['id']}/apply", $changed)->assertStatus(422)->assertJsonPath('code', 'options_frozen');
        }
        $this->assertSame('completed', $this->runJob($auth['token'], $job['id']));
    }

    /** @test */
    public function explicit_options_equal_to_the_frozen_ones_are_not_a_change_but_an_edited_repeat_row_is(): void
    {
        $auth = $this->registerTenant();
        $rows = [$this->row(), $this->row()];
        $options = ['default_tax_rate' => 5, 'confirmed_repeat_rows' => [3]];
        $job = $this->createJob($auth['token'], $rows, $options)->assertCreated()->json('data');

        // تعديل صف مؤكَّد موجود (لا إضافة) تغيير
        $this->withToken($auth['token'])->postJson("/api/import-jobs/{$job['id']}/apply", ['confirmed_repeat_rows' => [4]])->assertStatus(422)->assertJsonPath('code', 'options_frozen');
        // نفس القيم بصيغ مختلفة (نص/مصفوفة نصوص) ليست تغييراً
        $this->withToken($auth['token'])->postJson("/api/import-jobs/{$job['id']}/apply", ['default_tax_rate' => '5', 'confirmed_repeat_rows' => ['3']])->assertOk();
    }

    /** @test */
    public function a_repair_child_never_inherits_confirmed_repeat_rows_because_its_file_is_renumbered(): void
    {
        $this->assertSame([], ExpenseImportAdapter::effectiveOptions(true, ['confirmed_repeat_rows' => [3, 5], 'default_tax_rate' => 5])['confirmed_repeat_rows']);
        $this->assertSame([3, 5], ExpenseImportAdapter::effectiveOptions(false, ['confirmed_repeat_rows' => [3, 5]])['confirmed_repeat_rows']);
        // وقيمٌ فاسدة (مصفوفة بدل نص) تُرفض رفضاً مسمّى لا ErrorException
        $adapter = app(ExpenseImportAdapter::class);
        $bad = $adapter->canonicalOptions(['default_payment_method' => ['x'], 'reference_policy' => ['y']]);
        $this->thrown(fn () => app(\App\Services\ExpenseImportService::class)->options($bad), 'array option', \RuntimeException::class);
        // JSON 5.0 و"5" متكافئان
        $this->assertSame($adapter->canonicalOptions(['default_tax_rate' => 5.0, 'confirmed_repeat_rows' => [3.0]]), $adapter->canonicalOptions(['default_tax_rate' => '5', 'confirmed_repeat_rows' => ['3']]));
    }

    /** @test */
    public function an_in_file_duplicate_needs_explicit_confirmation_and_both_expenses_are_then_created(): void
    {
        $auth = $this->registerTenant();
        $rows = [$this->row(), $this->row()];

        $preview = $this->upload($auth['token'], '/api/expenses/import/preview', ['file' => $this->file($rows)])->assertOk()->json('data');
        $this->assertSame(1, $preview['error_rows']);

        $options = ['confirmed_repeat_rows' => [3]];
        $job = $this->createJob($auth['token'], $rows, $options)->assertCreated()->json('data');
        $this->assertSame('completed', $this->runJob($auth['token'], $job['id']));
        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertSame(2, Expense::query()->count());
    }

    /** @test */
    public function an_unconfirmed_duplicate_fails_the_job_and_records_the_failed_unit_without_writing(): void
    {
        $auth = $this->registerTenant();
        $rows = [$this->row(), $this->row()];
        $job = $this->createJob($auth['token'], $rows)->assertCreated()->json('data');

        $this->assertSame('failed', $this->runJob($auth['token'], $job['id']));
        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertSame(0, Expense::query()->count());
        $this->assertContains('row_duplicate_in_file', ImportJobUnit::query()->where('import_job_id', $job['id'])->pluck('error_code')->all());
        $this->withToken($auth['token'])->get("/api/import-jobs/{$job['id']}/failures")->assertOk();
    }

    /** @test */
    public function a_conflicting_expense_created_after_the_preview_is_plan_drift_and_nothing_is_written(): void
    {
        $auth = $this->registerTenant();
        $rows = [$this->row()];
        $job = $this->createJob($auth['token'], $rows)->assertCreated()->json('data');

        // يظهر مصروف مطابق بعد المعاينة وقبل التنفيذ
        $this->withToken($auth['token'])->postJson('/api/expenses', [
            'account_id' => Account::query()->where('code', '5130')->firstOrFail()->id, 'amount' => 100000, 'vendor_name' => 'شركة الأمل', 'expense_date' => '2026-10-01', 'tax_rate' => 15,
        ])->assertCreated();

        $this->assertSame('failed', $this->runJob($auth['token'], $job['id']));
        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertSame(1, Expense::query()->count(), 'المصروف اليدوي وحده.');
        $this->assertContains('plan_drift', ImportJobUnit::query()->where('import_job_id', $job['id'])->pluck('error_code')->all());
    }

    // ═══════════════════════════════ البوابات والعزل ═══════════════════════════════

    /** @test */
    public function gates_follow_the_direct_expense_route_and_a_viewer_cannot_preview_or_create(): void
    {
        $auth = $this->registerTenant();
        $rows = [$this->row()];

        $viewer = $this->role($auth['tenant_id'], 'exp_viewer', ['expenses.view'], 'v@h5.test');
        $this->withToken($viewer)->getJson('/api/expenses/import/fields')->assertForbidden();
        $this->upload($viewer, '/api/expenses/import/preview', ['file' => $this->file($rows)])->assertForbidden();
        $this->upload($viewer, '/api/import-jobs', ['domain' => 'expense_import', 'file' => $this->file($rows)])->assertForbidden();

        $manager = $this->role($auth['tenant_id'], 'exp_manager', ['expenses.view', 'expenses.manage'], 'm@h5.test');
        $b = $this->bind($manager, $rows);
        $this->upload($manager, '/api/import-jobs', ['domain' => 'expense_import', 'file' => $this->file($rows), 'preview_id' => $b['id'], 'preview_hash' => $b['hash']])->assertCreated();
    }

    /** @test */
    public function a_disabled_finance_operations_refuses_the_endpoints_and_job_creation_and_apply(): void
    {
        $auth = $this->registerTenant();
        $rows = [$this->row()];
        $job = $this->createJob($auth['token'], $rows)->assertCreated()->json('data');

        $this->disableFinance($auth['tenant_id']);

        $this->withToken($auth['token'])->getJson('/api/expenses/import/fields')->assertForbidden();
        $this->upload($auth['token'], '/api/expenses/import/preview', ['file' => $this->file($rows)])->assertForbidden();
        $this->upload($auth['token'], '/api/import-jobs', ['domain' => 'expense_import', 'file' => $this->file($rows)])->assertForbidden();
        $this->withToken($auth['token'])->postJson("/api/import-jobs/{$job['id']}/apply", [])->assertForbidden();
        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertSame(0, Expense::query()->count());
    }

    /** @test */
    public function another_tenants_account_code_never_resolves_through_the_endpoint(): void
    {
        $auth = $this->registerTenant('acme', 'o@acme.test');
        $other = $this->registerTenant('other', 'o@other.test');
        app(TenantContext::class)->set($other['tenant_id']);
        Account::create(['code' => '5777', 'name' => 'حساب غيري', 'type' => 'expense', 'normal_balance' => 'debit']);
        app(TenantContext::class)->set($auth['tenant_id']);

        $preview = $this->upload($auth['token'], '/api/expenses/import/preview', ['file' => $this->file([$this->row(['account_code' => '5777'])])])->assertOk()->json('data');

        $this->assertSame(1, $preview['error_rows']);
    }
}
