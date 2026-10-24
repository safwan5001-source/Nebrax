<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\CostCenter;
use App\Models\Expense;
use App\Models\ExpenseCategory;
use App\Models\ImportDocumentReservation;
use App\Models\ImportJob;
use App\Models\JournalEntry;
use App\Models\Partner;
use App\Services\Accounting\ExpenseService;
use App\Services\ExpenseImportAdapter;
use App\Services\ExpenseImportService;
use App\Support\ExpenseImportFields;
use App\Support\ImportChunk;
use App\Support\ImportPlanDriftException;
use App\Support\ImportUnitFailureException;
use App\Support\SpreadsheetWriter;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use RuntimeException;
use Tests\TestCase;

/**
 * IMP-H5-S1c — استيراد المصروفات مسوداتٍ: العقد، المراجع بمعرّفات موثوقة، القيم، منع التكرار (داخل الملف/القائم/المؤكَّد)، الاشتقاق، وعدم أي أثر محاسبي. المحوّل مسجَّل منذ IMP-H5-S2 (انظر H5ImportEndpointsTest للنقاط والمهام).
 *
 * تشغيل: php artisan test --filter=ExpenseImportTest
 */
class ExpenseImportTest extends TestCase
{
    use CapturesThrowable;
    use InteractsWithApi;
    use RefreshDatabase;

    private string $tenantId;

    protected function setUp(): void
    {
        parent::setUp();
        $auth = $this->registerTenant();
        $this->tenantId = $auth['tenant_id'];
        app(TenantContext::class)->set($this->tenantId);
    }

    private function service(): ExpenseImportService
    {
        return app(ExpenseImportService::class);
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

    /** @param list<array<string,string>> $rows */
    private function apply(array $rows, array $options = [], ?string $user = null): array
    {
        return $this->service()->apply($this->file($rows), $options, $user);
    }

    /** @param list<array<string,string>> $rows */
    private function preview(array $rows, array $options = []): array
    {
        return $this->service()->preview($this->file($rows), $options);
    }

    private function messages(array $preview, int $index = 0): string
    {
        return implode(' | ', $preview['rows'][$index]['messages']);
    }

    // ═══════════════════════════════ العقد ═══════════════════════════════

    /** @test */
    public function the_contract_has_no_derived_posting_or_system_fields(): void
    {
        foreach (['tax_amount', 'total', 'status', 'journal_entry_id', 'number', 'tenant_id', 'branch_id', 'created_by', 'account_id', 'attachments'] as $forbidden) {
            $this->assertNotContains($forbidden, ExpenseImportFields::keys(), $forbidden);
        }
        $this->assertSame(['expense_date', 'amount'], array_keys(array_filter(ExpenseImportFields::all(), fn ($f) => $f['required'])));
        $this->assertSame('amount', ExpenseImportFields::autoMap(['المبلغ قبل الضريبة'])[0]);
        $this->assertSame('account_code', ExpenseImportFields::autoMap(['كود الحساب'])[0]);
        $this->assertSame('reference', ExpenseImportFields::autoMap(['رقم الفاتورة'])[0]);
    }

    /** @test */
    public function the_template_round_trips_through_inspect(): void
    {
        $insp = $this->service()->inspect(UploadedFile::fake()->createWithContent('t.csv', $this->service()->template()));

        $this->assertSame(2, $insp['total_rows']);
        $this->assertSame(ExpenseImportFields::keys(), array_column($insp['columns'], 'suggested_field'));
    }

    // ═══════════════════════════════ الإنشاء والاشتقاق ═══════════════════════════════

    /** @test */
    public function a_row_becomes_a_draft_with_derived_tax_total_and_no_journal_entry(): void
    {
        $result = $this->apply([$this->row(['tax_rate' => '15', 'payment_method' => 'نقدي', 'reference' => 'INV-1', 'description' => 'إيجار'])], [], null);

        $this->assertSame(1, $result['created']);
        $expense = Expense::query()->firstOrFail();
        $this->assertSame('draft', $expense->status);
        $this->assertSame([100000, 15, 15000, 115000], [(int) $expense->amount, (int) $expense->tax_rate, (int) $expense->tax_amount, (int) $expense->total]);
        $this->assertSame('cash', $expense->payment_method);
        $this->assertSame('2026-10-01', $expense->expense_date->toDateString());
        $this->assertSame(0, JournalEntry::query()->count(), 'الاستيراد مسودات: لا قيد.');
        $reservation = ImportDocumentReservation::query()->firstOrFail();
        $this->assertSame(['expense', 'standard'], [$reservation->domain, $reservation->source]);
        $this->assertSame('inv1', $reservation->predicate['reference']);
    }

    /** @test */
    public function defaults_come_from_the_run_options_and_cells_override_them(): void
    {
        $account = Account::where('code', '5130')->firstOrFail();
        $this->apply(
            [['expense_date' => '2026-10-01', 'amount' => '200', 'vendor_name' => 'أ'], ['expense_date' => '2026-10-02', 'amount' => '200', 'vendor_name' => 'ب', 'tax_rate' => '0', 'payment_method' => 'bank']],
            ['default_account_id' => $account->id, 'default_payment_method' => 'credit', 'default_tax_rate' => 5],
        );

        $rows = Expense::query()->orderBy('expense_date')->get();
        $this->assertSame([5, 'credit'], [(int) $rows[0]->tax_rate, $rows[0]->payment_method]);
        $this->assertSame([0, 'bank'], [(int) $rows[1]->tax_rate, $rows[1]->payment_method]);
        $this->assertSame($account->id, $rows[0]->account_id);
    }

    /** @test */
    public function the_amount_is_in_riyals_and_converted_to_minor_units_without_floats(): void
    {
        $this->apply([$this->row(['amount' => '١٬٢٣٤٫٥٦'])]);   // أرقام عربية وفاصلا آلاف/عشري عربيان

        $this->assertSame(123456, (int) Expense::query()->firstOrFail()->amount);
    }

    /** @test */
    public function created_by_is_the_importing_user(): void
    {
        $user = \App\Models\User::query()->firstOrFail();
        $this->apply([$this->row()], [], $user->id);

        $this->assertSame($user->id, Expense::query()->firstOrFail()->created_by);
    }

    // ═══════════════════════════════ الخيارات والتعيين ═══════════════════════════════

    /** @test */
    public function the_mapping_requires_date_amount_and_an_account_source(): void
    {
        foreach ([
            [['amount' => '10', 'account_code' => '5130'], []],
            [['expense_date' => '2026-10-01', 'account_code' => '5130'], []],
            [['expense_date' => '2026-10-01', 'amount' => '10'], []],   // بلا حساب ولا افتراضي
            [['expense_date' => '2026-10-01', 'amount' => '10', 'account_code' => '5130'], ['reference_policy' => 'required']],   // مطلوب مرجع بلا عمود
        ] as [$row, $options]) {
            $this->assertInstanceOf(RuntimeException::class, $this->thrown(fn () => $this->preview([$row], $options), 'rejected', RuntimeException::class));
        }
    }

    /** @test */
    public function invalid_options_are_rejected(): void
    {
        foreach ([['reference_policy' => 'maybe'], ['default_payment_method' => 'card'], ['default_tax_rate' => 101], ['default_account_id' => 'nope'], ['confirmed_repeat_rows' => ['x']], ['mapping' => [0 => 'tax_amount']]] as $options) {
            $this->thrown(fn () => $this->preview([$this->row()], $options), json_encode($options), RuntimeException::class);
        }
    }

    /** @test */
    public function a_default_account_that_is_not_a_postable_expense_account_is_refused(): void
    {
        $this->thrown(fn () => $this->preview([['expense_date' => '2026-10-01', 'amount' => '10']], ['default_account_id' => Account::where('code', '1110')->firstOrFail()->id]), 'asset', RuntimeException::class);
    }

    // ═══════════════════════════════ المراجع ═══════════════════════════════

    /** @test */
    public function accounts_must_exist_be_expense_postable_and_active(): void
    {
        $group = Account::create(['code' => '5999', 'name' => 'مجموعة', 'type' => 'expense', 'normal_balance' => 'debit', 'is_group' => true]);
        $inactive = Account::create(['code' => '5998', 'name' => 'معطّل', 'type' => 'expense', 'normal_balance' => 'debit', 'is_active' => false]);

        $preview = $this->preview([$this->row(['account_code' => '9999']), $this->row(['account_code' => '1110', 'amount' => '2']), $this->row(['account_code' => $group->code, 'amount' => '3']), $this->row(['account_code' => $inactive->code, 'amount' => '4']), $this->row(['amount' => '5'])]);

        $this->assertSame(4, $preview['error_rows']);
        $this->assertStringContainsString('غير موجود', $this->messages($preview, 0));
        $this->assertStringContainsString('ليس حساب مصروفات', $this->messages($preview, 1));
        $this->assertStringContainsString('تجميعي', $this->messages($preview, 2));
        $this->assertStringContainsString('معطّل', $this->messages($preview, 3));
        $this->assertSame('ok', $preview['rows'][4]['status']);
    }

    /** @test */
    public function suppliers_resolve_by_code_and_must_be_suppliers(): void
    {
        $supplier = Partner::create(['code' => 'S-1', 'name' => 'مورد', 'type' => 'supplier']);
        Partner::create(['code' => 'C-1', 'name' => 'عميل', 'type' => 'customer']);

        $preview = $this->preview([$this->row(['supplier_code' => 'S-1']), $this->row(['supplier_code' => 'C-1', 'amount' => '2']), $this->row(['supplier_code' => 'X-9', 'amount' => '3'])]);

        $this->assertSame([0, 1, 1], array_map(fn ($r) => $r['valid'] ? 0 : 1, $preview['rows']));
        $this->assertStringContainsString('ليس مورّداً', $this->messages($preview, 1));
        $this->assertStringContainsString('غير موجود', $this->messages($preview, 2));

        $this->apply([$this->row(['supplier_code' => 'S-1'])]);
        $this->assertSame($supplier->id, Expense::query()->firstOrFail()->partner_id);
    }

    /** @test */
    public function categories_match_by_exact_active_name_and_ambiguity_is_an_error(): void
    {
        $rent = ExpenseCategory::create(['name' => 'إيجارات']);
        ExpenseCategory::create(['name' => 'صيانة', 'is_active' => false]);
        ExpenseCategory::create(['name' => 'سفر']);
        ExpenseCategory::create(['name' => ' سفر ']);

        $preview = $this->preview([$this->row(['category' => 'إيجارات']), $this->row(['category' => 'صيانة', 'amount' => '2']), $this->row(['category' => 'سفر', 'amount' => '3']), $this->row(['category' => 'لا شيء', 'amount' => '4'])]);

        $this->assertSame(3, $preview['error_rows']);
        $this->assertSame('ok', $preview['rows'][0]['status']);
        $this->assertStringContainsString('غير موجود أو غير نشط', $this->messages($preview, 1));
        $this->assertStringContainsString('أكثر من تصنيف', $this->messages($preview, 2));
        $this->assertStringContainsString('غير موجود أو غير نشط', $this->messages($preview, 3));

        $this->apply([$this->row(['category' => 'إيجارات', 'amount' => '77'])]);
        $this->assertSame($rent->id, Expense::query()->where('amount', 7700)->firstOrFail()->category_id);
    }

    /** @test */
    public function cost_centers_resolve_by_code_and_must_be_active(): void
    {
        $center = CostCenter::create(['code' => 'CC-1', 'name' => 'المبيعات', 'is_active' => true]);
        CostCenter::create(['code' => 'CC-2', 'name' => 'معطل', 'is_active' => false]);

        $preview = $this->preview([$this->row(['cost_center_code' => 'CC-1']), $this->row(['cost_center_code' => 'CC-2', 'amount' => '2']), $this->row(['cost_center_code' => 'CC-9', 'amount' => '3'])]);
        $this->assertSame([true, false, false], array_column($preview['rows'], 'valid'));

        $this->apply([$this->row(['cost_center_code' => 'CC-1'])]);
        $this->assertSame($center->id, Expense::query()->firstOrFail()->cost_center_id);
    }

    // ═══════════════════════════════ القيم ═══════════════════════════════

    /** @test */
    public function dates_accept_iso_day_first_arabic_digits_and_excel_serials_and_reject_the_rest(): void
    {
        $rows = [];
        foreach (['2026-10-05', '06/10/2026', '٠٧-١٠-٢٠٢٦', '2026/10/08', '46304.5'] as $i => $date) {
            $rows[] = $this->row(['expense_date' => $date, 'amount' => (string) ($i + 1)]);
        }
        $this->apply($rows);
        $this->assertSame(['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09'],
            Expense::query()->orderBy('expense_date')->get()->map(fn ($e) => $e->expense_date->toDateString())->all());

        $bad = $this->preview(array_map(fn ($d, $i) => $this->row(['expense_date' => $d, 'amount' => (string) ($i + 1)]), ['2026-02-30', '13/13/2026', '1999-01-01', 'غدا'], [0, 1, 2, 3]));
        $this->assertSame(4, $bad['error_rows']);
        $this->assertStringContainsString('التاريخ غير صالح', $this->messages($bad, 0));
    }

    /** @test */
    public function amounts_must_be_positive_and_well_formed(): void
    {
        $preview = $this->preview([$this->row(['amount' => '0']), $this->row(['amount' => '-5', 'vendor_name' => 'ب']), $this->row(['amount' => '1.234', 'vendor_name' => 'ج']), $this->row(['amount' => 'abc', 'vendor_name' => 'د']), $this->row(['amount' => '99999999999', 'vendor_name' => 'هـ'])]);

        $this->assertSame(5, $preview['error_rows']);
    }

    /** @test */
    public function a_european_decimal_comma_is_refused_instead_of_being_read_as_thousands(): void
    {
        $preview = $this->preview([$this->row(['amount' => '85,50']), $this->row(['amount' => '85,5', 'vendor_name' => 'ب']), $this->row(['amount' => '1,234.50', 'vendor_name' => 'ج']), $this->row(['amount' => '1,234', 'vendor_name' => 'د'])]);

        $this->assertSame([false, false, true, true], array_column($preview['rows'], 'valid'));
    }

    /** @test */
    public function codes_of_another_tenant_never_resolve(): void
    {
        $other = $this->registerTenant('other', 'o@other.test');
        app(TenantContext::class)->set($other['tenant_id']);
        Account::create(['code' => '5777', 'name' => 'حساب غيري', 'type' => 'expense', 'normal_balance' => 'debit']);
        Partner::create(['code' => 'S-OTH', 'name' => 'مورد غيري', 'type' => 'supplier']);
        CostCenter::create(['code' => 'CC-OTH', 'name' => 'مركز غيري', 'is_active' => true]);
        ExpenseCategory::create(['name' => 'تصنيف غيري']);
        app(TenantContext::class)->set($this->tenantId);

        $preview = $this->preview([$this->row(['account_code' => '5777']), $this->row(['supplier_code' => 'S-OTH', 'amount' => '2']), $this->row(['cost_center_code' => 'CC-OTH', 'amount' => '3']), $this->row(['category' => 'تصنيف غيري', 'amount' => '4'])]);

        $this->assertSame(4, $preview['error_rows']);
    }

    /** @test */
    public function payment_methods_accept_arabic_aliases_and_reject_unknown(): void
    {
        $this->apply([$this->row(['payment_method' => 'تحويل بنكي', 'vendor_name' => 'أ']), $this->row(['payment_method' => 'آجل', 'vendor_name' => 'ب']), $this->row(['payment_method' => 'كاش', 'vendor_name' => 'ج'])]);
        $this->assertSame(['bank', 'cash', 'credit'], Expense::query()->orderBy('payment_method')->pluck('payment_method')->all());

        $this->assertSame(1, $this->preview([$this->row(['payment_method' => 'بطاقة', 'vendor_name' => 'د', 'amount' => '9'])])['error_rows']);
    }

    /** @test */
    public function the_tax_rate_is_bounded_between_0_and_100(): void
    {
        $preview = $this->preview([$this->row(['tax_rate' => '101']), $this->row(['tax_rate' => '7.5', 'vendor_name' => 'ب'])]);
        $this->assertSame(2, $preview['error_rows']);
    }

    /** @test */
    public function reference_policy_required_rejects_reference_less_rows(): void
    {
        $preview = $this->preview([$this->row(['reference' => 'R-1']), $this->row(['reference' => '', 'vendor_name' => 'ب']), $this->row(['reference' => '---', 'vendor_name' => 'ج'])], ['reference_policy' => 'required']);

        $this->assertSame([true, false, false], array_column($preview['rows'], 'valid'));
        $this->assertStringContainsString('رقم المرجع', $this->messages($preview, 1));

        $this->assertSame(0, $this->preview([$this->row(['reference' => ''])])['error_rows'], 'الافتراضي optional.');
    }

    // ═══════════════════════════════ منع التكرار ═══════════════════════════════

    /** @test */
    public function reference_less_rows_still_reserve_their_identity(): void
    {
        $this->apply([$this->row()]);

        $this->assertSame(1, ImportDocumentReservation::query()->count());
        $this->assertNull(ImportDocumentReservation::query()->firstOrFail()->predicate['reference']);
    }

    /** @test */
    public function an_unconfirmed_duplicate_inside_the_file_is_a_row_error_and_fails_the_file_at_the_first_chunk(): void
    {
        $rows = [$this->row(['reference' => 'A']), $this->row(['reference' => 'B']), $this->row(['vendor_name' => 'آخر'])];

        $preview = $this->preview($rows);
        $this->assertSame(1, $preview['error_rows']);
        $this->assertStringContainsString('سبق في الصف 2', $this->messages($preview, 1));

        // الملف كله يُرفض ولا يُكتب شيء حتى لو كان التكرار في نافذة لاحقة
        $e = $this->thrown(fn () => $this->service()->apply($this->file($rows), ['batch_offset' => 0, 'batch_size' => 1]), 'file dup', ImportUnitFailureException::class);
        $this->assertSame('row_duplicate_in_file', $e->failures[0]['code']);
        $this->assertSame(0, Expense::query()->count());
    }

    /** @test */
    public function the_same_vendor_date_and_amount_with_different_references_is_still_a_duplicate_like_the_service_guard(): void
    {
        $preview = $this->preview([$this->row(['reference' => 'A']), $this->row(['reference' => 'B'])]);
        $this->assertSame(1, $preview['error_rows']);
        $this->assertSame([false, true], array_column($preview['rows'], 'repeat_candidate'), 'الواجهة تعرض خيار التأكيد للصف المكرَّر وحده.');
        $this->assertSame([3], array_column($preview['repeat_candidates'], 'row'));
    }

    /** @test */
    public function an_existing_expense_blocks_the_row_and_confirmation_overrides_it(): void
    {
        $this->apply([$this->row()]);

        $blocked = $this->preview([$this->row()]);
        $this->assertSame(1, $blocked['error_rows']);
        $this->assertStringContainsString('يوجد مصروف مطابق', $this->messages($blocked));
        $e = $this->thrown(fn () => $this->apply([$this->row()]), 'existing', ImportUnitFailureException::class);
        $this->assertSame('row_invalid', $e->failures[0]['code']);
        $this->assertSame(1, Expense::query()->count());

        $this->apply([$this->row()], ['confirmed_repeat_rows' => [2], 'occurrence_scope' => 'job-1']);
        $this->assertSame(2, Expense::query()->count());
        $this->assertSame(2, ImportDocumentReservation::query()->count());
    }

    /** @test */
    public function an_existing_manual_expense_without_a_reservation_is_also_detected(): void
    {
        app(ExpenseService::class)->create(['account_id' => Account::where('code', '5130')->firstOrFail()->id, 'amount' => 100000, 'vendor_name' => ' شركة   الأمل ', 'expense_date' => '2026-10-01', 'number' => 'EXP-M-1']);

        $this->assertSame(1, $this->preview([$this->row()])['error_rows']);
    }

    /** @test */
    public function a_different_vendor_date_or_amount_is_not_a_duplicate(): void
    {
        $this->apply([$this->row()]);

        $preview = $this->preview([$this->row(['vendor_name' => 'غيره']), $this->row(['expense_date' => '2026-10-02']), $this->row(['amount' => '1000.01'])]);
        $this->assertSame(0, $preview['error_rows']);
    }

    /** @test */
    public function a_registered_supplier_is_identified_by_id_not_by_vendor_text(): void
    {
        Partner::create(['code' => 'S-1', 'name' => 'مورد', 'type' => 'supplier']);
        $this->apply([$this->row(['supplier_code' => 'S-1', 'vendor_name' => 'اسم أول'])]);

        $this->assertSame(1, $this->preview([$this->row(['supplier_code' => 'S-1', 'vendor_name' => 'اسم آخر'])])['error_rows']);
        $this->assertSame(0, $this->preview([$this->row(['vendor_name' => 'اسم أول'])])['error_rows'], 'مصروف بلا طرف مسجَّل هوية مختلفة.');
    }

    /** @test */
    public function confirmed_repeats_create_independent_expenses_with_deterministic_occurrence_ids(): void
    {
        $rows = [$this->row(), $this->row()];
        $result = $this->apply($rows, ['confirmed_repeat_rows' => [3], 'occurrence_scope' => 'job-A']);

        $this->assertSame(2, $result['created']);
        $this->assertSame(2, Expense::query()->count());
        $occurrences = ImportDocumentReservation::query()->get()->map(fn ($r) => $r->predicate['occurrence'])->all();
        $this->assertCount(1, array_filter($occurrences, fn ($o) => $o === null), 'الأول بلا معرّف تمييز.');
        $this->assertContains(substr(hash('sha256', 'job-A|3'), 0, 32), $occurrences);
    }

    /** @test */
    public function replaying_a_confirmed_chunk_with_the_same_scope_cannot_create_a_second_expense(): void
    {
        $rows = [$this->row()];
        $this->apply($rows, ['confirmed_repeat_rows' => [2], 'occurrence_scope' => 'job-A']);

        // المصروف القائم نفسه + المعرّف نفسه ⇒ رفض الخدمة (لا مصروف ثانٍ) بفشل صفٍّ مسمّى
        $e = $this->thrown(fn () => $this->apply($rows, ['confirmed_repeat_rows' => [2], 'occurrence_scope' => 'job-A']), 'replay', ImportUnitFailureException::class);
        $this->assertSame('duplicate_document', $e->failures[0]['code']);
        $this->assertSame(1, Expense::query()->count());

        // مهمة جديدة = نطاق جديد = تأكيد جديد
        $this->apply($rows, ['confirmed_repeat_rows' => [2], 'occurrence_scope' => 'job-B']);
        $this->assertSame(2, Expense::query()->count());
    }

    /** @test */
    public function a_confirmation_without_a_detected_repeat_warns_but_still_creates_one_expense(): void
    {
        $preview = $this->preview([$this->row()], ['confirmed_repeat_rows' => [2]]);

        $this->assertSame('warning', $preview['rows'][0]['status']);
        $this->assertSame(1, $preview['create_rows']);
    }

    // ═══════════════════════════════ التطبيق والنوافذ ═══════════════════════════════

    /** @test */
    public function errors_block_the_whole_window_and_nothing_is_written(): void
    {
        $e = $this->thrown(fn () => $this->apply([$this->row(), $this->row(['account_code' => '9999', 'vendor_name' => 'ب'])]), 'errors', ImportUnitFailureException::class);

        $this->assertSame([1], array_column($e->failures, 'ordinal'));
        $this->assertSame(0, Expense::query()->count());
        $this->assertSame(0, ImportDocumentReservation::query()->count());
    }

    /** @test */
    public function windows_write_only_their_rows_and_ordinals_count_data_rows(): void
    {
        $rows = [$this->row(['amount' => '1', 'vendor_name' => 'أ']), $this->row(['amount' => '2', 'vendor_name' => 'ب']), $this->row(['amount' => '3', 'vendor_name' => 'ج'])];

        $first = $this->service()->apply($this->file($rows), ['batch_offset' => 0, 'batch_size' => 2]);
        $second = $this->service()->apply($this->file($rows), ['batch_offset' => 2, 'batch_size' => 2]);

        $this->assertSame([2, 1, 3], [$first['created'], $second['created'], $first['total_rows']]);
        $this->assertSame(3, Expense::query()->count());
    }

    /** @test */
    public function blank_rows_between_data_rows_do_not_shift_ordinals_or_sheet_row_numbers(): void
    {
        $csv = "التاريخ,المبلغ قبل الضريبة,كود حساب المصروف,اسم البائع\n2026-10-01,1,5130,أ\n,,,\n2026-10-02,2,9999,ب\n";
        $preview = $this->service()->preview(UploadedFile::fake()->createWithContent('b.csv', $csv), []);

        $this->assertSame([2, 4], array_column($preview['rows'], 'row'));
        $e = $this->thrown(fn () => $this->service()->apply(UploadedFile::fake()->createWithContent('b.csv', $csv), []), 'blank', ImportUnitFailureException::class);
        $this->assertSame([1], array_column($e->failures, 'ordinal'));
    }

    /** @test */
    public function a_confirmed_row_in_a_later_window_is_honoured(): void
    {
        $rows = [$this->row(), $this->row(), $this->row(['amount' => '5', 'vendor_name' => 'ثالث'])];
        $options = ['confirmed_repeat_rows' => [3], 'occurrence_scope' => 'job-W'];

        $first = $this->service()->apply($this->file($rows), $options + ['batch_offset' => 0, 'batch_size' => 1]);
        $second = $this->service()->apply($this->file($rows), $options + ['batch_offset' => 1, 'batch_size' => 2]);

        $this->assertSame([1, 2], [$first['created'], $second['created']]);
        $this->assertSame(3, Expense::query()->count());
    }

    /** @test */
    public function the_plan_binds_the_preview_and_a_later_conflict_is_plan_drift(): void
    {
        $withPlan = $this->service()->previewWithPlan($this->file([$this->row()]), []);
        $this->assertSame([2 => 'c'], $withPlan['plan']);

        $this->apply([$this->row()]);   // يظهر مصروف مطابق بعد المعاينة

        $e = $this->thrown(fn () => $this->service()->apply($this->file([$this->row()]), ['expected_plan' => $withPlan['plan']]), 'drift', ImportPlanDriftException::class);
        $this->assertInstanceOf(ImportPlanDriftException::class, $e);
        $this->assertSame(1, Expense::query()->count());
    }

    /** @test */
    public function an_empty_file_or_header_only_file_is_refused(): void
    {
        $this->thrown(fn () => $this->service()->apply(UploadedFile::fake()->createWithContent('e.csv', ''), []), 'empty', RuntimeException::class);
        $this->assertSame(0, $this->service()->apply($this->file([$this->row()]), ['batch_offset' => 5])['created'], 'نافذة بعد نهاية الملف لا تكتب شيئاً.');
    }

    /** @test */
    public function a_row_wider_than_the_header_is_an_error(): void
    {
        $csv = "التاريخ,المبلغ قبل الضريبة,كود حساب المصروف\n2026-10-01,100,5130,زائد\n";
        $preview = $this->service()->preview(UploadedFile::fake()->createWithContent('w.csv', $csv), []);

        $this->assertSame(1, $preview['error_rows']);
    }

    /** @test */
    public function repeat_candidates_are_listed_even_beyond_the_truncated_preview_rows(): void
    {
        $rows = [];
        for ($i = 1; $i <= 205; $i++) {
            $rows[] = $this->row(['amount' => (string) $i, 'vendor_name' => 'مورد '.$i]);
        }
        $rows[] = $this->row(['amount' => '7', 'vendor_name' => 'مورد 7']);   // الصف 207: تكرار للصف 8

        $preview = $this->preview($rows);

        $this->assertTrue($preview['rows_truncated']);
        $this->assertSame([207], array_column($preview['repeat_candidates'], 'row'));
        $this->assertNotContains(207, array_column($preview['rows'], 'row'));
        $confirmed = $this->preview($rows, ['confirmed_repeat_rows' => [207]]);
        $this->assertSame([207], array_column($confirmed['repeat_candidates'], 'row'));
        $this->assertTrue($confirmed['repeat_candidates'][0]['confirmed_repeat']);
    }

    /** @test */
    public function confirmed_candidates_never_hide_unconfirmed_ones_beyond_the_cap(): void
    {
        $rows = [];
        for ($i = 1; $i <= 210; $i++) {
            $rows[] = $this->row(['amount' => (string) $i, 'vendor_name' => 'مورد '.$i]);
        }
        for ($i = 1; $i <= 205; $i++) {   // 205 تكراراً للصفوف 2..206 ⇒ مرشّحة في الصفوف 212..416
            $rows[] = $this->row(['amount' => (string) $i, 'vendor_name' => 'مورد '.$i]);
        }
        $firstBatch = range(212, 411);

        $preview = $this->preview($rows);
        $this->assertSame($firstBatch, array_column($preview['repeat_candidates'], 'row'), 'الدفعة الأولى: أول 200 مرشَّح.');

        $next = $this->preview($rows, ['confirmed_repeat_rows' => $firstBatch]);
        $unconfirmed = array_values(array_filter($next['repeat_candidates'], fn ($r) => ! $r['confirmed_repeat']));
        $this->assertSame(range(412, 416), array_column($unconfirmed, 'row'), 'المؤكَّد لا يحجب الباقي: يظهر الخمسة المتبقية أولاً.');
        $this->assertSame(range(412, 416), array_slice(array_column($next['repeat_candidates'], 'row'), 0, 5));
    }

    /** @test */
    public function the_preview_totals_the_creatable_amount_in_minor_units(): void
    {
        $preview = $this->preview([$this->row(['amount' => '10.50', 'vendor_name' => 'أ']), $this->row(['amount' => '1', 'vendor_name' => 'ب']), $this->row(['account_code' => '9999', 'amount' => '500', 'vendor_name' => 'ج'])]);

        $this->assertSame(1150, $preview['create_amount_minor']);
        $this->assertSame([2, 1], [$preview['create_rows'], $preview['error_rows']]);
    }

    // ═══════════════════════════════ المحوّل ═══════════════════════════════

    /** @test */
    public function the_adapter_declares_row_units_canonical_options_and_no_sensitive_columns(): void
    {
        $adapter = app(ExpenseImportAdapter::class);

        $this->assertSame('expense_import', $adapter->domain());
        $this->assertSame($adapter::UNIT_ROW, $adapter->unit());
        $this->assertSame(ExpenseImportService::DURABLE_MAX_ROWS, $adapter->maxRows());
        $this->assertSame([], $adapter->sensitiveColumnIndexes(['a'], []));
        // قيمٌ فاسدة لا تُحوَّل صامتةً إلى أصفار: تبقى كما وردت فيرفضها `options()` عند المعاينة/التنفيذ
        $bad = $adapter->canonicalOptions(['default_tax_rate' => '', 'confirmed_repeat_rows' => ['3.9', 'x']]);
        $this->assertSame('', $bad['default_tax_rate']);
        $this->assertSame(['3.9', 'x'], $bad['confirmed_repeat_rows']);
        $this->thrown(fn () => $this->service()->options($bad), 'tax', RuntimeException::class);
        $this->assertSame(
            ['reference_policy' => 'required', 'default_account_id' => '', 'default_payment_method' => 'cash', 'default_tax_rate' => 15, 'confirmed_repeat_rows' => [3, 5], 'mapping' => ['0' => 'amount', '1' => 'expense_date']],
            $adapter->canonicalOptions(['reference_policy' => 'required', 'confirmed_repeat_rows' => [5, '3', 3], 'mapping' => [1 => 'expense_date', 0 => 'amount'], 'junk' => 1, 'occurrence_scope' => 'forged']),
        );
    }

    /** @test */
    public function the_adapter_chunk_scopes_occurrence_ids_to_the_job(): void
    {
        $job = new ImportJob;
        $job->id = '11111111-1111-4111-8111-111111111111';
        $chunk = new ImportChunk($job, $this->file([$this->row(), $this->row()]), null, ['confirmed_repeat_rows' => [3], 'occurrence_scope' => 'forged'], 0, 100, null, true);

        $result = app(ExpenseImportAdapter::class)->applyChunk($chunk);

        $this->assertSame(2, $result->processedUnits);
        $this->assertTrue(ImportDocumentReservation::query()->get()->contains(fn ($r) => ($r->predicate['occurrence'] ?? null) === substr(hash('sha256', $job->getKey().'|3'), 0, 32)));
        $this->assertFalse(ImportDocumentReservation::query()->get()->contains(fn ($r) => ($r->predicate['occurrence'] ?? null) === substr(hash('sha256', 'forged|3'), 0, 32)));
    }

    /** @test */
    public function the_adapter_is_registered_with_the_gates_of_the_direct_expense_route(): void
    {
        $this->assertTrue(app(\App\Services\ImportDomainRegistry::class)->has('expense_import'));
        $this->assertSame(
            ['view' => 'expenses.view', 'manage' => 'expenses.manage', 'app' => 'finance.operations'],
            \App\Support\ImportJobDomain::authorization('expense_import'),
        );
        $this->assertContains('expense_import', \App\Support\ImportJobDomain::PREVIEW_BOUND_ONLY);
    }

    /** @test */
    public function the_import_never_touches_the_ledger_or_posting_paths(): void
    {
        $root = dirname(__DIR__, 2);
        foreach (['app/Services/ExpenseImportService.php', 'app/Services/ExpenseImportAdapter.php', 'app/Support/ExpenseImportFields.php'] as $file) {
            $source = (string) file_get_contents($root.'/'.$file);
            foreach (['LedgerService', 'journal_lines', 'journal_entries', '->post(', 'JournalEntry'] as $needle) {
                $this->assertStringNotContainsString($needle, $source, "$file: $needle");
            }
        }
    }
}
