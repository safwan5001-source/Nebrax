<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Expense;
use App\Models\ImportDocumentReservation;
use App\Services\Accounting\ExpenseService;
use App\Services\DocumentDuplicateReservationService as Dup;
use App\Support\DuplicateDocumentException;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * IMP-H5-S1b — ربط حجز الهوية بخدمة المصروفات: الإنشاء/التعديل/الحذف، وسياسة `finance.duplicate_reference_policy` (allow الافتراضي = السلوك القديم حرفياً).
 */
class ExpenseDuplicateReservationTest extends TestCase
{
    use CapturesThrowable;
    use InteractsWithApi;
    use RefreshDatabase;

    private array $auth;

    private string $accountId;

    protected function setUp(): void
    {
        parent::setUp();
        $this->auth = $this->registerTenant();
        app(TenantContext::class)->set($this->auth['tenant_id']);
        $this->accountId = Account::where('code', '5130')->firstOrFail()->id;
    }

    private function body(array $over = []): array
    {
        return $over + ['account_id' => $this->accountId, 'amount' => 10000, 'tax_rate' => 15, 'vendor_name' => 'شركة الأمل', 'expense_date' => '2026-10-01'];
    }

    private function postExpense(array $over = []): \Illuminate\Testing\TestResponse
    {
        return $this->withToken($this->auth['token'])->postJson('/api/expenses', $this->body($over));
    }

    private function policy(string $value): void
    {
        $this->withToken($this->auth['token'])->putJson('/api/settings/finance', ['duplicate_reference_policy' => $value])->assertOk();
    }

    private function service(): ExpenseService
    {
        return app(ExpenseService::class);
    }

    private function reservations(): int
    {
        return ImportDocumentReservation::query()->count();
    }

    private int $seq = 0;

    /** مصروف يُنشأ مباشرةً من الخدمة (كما يفعل المستورد): رقم صريح لأن الترقيم تابع لسياق الفرع الذي يخلطه الاختبار مع طلبات API. */
    private function importData(array $over = []): array
    {
        return $this->body($over) + ['number' => 'EXP-T-'.(++$this->seq)];
    }

    /** @test */
    public function the_policy_defaults_to_allow_and_rejects_unknown_values(): void
    {
        $this->withToken($this->auth['token'])->getJson('/api/settings/finance')->assertOk()->assertJsonPath('data.duplicate_reference_policy', 'allow');
        $this->withToken($this->auth['token'])->putJson('/api/settings/finance', ['duplicate_reference_policy' => 'warn'])->assertUnprocessable();
        $this->policy('block');
        $this->withToken($this->auth['token'])->getJson('/api/settings/finance')->assertJsonPath('data.duplicate_reference_policy', 'block');
    }

    /** @test */
    public function under_allow_direct_creation_is_unchanged_and_reserves_nothing(): void
    {
        $this->postExpense()->assertCreated();
        $this->postExpense()->assertCreated();

        $this->assertSame(2, Expense::query()->count());
        $this->assertSame(0, $this->reservations());
    }

    /** @test */
    public function under_block_a_second_identical_direct_expense_is_refused_and_a_different_one_passes(): void
    {
        $this->policy('block');
        $first = $this->postExpense()->assertCreated()->json('data.id');

        $this->postExpense()->assertUnprocessable();
        $this->postExpense(['amount' => 10001])->assertCreated();
        $this->postExpense(['expense_date' => '2026-10-02'])->assertCreated();
        $this->postExpense(['vendor_name' => 'مورّد آخر'])->assertCreated();

        $this->assertSame(4, Expense::query()->count());
        $row = ImportDocumentReservation::query()->where('document_id', $first)->firstOrFail();
        $this->assertSame(Dup::SOURCE_MANUAL, $row->source);
        $this->assertSame(4, $this->reservations());
    }

    /** @test */
    public function under_block_vendor_name_comparison_ignores_case_and_spacing_but_a_partner_key_differs_from_a_name(): void
    {
        $this->policy('block');
        $this->postExpense(['vendor_name' => 'ACME  Co'])->assertCreated();
        $this->postExpense(['vendor_name' => ' acme co '])->assertUnprocessable();
    }

    /** @test */
    public function under_block_it_also_refuses_a_legacy_unreserved_duplicate(): void
    {
        $legacy = $this->postExpense()->assertCreated()->json('data.id');   // allow: بلا حجز
        $this->assertSame(0, $this->reservations());

        $this->policy('block');
        $res = $this->postExpense()->assertUnprocessable();
        $this->assertStringContainsString('مستند بالهوية نفسها', (string) $res->json('message'));
        $this->assertSame(1, Expense::query()->count());
        $this->assertNotNull($legacy);
    }

    /** @test */
    public function an_import_reserves_under_allow_and_refuses_a_duplicate_of_a_reserved_or_existing_document(): void
    {
        $import = ['source' => Dup::SOURCE_STANDARD, 'reference' => 'INV-77'];
        $a = $this->service()->create($this->importData(), $import);
        $this->assertSame(1, $this->reservations());
        $this->assertSame('inv77', ImportDocumentReservation::query()->firstOrFail()->predicate['reference']);

        $e = $this->thrown(fn () => $this->service()->create($this->importData(), ['source' => Dup::SOURCE_AI_ACTION, 'reference' => 'inv 77']), 'مكرر', DuplicateDocumentException::class);
        $this->assertSame($a->id, $e->existingId);

        // مصروف يدوي سابق (بلا حجز) يمنع الاستيراد أيضاً
        $manual = $this->postExpense(['amount' => 555])->assertCreated()->json('data.id');
        $e2 = $this->thrown(fn () => $this->service()->create($this->importData(['amount' => 555]), $import), 'مكرر', DuplicateDocumentException::class);
        $this->assertSame($manual, $e2->existingId);
        $this->assertSame(1, $this->reservations());
    }

    /** @test */
    public function an_explicit_occurrence_id_lets_a_confirmed_repeat_through_once(): void
    {
        $a = $this->service()->create($this->importData(), ['source' => Dup::SOURCE_STANDARD]);
        $b = $this->service()->create($this->importData(), ['source' => Dup::SOURCE_STANDARD, 'occurrence_id' => 'job1:unit2']);
        $this->assertNotSame($a->id, $b->id);
        $this->assertSame(2, $this->reservations());

        $this->thrown(fn () => $this->service()->create($this->importData(), ['source' => Dup::SOURCE_STANDARD, 'occurrence_id' => 'job1:unit2']), 'مكرر', DuplicateDocumentException::class);
        $this->assertSame(2, Expense::query()->count());
    }

    /** @test */
    public function a_failed_import_leaves_no_expense_and_no_reservation(): void
    {
        $this->service()->create($this->importData(), ['source' => Dup::SOURCE_STANDARD]);
        $before = [Expense::query()->count(), $this->reservations()];

        $this->thrown(fn () => $this->service()->create($this->importData(), ['source' => Dup::SOURCE_STANDARD]), 'مكرر', DuplicateDocumentException::class);

        $this->assertSame($before, [Expense::query()->count(), $this->reservations()]);
    }

    /** @test */
    public function editing_a_reserved_draft_rekeys_and_keeps_the_reference(): void
    {
        $a = $this->service()->create($this->importData(), ['source' => Dup::SOURCE_STANDARD, 'reference' => 'INV-5']);

        $this->withToken($this->auth['token'])->putJson("/api/expenses/{$a->id}", $this->body(['amount' => 20000]))->assertOk();

        $row = ImportDocumentReservation::query()->firstOrFail();
        $this->assertSame('inv5', $row->predicate['reference']);
        $this->assertSame(20000, $row->predicate['amount']);
        // الهوية القديمة صارت حرة والجديدة محجوزة
        $this->service()->create($this->importData(), ['source' => Dup::SOURCE_STANDARD, 'reference' => 'INV-5']);
        $this->thrown(fn () => $this->service()->create($this->importData(['amount' => 20000]), ['source' => Dup::SOURCE_STANDARD, 'reference' => 'INV-5']), 'مكرر', DuplicateDocumentException::class);
    }

    /** @test */
    public function editing_into_a_taken_identity_is_422_and_changes_nothing(): void
    {
        $a = $this->service()->create($this->importData(['amount' => 100]), ['source' => Dup::SOURCE_STANDARD]);
        $this->service()->create($this->importData(['amount' => 200]), ['source' => Dup::SOURCE_STANDARD]);

        $this->withToken($this->auth['token'])->putJson("/api/expenses/{$a->id}", $this->body(['amount' => 200]))->assertUnprocessable();

        $this->assertSame(100, (int) $a->fresh()->amount);
        $this->assertSame(100, ImportDocumentReservation::query()->where('document_id', $a->id)->firstOrFail()->predicate['amount']);
    }

    /** @test */
    public function editing_an_unreserved_manual_expense_never_creates_a_reservation(): void
    {
        $id = $this->postExpense()->assertCreated()->json('data.id');
        $this->withToken($this->auth['token'])->putJson("/api/expenses/{$id}", $this->body(['amount' => 1]))->assertOk();
        $this->assertSame(0, $this->reservations());
    }

    /** @test */
    public function deleting_a_draft_releases_its_reservation_so_a_corrected_reimport_succeeds(): void
    {
        $a = $this->service()->create($this->importData(), ['source' => Dup::SOURCE_STANDARD, 'reference' => 'X-1']);

        $this->withToken($this->auth['token'])->deleteJson("/api/expenses/{$a->id}")->assertOk();

        $this->assertSame(0, $this->reservations());
        $this->service()->create($this->importData(), ['source' => Dup::SOURCE_STANDARD, 'reference' => 'X-1']);
        $this->assertSame(1, $this->reservations());
    }

    /** @test */
    public function a_posted_expense_keeps_its_reservation_and_cannot_be_deleted(): void
    {
        $a = $this->service()->create($this->importData(), ['source' => Dup::SOURCE_STANDARD, 'reference' => 'P-1']);
        $this->withToken($this->auth['token'])->postJson("/api/expenses/{$a->id}/post")->assertOk();

        $this->withToken($this->auth['token'])->deleteJson("/api/expenses/{$a->id}")->assertUnprocessable();

        $this->assertSame(1, $this->reservations());
        $this->thrown(fn () => $this->service()->create($this->importData(), ['source' => Dup::SOURCE_STANDARD, 'reference' => 'P-1']), 'مكرر', DuplicateDocumentException::class);
    }

    /** @test */
    public function posting_an_imported_draft_produces_the_same_entry_as_a_manual_one(): void
    {
        $imported = $this->service()->create($this->importData(['expense_date' => '2026-10-03']), ['source' => Dup::SOURCE_STANDARD]);
        $manual = $this->service()->create($this->importData(['expense_date' => '2026-10-04', 'vendor_name' => 'مورّد ثان']));

        $this->withToken($this->auth['token'])->postJson("/api/expenses/{$imported->id}/post")->assertOk();
        $this->withToken($this->auth['token'])->postJson("/api/expenses/{$manual->id}/post")->assertOk();

        $shape = fn (Expense $e) => $e->fresh()->journalEntry->lines->map(fn ($l) => [$l->account->code, (int) $l->debit, (int) $l->credit])->sortBy(0)->values()->all();
        $this->assertSame($shape($manual), $shape($imported));
    }

    /** @test */
    public function the_duplicate_copy_action_is_unchanged_under_allow(): void
    {
        $id = $this->postExpense()->assertCreated()->json('data.id');
        $this->withToken($this->auth['token'])->postJson("/api/expenses/{$id}/duplicate")->assertCreated();
        $this->assertSame(0, $this->reservations());
    }
}
