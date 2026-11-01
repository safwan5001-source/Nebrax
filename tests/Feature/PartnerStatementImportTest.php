<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\ImportJob;
use App\Models\Partner;
use App\Models\PartnerStatementLine;
use App\Models\PartnerStatementReconciliation;
use App\Models\Role;
use App\Models\Tenant;
use App\Models\User;
use App\Services\AiActionRegistry;
use App\Services\PartnerStatementImportAdapter;
use App\Support\ImportJobDomain;
use App\Support\Rbac;
use App\Support\SpreadsheetWriter;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * IMP-PS-A1 — استيراد كشف حساب طرف إلى جداول تجهيز المقارنة (المسار أ، لا أثر مالي). قرارات المالك D-PS-01..04 (2026-11-01): ريال فقط · صلاحيات `partner_statements.*` مستقلة بلا منح
 * ضمني · `CompanyWide` بعزل المؤسسة وضوابط رؤية الطرف · السياسات P-1..P-5. كل اختبار يتحقق مما كُتب **وما لم يُكتب** (لا قيد ولا مستند ولا رصيد).
 *
 * تشغيل: php artisan test --filter=PartnerStatementImportTest
 */
class PartnerStatementImportTest extends TestCase
{
    use InteractsWithApi;
    use RefreshDatabase;

    private array $auth;

    private Partner $customer;

    private Partner $supplier;

    private Partner $both;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
        $this->auth = $this->registerTenant('ps-a1', 'owner@ps-a1.test');
        app(TenantContext::class)->set($this->auth['tenant_id']);
        $this->customer = Partner::create(['type' => 'customer', 'entity_type' => 'commercial', 'name' => 'عميل الكشف', 'is_active' => true]);
        $this->supplier = Partner::create(['type' => 'supplier', 'entity_type' => 'commercial', 'name' => 'مورد الكشف', 'is_active' => true]);
        $this->both = Partner::create(['type' => 'both', 'entity_type' => 'commercial', 'name' => 'طرف مزدوج', 'is_active' => true]);
    }

    // ═══════════════════════════════ أدوات ═══════════════════════════════

    /** @param list<array<string,string>> $rows */
    private function file(array $rows, string $name = 'statement.csv'): UploadedFile
    {
        $keys = array_values(array_unique(array_merge(...array_map('array_keys', $rows))));
        $table = array_map(fn (array $row): array => array_map(fn (string $key): string => $row[$key] ?? '', $keys), $rows);

        return UploadedFile::fake()->createWithContent($name, SpreadsheetWriter::csv($keys, $table));
    }

    /** كشف بعمودَي مدين/دائن. */
    private function rows(): array
    {
        return [
            ['التاريخ' => '2026-09-01', 'رقم المستند' => 'INV-1001', 'البيان' => 'فاتورة', 'مدين' => '1150.00', 'دائن' => '', 'الرصيد' => '1150.00', 'العملة' => 'SAR', 'نوع الحركة' => 'فاتورة'],
            ['التاريخ' => '10/09/2026', 'رقم المستند' => 'PAY-77', 'البيان' => 'سداد', 'مدين' => '', 'دائن' => '500.00', 'الرصيد' => '650.00', 'العملة' => 'ريال', 'نوع الحركة' => 'دفعة'],
        ];
    }

    /** كشف بعمود مبلغ واحد. */
    private function oneColumn(array $amounts): array
    {
        return array_map(fn (string $amount, int $i): array => ['التاريخ' => '2026-09-0'.($i + 1), 'رقم المستند' => 'D-'.($i + 1), 'المبلغ' => $amount], $amounts, array_keys($amounts));
    }

    private function hdr(array $over = []): array
    {
        return $over + ['partner_id' => $this->customer->id, 'role' => 'customer', 'period_from' => '2026-09-01', 'period_to' => '2026-09-30'];
    }

    private function upload(string $token, string $uri, array $body)
    {
        return $this->withToken($token)->post($uri, $body, ['Accept' => 'application/json']);
    }

    private function preview(string $token, array $rows, array $options)
    {
        return $this->upload($token, '/api/partner-statements/import/preview', ['file' => $this->file($rows)] + $options);
    }

    /** @return array{id: string, hash: string} */
    private function bind(string $token, array $rows, array $options): array
    {
        return $this->preview($token, $rows, $options)->assertOk()->json('data.binding');
    }

    private function createJob(string $token, array $rows, array $options, ?array $binding = null)
    {
        $binding ??= $this->bind($token, $rows, $options);

        return $this->upload($token, '/api/import-jobs', [
            'domain' => 'partner_statement', 'file' => $this->file($rows), 'options' => $options, 'preview_id' => $binding['id'], 'preview_hash' => $binding['hash'],
        ]);
    }

    /** ينشئ المهمة ويطبّقها؛ يعيد بيانات الطبقة المنفَّذة. @return array<string, mixed> */
    private function runJob(string $token, array $rows, array $options): array
    {
        $job = $this->createJob($token, $rows, $options)->assertCreated()->json('data');

        return $this->withToken($token)->postJson("/api/import-jobs/{$job['id']}/apply", [])->assertOk()->json('data');
    }

    private function role(string $slug, array $permissions, string $email): string
    {
        app(TenantContext::class)->set($this->auth['tenant_id']);
        Role::create(['slug' => $slug, 'name' => $slug, 'permissions' => $permissions, 'is_system' => false]);

        return $this->tokenForRole($this->auth['tenant_id'], $slug, $email);
    }

    private function reconciliations(): int
    {
        return PartnerStatementReconciliation::query()->count();
    }

    // ═══════════════════════════════ التسجيل والبوابات ═══════════════════════════════

    /** @test */
    public function the_domain_is_a_bound_only_atomic_file_unit_with_independent_permissions_and_no_ai_action(): void
    {
        $this->assertSame([AiActionRegistry::PRODUCT_IMPORT], app(AiActionRegistry::class)->types());
        $this->assertContains('partner_statement', ImportJobDomain::values());
        $this->assertContains('partner_statement', ImportJobDomain::PREVIEW_BOUND_ONLY);
        $this->assertSame('file', app(PartnerStatementImportAdapter::class)->unit());
        $this->assertSame(
            ['view' => 'partner_statements.view', 'manage' => 'partner_statements.reconcile', 'app' => 'accounting.partner_statements'],
            ImportJobDomain::authorization('partner_statement'),
            'D-PS-02: صلاحيتان مستقلتان؛ D-PS-08 (PS-A2a): مفتاح القدرة المستقل accounting.partner_statements.'
        );
    }

    /** @test */
    public function the_new_permissions_are_granted_to_no_matrix_role_and_no_stored_role_implicitly(): void
    {
        $this->assertContains('partner_statements.view', Rbac::PERMISSIONS);
        $this->assertContains('partner_statements.reconcile', Rbac::PERMISSIONS);
        foreach (Rbac::MATRIX as $role => $permissions) {
            $this->assertNotContains('partner_statements.view', $permissions, "الدور {$role}");
            $this->assertNotContains('partner_statements.reconcile', $permissions, "الدور {$role}");
        }
        foreach (['accountant', 'staff'] as $slug) {
            $this->assertFalse(Rbac::allows($slug, 'partner_statements.reconcile'), $slug);
            $this->assertFalse(Rbac::allows($slug, 'partner_statements.view'), $slug);
        }
        $this->assertTrue(Rbac::allows('owner', 'partner_statements.reconcile'));
    }

    /** @test */
    public function there_is_no_synchronous_apply_route(): void
    {
        $this->upload($this->auth['token'], '/api/partner-statements/import/apply', ['file' => $this->file($this->rows())] + $this->hdr())->assertStatus(404);
        $this->assertSame(0, $this->reconciliations());
    }

    // ═══════════════════════════════ النقاط ═══════════════════════════════

    /** @test */
    public function fields_template_and_inspect_serve_the_contract_and_inspect_reads_only_the_file(): void
    {
        $keys = array_column($this->withToken($this->auth['token'])->getJson('/api/partner-statements/import/fields')->assertOk()->json('data.fields'), 'key');
        $this->assertSame(['line_date', 'reference', 'our_reference', 'description', 'debit', 'credit', 'amount', 'balance', 'currency', 'kind'], $keys);
        $template = $this->withToken($this->auth['token'])->get('/api/partner-statements/import/template')->assertOk()->streamedContent();
        $this->assertStringContainsString('مدين', $template);
        $this->assertStringNotContainsString('المبلغ', $template, 'تخطيط مدين/دائن وحده؛ عمود المبلغ البديل يرفضه التحقق مع مدين/دائن.');

        // القالب المنزَّل يُرفع كما هو بالمطابقة التلقائية ويصير معاينة صالحة (Codex #1877 P2).
        $round = $this->upload($this->auth['token'], '/api/partner-statements/import/preview', ['file' => UploadedFile::fake()->createWithContent('template.csv', $template)] + $this->hdr())->assertOk()->json('data');
        $this->assertSame([2, 0], [$round['line_rows'], $round['error_rows']]);
        $this->assertSame([115000, 50000], [$round['total_debit_minor'], $round['total_credit_minor']]);

        // الفحص بالملف وحده: لا طرف ولا فترة، فلا يُقرأ طرفٌ أصلاً.
        $inspect = $this->upload($this->auth['token'], '/api/partner-statements/import/inspect', ['file' => $this->file($this->rows())])->assertOk()->json('data');
        $this->assertSame(['line_date', 'reference', 'description', 'debit', 'credit', 'balance', 'currency', 'kind'], array_column($inspect['columns'], 'suggested_field'));
        $this->assertSame(2, $inspect['total_rows']);
        $this->assertSame(0, $this->reconciliations());
    }

    /** @test */
    public function a_two_column_preview_reports_counts_totals_policy_and_the_partner_and_writes_nothing(): void
    {
        $preview = $this->preview($this->auth['token'], $this->rows(), $this->hdr())->assertOk()->json('data');

        $this->assertSame(['عميل الكشف', 'customer', 2, 0], [$preview['partner_name'], $preview['role'], $preview['line_rows'], $preview['error_rows']]);
        $this->assertSame([115000, 50000], [$preview['total_debit_minor'], $preview['total_credit_minor']]);
        $this->assertSame(3, $preview['policy']['date_tolerance_days']);
        $this->assertSame(0, $preview['policy']['amount_tolerance_minor']);
        $this->assertTrue($preview['policy']['include_reversed']);
        $this->assertSame('SAR', $preview['currency']);
        $this->assertSame(['balance_rows' => 2, 'balance_pairs_checked' => 1, 'balance_mismatches' => [], 'balance_mismatches_truncated' => false], $preview['checks']);
        $this->assertSame('2026-09-10', $preview['rows'][1]['line_date'], 'DD/MM/YYYY يوماً أولاً.');
        $this->assertFalse($preview['already_imported']);
        $this->assertNotEmpty($preview['binding']['id']);
        $this->assertSame(0, $this->reconciliations());
        $this->assertSame(0, PartnerStatementLine::query()->count());
    }

    // ═══════════════════════════════ الاتجاه (P-3) ═══════════════════════════════

    /** @test */
    public function a_single_amount_column_requires_a_declared_direction_and_never_guesses(): void
    {
        $rows = $this->oneColumn(['1150.00', '-500.00']);

        $this->preview($this->auth['token'], $rows, $this->hdr())->assertStatus(422)->assertJsonPath('message', fn (string $m) => str_contains($m, 'اتجاهه'));
        $this->preview($this->auth['token'], $rows, $this->hdr(['amount_direction' => 'sideways']))->assertStatus(422)->assertJsonValidationErrors('amount_direction');
        $this->assertSame(0, $this->reconciliations());
    }

    /** @test */
    public function the_declared_direction_assigns_debit_or_credit_and_the_sign_flips_it(): void
    {
        $rows = $this->oneColumn(['1150.00', '-500.00', '(200.00)', '75.50-', '+10.00']);

        $debitFirst = $this->preview($this->auth['token'], $rows, $this->hdr(['amount_direction' => 'positive_is_debit']))->assertOk()->json('data');
        $this->assertSame([[115000, 0], [0, 50000], [0, 20000], [0, 7550], [1000, 0]], array_map(fn (array $r): array => [$r['debit_minor'], $r['credit_minor']], $debitFirst['rows']));

        $creditFirst = $this->preview($this->auth['token'], $rows, $this->hdr(['amount_direction' => 'positive_is_credit']))->assertOk()->json('data');
        $this->assertSame([[0, 115000], [50000, 0], [20000, 0], [7550, 0], [0, 1000]], array_map(fn (array $r): array => [$r['debit_minor'], $r['credit_minor']], $creditFirst['rows']));
    }

    /** @test */
    public function ambiguous_signs_zero_and_blank_amounts_and_mixed_forms_are_row_errors(): void
    {
        $rows = $this->oneColumn(['(-5.00)', '-5.00-', '0.00', '', '12,50', 'abc']);
        $preview = $this->preview($this->auth['token'], $rows, $this->hdr(['amount_direction' => 'positive_is_debit']))->assertOk()->json('data');

        $this->assertSame(6, $preview['error_rows']);
        $this->assertSame(0, $preview['line_rows']);
    }

    /** @test */
    public function direction_belongs_to_single_column_files_only_and_a_lone_debit_or_credit_column_is_ambiguous(): void
    {
        $this->preview($this->auth['token'], $this->rows(), $this->hdr(['amount_direction' => 'positive_is_debit']))->assertStatus(422);

        $debitOnly = array_map(fn (array $r): array => array_diff_key($r, ['دائن' => 1]), $this->rows());
        $this->preview($this->auth['token'], $debitOnly, $this->hdr())->assertStatus(422)->assertJsonPath('message', fn (string $m) => str_contains($m, 'ملتبس'));

        $mixed = array_map(fn (array $r): array => $r + ['المبلغ' => '5'], $this->rows());
        $this->preview($this->auth['token'], $mixed, $this->hdr(['amount_direction' => 'positive_is_debit']))->assertStatus(422);
    }

    // ═══════════════════════════════ العملة (D-PS-01) ═══════════════════════════════

    /** @test */
    public function only_saudi_riyal_is_accepted_at_the_option_row_and_tenant_levels(): void
    {
        $this->preview($this->auth['token'], $this->rows(), $this->hdr(['currency' => 'USD']))->assertStatus(422)->assertJsonPath('message', fn (string $m) => str_contains($m, 'SAR'));
        $this->preview($this->auth['token'], $this->rows(), $this->hdr(['currency' => 'sar']))->assertOk();

        $foreign = $this->rows();
        $foreign[1]['العملة'] = 'USD';
        $preview = $this->preview($this->auth['token'], $foreign, $this->hdr())->assertOk()->json('data');
        $this->assertSame([1, 1], [$preview['line_rows'], $preview['error_rows']]);
        $this->assertStringContainsString('غير مدعومة', $preview['rows'][1]['messages'][0]);

        Tenant::query()->whereKey($this->auth['tenant_id'])->update(['currency' => 'USD']);
        $this->preview($this->auth['token'], $this->rows(), $this->hdr())->assertStatus(422)->assertJsonPath('message', fn (string $m) => str_contains($m, 'الريال'));
    }

    // ═══════════════════════════════ السياسات (P-1/P-2/P-5) ═══════════════════════════════

    /** @test */
    public function tolerances_are_bounded_integers_in_days_and_halalas_and_never_a_percentage(): void
    {
        $ok = $this->preview($this->auth['token'], $this->rows(), $this->hdr(['date_tolerance_days' => 30, 'amount_tolerance_minor' => 50]))->assertOk()->json('data.policy');
        $this->assertSame([30, 50], [$ok['date_tolerance_days'], $ok['amount_tolerance_minor']]);
        $this->assertSame(0, $this->preview($this->auth['token'], $this->rows(), $this->hdr(['date_tolerance_days' => 0]))->assertOk()->json('data.policy.date_tolerance_days'));

        foreach ([['date_tolerance_days' => 31], ['date_tolerance_days' => -1], ['date_tolerance_days' => 'x'], ['amount_tolerance_minor' => -1], ['amount_tolerance_minor' => 10001], ['amount_tolerance_minor' => '5%'], ['amount_tolerance_minor' => '1.5']] as $bad) {
            $this->preview($this->auth['token'], $this->rows(), $this->hdr($bad))->assertStatus(422);
        }
    }

    /** @test */
    public function the_period_is_validated(): void
    {
        $this->preview($this->auth['token'], $this->rows(), $this->hdr(['period_from' => '2026-10-01', 'period_to' => '2026-09-01']))->assertStatus(422);
        $this->preview($this->auth['token'], $this->rows(), $this->hdr(['period_from' => '2018-01-01', 'period_to' => '2026-09-01']))->assertStatus(422)->assertJsonPath('message', fn (string $m) => str_contains($m, 'خمس'));
        $this->preview($this->auth['token'], $this->rows(), $this->hdr(['period_from' => '01-09-2026']))->assertStatus(422)->assertJsonValidationErrors('period_from');
        $this->preview($this->auth['token'], $this->rows(), $this->hdr(['period_from' => '2026-02-30', 'period_to' => '2026-03-01']))->assertStatus(422);
    }

    /** @test */
    public function a_line_outside_the_period_is_a_warning_not_an_error(): void
    {
        $rows = $this->rows();
        $rows[0]['التاريخ'] = '2026-08-15';
        $preview = $this->preview($this->auth['token'], $rows, $this->hdr())->assertOk()->json('data');

        $this->assertSame([2, 0, 1], [$preview['line_rows'], $preview['error_rows'], $preview['warning_rows']]);
        $this->assertSame('warning', $preview['rows'][0]['status']);
    }

    // ═══════════════════════════════ الملفات غير الصالحة ═══════════════════════════════

    /** @test */
    public function invalid_files_and_rows_are_refused_with_named_row_errors(): void
    {
        $this->preview($this->auth['token'], [['البيان' => 'x']], $this->hdr())->assertStatus(422)->assertJsonPath('message', fn (string $m) => str_contains($m, 'التاريخ'));

        $rows = [
            ['التاريخ' => 'بلا', 'رقم المستند' => 'A', 'مدين' => '10', 'دائن' => ''],
            ['التاريخ' => '2026-09-02', 'رقم المستند' => 'B', 'مدين' => '10', 'دائن' => '10'],
            ['التاريخ' => '2026-09-03', 'رقم المستند' => 'C', 'مدين' => '', 'دائن' => ''],
            ['التاريخ' => '2026-09-04', 'رقم المستند' => 'D', 'مدين' => '-5', 'دائن' => ''],
            ['التاريخ' => '2026-09-05', 'رقم المستند' => str_repeat('x', 101), 'مدين' => '5', 'دائن' => ''],
            ['التاريخ' => '2026-09-06', 'رقم المستند' => 'F', 'مدين' => '85,50', 'دائن' => ''],
            ['التاريخ' => '2026-09-07', 'رقم المستند' => 'G', 'مدين' => '5', 'دائن' => ''],
        ];
        $preview = $this->preview($this->auth['token'], $rows, $this->hdr())->assertOk()->json('data');
        $this->assertSame([6, 1], [$preview['error_rows'], $preview['line_rows']]);
        $this->assertSame([2, 3, 4, 5, 6, 7], array_column($preview['errors'], 'row'));

        $this->upload($this->auth['token'], '/api/partner-statements/import/preview', ['file' => UploadedFile::fake()->createWithContent('x.pdf', '%PDF-1.4')] + $this->hdr())->assertStatus(422);
        $this->upload($this->auth['token'], '/api/partner-statements/import/preview', ['file' => UploadedFile::fake()->createWithContent('empty.csv', '')] + $this->hdr())->assertStatus(422);
        $this->upload($this->auth['token'], '/api/partner-statements/import/preview', $this->hdr())->assertStatus(422)->assertJsonValidationErrors('file');
        $this->upload($this->auth['token'], '/api/partner-statements/import/preview', ['file' => $this->file($this->rows()), 'mapping' => ['0' => 'amount_total']] + $this->hdr())->assertStatus(422);
        $this->assertSame(0, $this->reconciliations());
    }

    /** @test */
    public function a_file_with_row_errors_can_be_neither_applied_nor_partially_stored(): void
    {
        $rows = $this->rows();
        $binding = $this->bind($this->auth['token'], $rows, $this->hdr());
        $bad = $rows;
        $bad[1]['التاريخ'] = 'خطأ';

        $job = $this->createJob($this->auth['token'], $bad, $this->hdr(), $binding);
        // الربط بالملف نفسه: ملفٌ مختلف عن المعاينة لا يُقبل؛ وإن أُنشئت المهمة فالتطبيق يرفض ولا يخزّن شيئاً.
        if ($job->status() === 201) {
            $this->withToken($this->auth['token'])->postJson('/api/import-jobs/'.$job->json('data.id').'/apply', []);
        }
        $this->assertSame(0, $this->reconciliations());
        $this->assertSame(0, PartnerStatementLine::query()->count());
    }

    /** @test */
    public function printed_balances_are_a_consistency_warning_never_a_blocker_or_a_matching_input(): void
    {
        $rows = $this->rows();
        $rows[1]['الرصيد'] = '999.00';
        $preview = $this->preview($this->auth['token'], $rows, $this->hdr())->assertOk()->json('data');

        $this->assertSame([3], $preview['checks']['balance_mismatches'], 'رقم الصف كما في Excel (العناوين صف 1).');
        $this->assertSame([2, 0, 1], [$preview['line_rows'], $preview['error_rows'], $preview['warning_rows']]);
    }

    /** @test */
    public function repeated_lines_and_unknown_kinds_are_warnings(): void
    {
        $rows = $this->rows();
        $rows[] = $rows[0];
        $rows[0]['نوع الحركة'] = 'غريب';
        $preview = $this->preview($this->auth['token'], $rows, $this->hdr())->assertOk()->json('data');

        $this->assertSame(0, $preview['error_rows']);
        $this->assertStringContainsString('مكرّر', implode(' ', $preview['rows'][0]['warnings'] + $preview['rows'][2]['warnings']));
        $this->assertStringContainsString('غير معروف', implode(' ', $preview['rows'][0]['warnings']));
    }

    // ═══════════════════════════════ التطبيق وإعادة الرفع ═══════════════════════════════

    /** @test */
    public function a_bound_job_stores_one_reconciliation_with_its_lines_policy_and_writes_nothing_financial(): void
    {
        $before = $this->financialCounts();

        $job = $this->runJob($this->auth['token'], $this->rows(), $this->hdr());
        $this->assertSame('completed', $job['status']);

        $reconciliation = PartnerStatementReconciliation::query()->with('lines')->firstOrFail();
        $this->assertSame([$this->customer->id, 'customer', 'draft', 'SAR', 2, 115000, 50000], [
            $reconciliation->partner_id, $reconciliation->role, $reconciliation->status, $reconciliation->currency,
            (int) $reconciliation->line_count, (int) $reconciliation->total_debit_minor, (int) $reconciliation->total_credit_minor,
        ]);
        $this->assertSame(['2026-09-01', '2026-09-30'], [$reconciliation->period_from->toDateString(), $reconciliation->period_to->toDateString()]);
        $this->assertSame(64, strlen($reconciliation->file_sha256));
        $this->assertSame($job['id'], $reconciliation->source_import_job_id);
        $this->assertSame(3, $reconciliation->policy['date_tolerance_days']);
        $this->assertSame('statement.csv', $reconciliation->original_filename);

        $lines = $reconciliation->lines->sortBy('ordinal')->values();
        $this->assertSame([2, 3], $lines->pluck('ordinal')->all(), 'رقم الصف كما في Excel.');
        $this->assertSame('inv1001', $lines[0]->reference_key);
        $this->assertSame([115000, 0, 'invoice'], [$lines[0]->debit_minor, $lines[0]->credit_minor, $lines[0]->kind]);
        $this->assertSame([0, 50000, 'payment'], [$lines[1]->debit_minor, $lines[1]->credit_minor, $lines[1]->kind]);
        $this->assertSame($reconciliation->id, ImportJob::query()->findOrFail($job['id'])->apply_result['reconciliation_id']);
        $this->assertSame($before, $this->financialCounts(), 'لا قيد ولا مستند ولا دفعة ولا رصيد ولا حركة مخزون.');
    }

    /** @return array<string, int> */
    private function financialCounts(): array
    {
        $counts = [];
        foreach (['journal_entries', 'journal_lines', 'invoices', 'purchases', 'payments', 'expenses', 'credit_notes', 'stock_movements', 'import_document_reservations'] as $table) {
            $counts[$table] = DB::table($table)->count();
        }
        $counts['partner_hash'] = crc32(json_encode(DB::table('partners')->orderBy('id')->get()->all()));

        return $counts;
    }

    /** @test */
    public function re_uploading_the_same_file_for_the_same_identity_replays_the_existing_reconciliation(): void
    {
        $first = $this->runJob($this->auth['token'], $this->rows(), $this->hdr());
        $second = $this->runJob($this->auth['token'], $this->rows(), $this->hdr());

        $this->assertSame(1, $this->reconciliations());
        $this->assertSame(2, PartnerStatementLine::query()->count());
        $this->assertSame($first['apply_result']['reconciliation_id'], $second['apply_result']['reconciliation_id']);
        $this->assertTrue($second['apply_result']['replayed']);
        $this->assertSame([0, 1], [$second['apply_result']['created'], $second['apply_result']['skipped']]);

        $preview = $this->preview($this->auth['token'], $this->rows(), $this->hdr())->assertOk()->json('data');
        $this->assertTrue($preview['already_imported']);
        $this->assertSame($first['apply_result']['reconciliation_id'], $preview['existing_reconciliation_id']);
    }

    /**
     * مراجعة #1877: الملف نفسه بتفسير مختلف (اتجاه مصحَّح، تسامح، ربط أعمدة) لا يعيد المسودة السابقة بصمت — لا حبس في مسودة فُسِّرت خطأً (لا إلغاء قبل PS-A3)،
     * والمسودة السابقة تبقى كما هي، وتفسير مطابق تماماً يعيد الأولى.
     *
     * @test
     */
    public function the_same_file_under_a_different_interpretation_is_a_new_draft_and_the_old_one_is_untouched(): void
    {
        $rows = $this->oneColumn(['1150.00', '-500.00']);
        $wrong = $this->runJob($this->auth['token'], $rows, $this->hdr(['amount_direction' => 'positive_is_credit']));
        $fixed = $this->runJob($this->auth['token'], $rows, $this->hdr(['amount_direction' => 'positive_is_debit']));

        $this->assertNotSame($wrong['apply_result']['reconciliation_id'], $fixed['apply_result']['reconciliation_id']);
        $this->assertFalse($fixed['apply_result']['replayed']);
        $this->assertSame(2, $this->reconciliations());

        $old = PartnerStatementReconciliation::query()->findOrFail($wrong['apply_result']['reconciliation_id']);
        $new = PartnerStatementReconciliation::query()->findOrFail($fixed['apply_result']['reconciliation_id']);
        $this->assertSame($old->file_sha256, $new->file_sha256, 'الملف نفسه.');
        $this->assertNotSame($old->identity_sha256, $new->identity_sha256);
        $this->assertSame([50000, 115000], [(int) $old->total_debit_minor, (int) $old->total_credit_minor], 'الاتجاه الخاطئ يبقى كما خُزِّن.');
        $this->assertSame([115000, 50000], [(int) $new->total_debit_minor, (int) $new->total_credit_minor]);
        $this->assertSame('draft', $old->status, 'المسودة السابقة تبقى مسودة بلا تعديل ولا حذف.');

        // تفسير مطابق تماماً (الملف والاتجاه) يعيد المسودة المصحَّحة لا ثالثة.
        $again = $this->runJob($this->auth['token'], $rows, $this->hdr(['amount_direction' => 'positive_is_debit']));
        $this->assertTrue($again['apply_result']['replayed']);
        $this->assertSame($fixed['apply_result']['reconciliation_id'], $again['apply_result']['reconciliation_id']);

        // تسامح مختلف على الملف نفسه تفسيرٌ آخر (السياسة المجمَّدة جزء من الهوية).
        $tolerant = $this->runJob($this->auth['token'], $rows, $this->hdr(['amount_direction' => 'positive_is_debit', 'date_tolerance_days' => 7]));
        $this->assertFalse($tolerant['apply_result']['replayed']);
        $this->assertSame(3, $this->reconciliations());
    }

    /**
     * Codex #1877 P2: الربط التلقائي يذكر العمود المتجاهَل بـnull والصريح قد يحذفه؛ التحليل يعاملهما سواءً فلا يجوز أن تختلف الهوية (مسودتان متطابقتان).
     *
     * @test
     */
    public function an_ignored_column_listed_as_null_or_omitted_is_the_same_interpretation(): void
    {
        $rows = $this->rows();
        foreach ($rows as &$row) {
            $row['ملاحظات داخلية'] = 'x';   // عمود غير معروف ⇒ يُتجاهل
        }
        unset($row);

        $auto = $this->runJob($this->auth['token'], $rows, $this->hdr());
        $automatic = $this->preview($this->auth['token'], $rows, $this->hdr())->assertOk()->json('data.mapping');
        $this->assertContains(null, $automatic, 'الربط التلقائي يحمل مدخلاً null للعمود المتجاهَل.');

        $explicit = array_filter($automatic, static fn ($key): bool => $key !== null);
        $second = $this->runJob($this->auth['token'], $rows, $this->hdr(['mapping' => $explicit]));

        $this->assertTrue($second['apply_result']['replayed']);
        $this->assertSame($auto['apply_result']['reconciliation_id'], $second['apply_result']['reconciliation_id']);
        $this->assertSame(1, $this->reconciliations());
    }

    /** @test */
    public function a_different_file_period_role_or_partner_is_a_separate_reconciliation(): void
    {
        $this->runJob($this->auth['token'], $this->rows(), $this->hdr());

        $changed = $this->rows();
        $changed[1]['دائن'] = '501.00';
        $this->runJob($this->auth['token'], $changed, $this->hdr());                                                    // محتوى مختلف
        $this->runJob($this->auth['token'], $this->rows(), $this->hdr(['period_to' => '2026-10-31']));                  // فترة مختلفة
        $this->runJob($this->auth['token'], $this->rows(), $this->hdr(['partner_id' => $this->both->id]));              // طرف مختلف
        $this->runJob($this->auth['token'], $this->rows(), $this->hdr(['partner_id' => $this->both->id, 'role' => 'supplier'])); // دور مختلف

        $this->assertSame(5, $this->reconciliations());
    }

    /** @test */
    public function an_explicit_mapping_repeated_at_apply_is_accepted_and_a_changed_one_is_refused(): void
    {
        // أعمدة بترتيب غير مألوف وبعناوين لا تُطابَق تلقائياً ⇒ مطابقة صريحة (كل حقول الكشف مسموحة في طلب التطبيق أيضاً، Codex #1877 P2).
        $rows = [['c1' => '2026-09-01', 'c2' => 'INV-1', 'c3' => 'x', 'c4' => '10.00', 'c5' => '', 'c6' => '10.00', 'c7' => 'SAR', 'c8' => 'invoice']];
        $mapping = ['0' => 'line_date', '1' => 'reference', '2' => 'our_reference', '3' => 'debit', '4' => 'credit', '5' => 'balance', '6' => 'currency', '7' => 'kind'];
        $options = $this->hdr() + ['mapping' => $mapping];

        $job = $this->createJob($this->auth['token'], $rows, $options)->assertCreated()->json('data');
        $changed = $this->withToken($this->auth['token'])->postJson("/api/import-jobs/{$job['id']}/apply", ['mapping' => ['0' => 'line_date', '1' => 'description'] + $mapping]);
        $this->assertSame('options_frozen', $changed->json('code'));

        $this->withToken($this->auth['token'])->postJson("/api/import-jobs/{$job['id']}/apply", ['mapping' => $mapping])->assertOk();
        $this->assertSame([1, 1000], [PartnerStatementLine::query()->count(), (int) PartnerStatementLine::query()->value('debit_minor')]);
    }

    /** @test */
    public function an_unbound_job_and_options_that_differ_from_the_preview_are_refused(): void
    {
        $this->upload($this->auth['token'], '/api/import-jobs', ['domain' => 'partner_statement', 'file' => $this->file($this->rows()), 'options' => $this->hdr()])->assertStatus(422);

        $binding = $this->bind($this->auth['token'], $this->rows(), $this->hdr());
        $this->createJob($this->auth['token'], $this->rows(), $this->hdr(['partner_id' => $this->both->id]), $binding)->assertStatus(422);
        $this->createJob($this->auth['token'], $this->rows(), $this->hdr(['date_tolerance_days' => 5]), $binding)->assertStatus(422);
        $this->assertSame(0, $this->reconciliations());
    }

    /** @test */
    public function apply_requests_that_change_any_frozen_option_are_refused_as_options_frozen(): void
    {
        foreach ([
            ['partner_id' => $this->both->id], ['role' => 'supplier'], ['period_to' => '2026-12-31'], ['period_from' => '2026-01-01'],
            ['date_tolerance_days' => 9], ['amount_tolerance_minor' => 10], ['amount_direction' => 'positive_is_debit'], ['branch_id' => (string) Str::uuid()],
        ] as $change) {
            $job = $this->createJob($this->auth['token'], $this->rows(), $this->hdr())->assertCreated()->json('data');
            $res = $this->withToken($this->auth['token'])->postJson("/api/import-jobs/{$job['id']}/apply", $change);
            $this->assertSame(422, $res->status(), 'يجب رفض تغيير '.array_key_first($change));
            $this->assertSame('options_frozen', $res->json('code'), array_key_first($change));
        }
        $this->assertSame(0, $this->reconciliations());
    }

    /** @test */
    public function apply_requests_repeating_the_frozen_options_are_accepted(): void
    {
        $job = $this->createJob($this->auth['token'], $this->rows(), $this->hdr())->assertCreated()->json('data');
        $this->withToken($this->auth['token'])->postJson("/api/import-jobs/{$job['id']}/apply", $this->hdr(['date_tolerance_days' => 3, 'amount_tolerance_minor' => 0]))->assertOk();
        $this->assertSame(1, $this->reconciliations());
    }

    // ═══════════════════════════════ الصلاحيات والعزل ═══════════════════════════════

    /** @test */
    public function permissions_are_independent_and_partner_visibility_is_required_too(): void
    {
        $accountant = $this->tokenForRole($this->auth['tenant_id'], 'accountant', 'acc@ps-a1.test');
        $reconcileOnly = $this->role('ps-reconcile', ['partner_statements.reconcile'], 'rec@ps-a1.test');
        $viewOnly = $this->role('ps-view', ['partner_statements.view', 'partners.view'], 'view@ps-a1.test');
        $both = $this->role('ps-both', ['partner_statements.reconcile', 'partners.view'], 'both@ps-a1.test');
        $partnersOnly = $this->role('ps-partners', ['partners.view', 'partners.manage'], 'pm@ps-a1.test');
        $body = ['file' => $this->file($this->rows())] + $this->hdr();

        // بلا partner_statements.reconcile ⇒ 403 على كل نقاط الاستيراد ولو كان يملك partners.manage أو المحاسب.
        foreach ([$accountant, $viewOnly, $partnersOnly] as $token) {
            foreach (['inspect', 'preview'] as $endpoint) {
                $this->upload($token, "/api/partner-statements/import/{$endpoint}", $body)->assertForbidden();
            }
            $this->withToken($token)->getJson('/api/partner-statements/import/fields')->assertForbidden();
            $this->withToken($token)->get('/api/partner-statements/import/template')->assertForbidden();
        }

        // reconcile بلا partners.view ⇒ يمرّ الفحص (ملف فقط) لكن المعاينة تُرفض برسالة الطرف الموحّدة ولا يُكشف اسم الطرف.
        $this->upload($reconcileOnly, '/api/partner-statements/import/inspect', $body)->assertOk();
        $denied = $this->upload($reconcileOnly, '/api/partner-statements/import/preview', $body)->assertStatus(422);
        $this->assertSame('الطرف غير متاح لك في هذا الدور.', $denied->json('message'));
        $this->assertStringNotContainsString($this->customer->name, (string) $denied->getContent());

        $this->upload($both, '/api/partner-statements/import/preview', $body)->assertOk();

        // المهمة: لا يُنشئها من لا يملك reconcile (بوابة المجال)، ولا يطبّقها من فقدها قبل التنفيذ.
        $binding = $this->bind($this->auth['token'], $this->rows(), $this->hdr());
        $this->upload($viewOnly, '/api/import-jobs', ['domain' => 'partner_statement', 'file' => $this->file($this->rows()), 'options' => $this->hdr(), 'preview_id' => $binding['id'], 'preview_hash' => $binding['hash']])->assertForbidden();
        $this->assertSame(0, $this->reconciliations());
    }

    /** أوراق مصفوفة متداخلة بمسارها: [[مسار, قيمة], ...]. @return list<array{0: string, 1: mixed}> */
    private function leaves(mixed $value, string $path = ''): array
    {
        if (! is_array($value)) {
            return [[$path, $value]];
        }
        $out = [];
        foreach ($value as $key => $item) {
            $out = array_merge($out, $this->leaves($item, $path === '' ? (string) $key : $path.'.'.$key));
        }

        return $out;
    }

    /** @test */
    public function reading_a_statement_job_requires_partner_visibility_and_the_stored_result_carries_no_partner_data(): void
    {
        $job = $this->runJob($this->auth['token'], $this->rows(), $this->hdr());
        $viewOnly = $this->role('ps-job-view', ['partner_statements.view'], 'jobview@ps-a1.test');
        $viewAndPartners = $this->role('ps-job-both', ['partner_statements.view', 'partners.view'], 'jobboth@ps-a1.test');

        // بلا partners.view: القراءة المفردة 403 والقائمة تستبعد المجال (Codex #1877 P1).
        $this->withToken($viewOnly)->getJson("/api/import-jobs/{$job['id']}")->assertForbidden();
        $this->assertSame([], $this->withToken($viewOnly)->getJson('/api/import-jobs')->assertOk()->json('data'));

        $shown = $this->withToken($viewAndPartners)->getJson("/api/import-jobs/{$job['id']}")->assertOk();
        $listed = $this->withToken($viewAndPartners)->getJson('/api/import-jobs')->assertOk();
        $this->assertSame([$job['id']], array_column($listed->json('data'), 'id'));

        // حتى لمن يراها: نتيجة التطبيق بلا اسم الطرف ولا مرجع ولا بيان ولا مبلغ سطر — معرّف المقارنة وعدّادات فقط.
        // الفحص **بنيوي**: على أوراق الـJSON المفكَّك (نصوص تُقارن بالتطابق/الاحتواء للنصوص غير الرقمية، والأرقام بالتساوي الدقيق)، لا بحثاً عن
        // نص رقمي قصير داخل الجسم الخام — فمعرّفات UUID وبصمات SHA-256 العشوائية قد تحتوي «1150» صدفةً (هشاشة سابقة).
        $secretText = [$this->customer->name, 'INV-1001', 'PAY-77', 'فاتورة'];
        $secretAmounts = [115000, 1150, 50000, 500];   // مجاميع/مبالغ سطور الكشف (هللات وريالات)
        $payloads = [['data' => $shown->json('data')], ['data' => $listed->json('data')]];
        foreach ($payloads as $payload) {
            foreach ($this->leaves($payload) as [$path, $value]) {
                if (is_string($value)) {
                    foreach ($secretText as $secret) {
                        $this->assertStringNotContainsString($secret, $value, "{$path} يحمل «{$secret}».");
                    }
                } elseif (is_int($value) || is_float($value)) {
                    $this->assertNotContains($value, $secretAmounts, "{$path} يحمل مبلغ سطر كشف ({$value}).");
                }
            }
        }
        // وبنيوياً: مفاتيح نتيجة التطبيق هي هذه السبعة بالضبط وقيمها عدّادات/معرّف/منطقي فقط.
        $result = $shown->json('data.apply_result');
        $this->assertSame(['reconciliation_id', 'created', 'updated', 'skipped', 'replayed', 'lines', 'total_rows'], array_keys($result));
        $this->assertMatchesRegularExpression('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/', $result['reconciliation_id']);
        $this->assertIsBool($result['replayed']);
        foreach (['created', 'updated', 'skipped', 'lines', 'total_rows'] as $counter) {
            $this->assertIsInt($result[$counter], $counter);
        }
        foreach ($listed->json('data') as $item) {
            $this->assertArrayNotHasKey('partner', $item);
            $this->assertArrayNotHasKey('partner_name', $item);
            $this->assertArrayNotHasKey('lines', $item);
            $this->assertArrayNotHasKey('rows', $item);
        }

        // سحب partners.view بعد اكتمال التشغيلة يسري فوراً على القراءة.
        app(TenantContext::class)->set($this->auth['tenant_id']);
        Role::query()->where('slug', 'ps-job-both')->update(['permissions' => ['partner_statements.view']]);
        $this->withToken($viewAndPartners)->getJson("/api/import-jobs/{$job['id']}")->assertForbidden();
        $this->assertSame([], $this->withToken($viewAndPartners)->getJson('/api/import-jobs')->assertOk()->json('data'));
        $this->assertSame(['partners.view'], ImportJobDomain::alsoRequires('partner_statement'));
        $this->assertSame([], ImportJobDomain::alsoRequires('expense_import'));
    }

    /** @test */
    public function a_user_who_loses_partner_visibility_before_apply_stores_nothing(): void
    {
        $token = $this->role('ps-both-2', ['partner_statements.reconcile', 'partners.view'], 'both2@ps-a1.test');
        $job = $this->createJob($token, $this->rows(), $this->hdr())->assertCreated()->json('data');

        app(TenantContext::class)->set($this->auth['tenant_id']);
        Role::query()->where('slug', 'ps-both-2')->update(['permissions' => ['partner_statements.reconcile']]);

        // بوابة المجال (`partners.view` الإضافية) ترفض قبل الخدمة؛ ولو تجاوزتها الخدمةُ نفسُها تعيد الفحص (assertAccess) فلا يُخزَّن شيء.
        $this->withToken($token)->postJson("/api/import-jobs/{$job['id']}/apply", [])->assertForbidden();
        $this->assertSame(0, $this->reconciliations());
        $this->assertSame('ready', (string) (ImportJob::query()->findOrFail($job['id'])->status->value ?? ImportJob::query()->findOrFail($job['id'])->status));
    }

    /**
     * PS-A2a (D-PS-08): بوابة القدرة `accounting.partner_statements` تحكم تشغيلات الاستيراد الدائم لهذا المجال بنفس منطق المسارات الثابتة
     * (`ImportJobAccess` ← `EnsureApplicationActive::authorize`): المعطّلة تمنع القراءة والترحيل وتُخفي التشغيلة من القائمة، والتفعيل يعيدها.
     *
     * @test
     */
    public function a_disabled_application_blocks_statement_jobs_and_enabling_restores_them(): void
    {
        $token = $this->auth['token'];
        $job = $this->createJob($token, $this->rows(), $this->hdr())->assertCreated()->json('data');
        $applications = app(\App\Services\TenantApplicationService::class);

        $applications->disable('accounting.partner_statements', null);

        $this->withToken($token)->getJson("/api/import-jobs/{$job['id']}")->assertForbidden();
        $this->withToken($token)->postJson("/api/import-jobs/{$job['id']}/apply", [])->assertForbidden();
        $this->assertNotContains($job['id'], array_column($this->withToken($token)->getJson('/api/import-jobs')->assertOk()->json('data'), 'id'), 'القائمة لا تعرض تشغيلات قدرة معطّلة.');
        $this->assertSame(0, $this->reconciliations(), 'لا كتابة وراء بوابة معطّلة.');

        $applications->enable('accounting.partner_statements', null);

        $this->withToken($token)->getJson("/api/import-jobs/{$job['id']}")->assertOk();
        $this->assertContains($job['id'], array_column($this->withToken($token)->getJson('/api/import-jobs')->assertOk()->json('data'), 'id'));
        $this->withToken($token)->postJson("/api/import-jobs/{$job['id']}/apply", [])->assertOk();
        $this->assertSame(1, $this->reconciliations());
    }

    /** @test */
    public function a_suspended_application_keeps_statement_jobs_readable_but_refuses_new_ones(): void
    {
        $token = $this->auth['token'];
        $binding = $this->bind($token, $this->rows(), $this->hdr());
        $done = $this->runJob($token, $this->rows(), $this->hdr(['period_to' => '2026-10-31']));
        $applications = app(\App\Services\TenantApplicationService::class);

        // كشف مستورد ⇒ الإيقاف يصبح تعليقاً (قراءة فقط).
        $this->assertSame('suspended', $applications->disable('accounting.partner_statements', null)->status);

        $this->withToken($token)->getJson("/api/import-jobs/{$done['id']}")->assertOk();
        $this->assertContains($done['id'], array_column($this->withToken($token)->getJson('/api/import-jobs')->assertOk()->json('data'), 'id'));
        $this->createJob($token, $this->rows(), $this->hdr(), $binding)->assertForbidden();
        $this->assertSame(1, $this->reconciliations());
    }

    /** @test */
    public function an_unavailable_partner_gets_one_identical_refusal_for_every_cause(): void
    {
        $other = $this->registerTenant('ps-a1-other', 'owner@ps-a1-other.test');
        app(TenantContext::class)->set($other['tenant_id']);
        $foreign = Partner::create(['type' => 'customer', 'entity_type' => 'commercial', 'name' => 'عميل مؤسسة أخرى', 'is_active' => true]);
        app(TenantContext::class)->set($this->auth['tenant_id']);

        $messages = [];
        foreach ([
            'foreign tenant' => $this->hdr(['partner_id' => $foreign->id]),
            'unknown id' => $this->hdr(['partner_id' => (string) Str::uuid()]),
            'supplier as customer' => $this->hdr(['partner_id' => $this->supplier->id]),
            'customer as supplier' => $this->hdr(['role' => 'supplier']),
        ] as $label => $options) {
            $res = $this->preview($this->auth['token'], $this->rows(), $options)->assertStatus(422);
            $messages[$label] = $res->json('message');
            $this->assertStringNotContainsString($foreign->name, (string) $res->getContent(), $label);
        }
        $this->assertSame(1, count(array_unique($messages)), json_encode($messages, JSON_UNESCAPED_UNICODE));

        $this->preview($this->auth['token'], $this->rows(), $this->hdr(['partner_id' => $this->both->id, 'role' => 'supplier']))->assertOk();
        $this->preview($this->auth['token'], $this->rows(), $this->hdr(['partner_id' => $this->both->id, 'role' => 'customer']))->assertOk();
        $this->preview($this->auth['token'], $this->rows(), $this->hdr(['partner_id' => $this->supplier->id, 'role' => 'supplier']))->assertOk();
    }

    /** @test */
    public function reconciliations_and_lines_never_cross_tenants_and_a_foreign_binding_is_refused(): void
    {
        $this->runJob($this->auth['token'], $this->rows(), $this->hdr());
        $binding = $this->bind($this->auth['token'], $this->rows(), $this->hdr());
        $other = $this->registerTenant('ps-a1-iso', 'owner@ps-a1-iso.test');

        app(TenantContext::class)->set($other['tenant_id']);
        $this->assertSame(0, PartnerStatementReconciliation::query()->count());
        $this->assertSame(0, PartnerStatementLine::query()->count());
        $this->assertSame(1, PartnerStatementReconciliation::withoutGlobalScopes()->count());

        $this->upload($other['token'], '/api/import-jobs', ['domain' => 'partner_statement', 'file' => $this->file($this->rows()), 'options' => $this->hdr(), 'preview_id' => $binding['id'], 'preview_hash' => $binding['hash']])->assertStatus(422);
        $this->assertSame(1, PartnerStatementReconciliation::withoutGlobalScopes()->count());
    }

    // ═══════════════════════════════ الفروع (P-5) ═══════════════════════════════

    /** @test */
    public function the_optional_branch_filter_is_frozen_and_must_be_inside_the_actors_scope(): void
    {
        $inside = Branch::create(['code' => 'PS-IN', 'name' => 'فرع داخل']);
        $outside = Branch::create(['code' => 'PS-OUT', 'name' => 'فرع خارج']);
        $token = $this->role('ps-branch', ['partner_statements.reconcile', 'partners.view'], 'branch@ps-a1.test');
        User::query()->where('email', 'branch@ps-a1.test')->firstOrFail()->branches()->sync([$inside->id]);

        $this->preview($token, $this->rows(), $this->hdr(['branch_id' => $inside->id]))->assertOk()->assertJsonPath('data.policy.branch_id', $inside->id);
        $res = $this->preview($token, $this->rows(), $this->hdr(['branch_id' => $outside->id]))->assertStatus(422);
        $this->assertSame('هذا الفرع خارج نطاق صلاحياتك.', $res->json('message'));
        $this->preview($token, $this->rows(), $this->hdr(['branch_id' => (string) Str::uuid()]))->assertStatus(422);
        // غير المقيَّد يرى كل الفروع، والفلتر اختياري (P-5).
        $this->preview($this->auth['token'], $this->rows(), $this->hdr(['branch_id' => $outside->id]))->assertOk();
        $this->assertNull($this->preview($token, $this->rows(), $this->hdr())->assertOk()->json('data.policy.branch_id'));

        $this->runJob($this->auth['token'], $this->rows(), $this->hdr(['branch_id' => $inside->id]));
        $this->assertSame($inside->id, PartnerStatementReconciliation::query()->firstOrFail()->policy['branch_id']);
    }

    // ═══════════════════════════════ الجدار والثبات ═══════════════════════════════

    /** @test */
    public function the_track_a_wall_no_financial_writer_is_referenced_by_the_feature(): void
    {
        $files = [
            'app/Services/PartnerStatementImportService.php', 'app/Services/PartnerStatementImportAdapter.php',
            'app/Http/Controllers/Api/PartnerStatementImportController.php', 'app/Http/Requests/PartnerStatementImportRequest.php',
            'app/Models/PartnerStatementReconciliation.php', 'app/Models/PartnerStatementLine.php',
            'app/Support/PartnerStatementCellParser.php', 'app/Support/PartnerStatementImportFields.php',
        ];
        $forbidden = ['LedgerService', 'JournalEntry', 'JournalLine', 'journal_entries', 'journal_lines', 'InventoryService', 'StockMovement', 'Zatca', 'InvoiceService', 'PaymentService',
            'PurchaseService', 'ExpenseService', 'CreditNoteService', 'ReturnService', 'PartnerService', 'Invoice::', 'Payment::', 'Purchase::', 'Expense::'];
        foreach ($files as $file) {
            // الشيفرة وحدها: التعليقات التوثيقية تشرح الجدار فتذكر أسماء الخدمات المحظورة.
            $source = '';
            foreach (token_get_all((string) file_get_contents(base_path($file))) as $token) {
                if (is_array($token) && in_array($token[0], [T_COMMENT, T_DOC_COMMENT], true)) {
                    continue;
                }
                $source .= is_array($token) ? $token[1] : $token;
            }
            foreach ($forbidden as $needle) {
                $this->assertStringNotContainsString($needle, $source, "{$file} يذكر {$needle}");
            }
        }
    }

    /** @test */
    public function imported_lines_are_immutable(): void
    {
        $this->runJob($this->auth['token'], $this->rows(), $this->hdr());
        $line = PartnerStatementLine::query()->firstOrFail();

        try {
            $line->update(['debit_minor' => 1]);
            $this->fail('كان يجب أن يُرفض تعديل السطر.');
        } catch (\LogicException $e) {
            $this->assertStringContainsString('غير قابلة للتعديل', $e->getMessage());
        }
        $this->assertSame(115000, (int) PartnerStatementLine::query()->orderBy('ordinal')->firstOrFail()->debit_minor);
    }

    /** @test */
    public function the_migration_refuses_to_roll_back_while_statements_exist(): void
    {
        $this->runJob($this->auth['token'], $this->rows(), $this->hdr());
        $migration = require base_path('database/migrations/2026_12_25_010000_create_partner_statement_tables.php');

        $this->expectException(\RuntimeException::class);
        $migration->down();
    }

    /** @test */
    public function xlsx_files_and_quoted_formula_looking_cells_round_trip_through_the_parser(): void
    {
        $rows = $this->rows();
        $rows[0]['رقم المستند'] = "'-INV-9";
        $preview = $this->preview($this->auth['token'], $rows, $this->hdr())->assertOk()->json('data');

        $this->assertSame('-INV-9', $preview['rows'][0]['reference']);
    }
}
