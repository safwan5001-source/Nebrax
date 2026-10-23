<?php

namespace Tests\Feature;

use App\Models\ImportDocumentReservation;
use App\Services\DocumentDuplicateReservationService as Svc;
use App\Support\DuplicateDocumentException;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use LogicException;
use Tests\TestCase;

/**
 * IMP-H5-S1a — أساس حجز هوية المستند: التطبيع، ثبات المفتاح، الحجز/التنازع، العزل، إعادة الاشتقاق، التحرير. لا مستهلك بعد (additive).
 */
class DocumentDuplicateReservationTest extends TestCase
{
    use CapturesThrowable;
    use InteractsWithApi;
    use RefreshDatabase;

    private Svc $svc;

    private string $tenant;

    protected function setUp(): void
    {
        parent::setUp();
        $this->tenant = $this->registerTenant('resv-a', 'resv-a@t.test')['tenant_id'];
        app(TenantContext::class)->set($this->tenant);
        $this->svc = app(Svc::class);
    }

    private function expense(string $ref = 'INV-001', int $amount = 10050, ?string $occ = null): array
    {
        return Svc::expensePredicate(null, 'Acme Co', $ref, '2026-10-01', $amount, $occ);
    }

    private function reserve(array $predicate, ?string $docId = null, string $domain = Svc::DOMAIN_EXPENSE): ImportDocumentReservation
    {
        return DB::transaction(fn () => $this->svc->reserve($domain, $predicate, 'expense', $docId ?? (string) Str::uuid(), Svc::SOURCE_STANDARD));
    }

    private function caught(callable $op, string $class): \Throwable
    {
        return $this->thrown($op, 'كان يجب أن يُرمى '.$class, $class);
    }

    /** @test */
    public function references_normalize_digits_case_and_punctuation(): void
    {
        $this->assertSame('inv001', Svc::normalizeReference('INV-001'));
        $this->assertSame('inv001', Svc::normalizeReference(' inv 001 '));
        $this->assertSame('inv001', Svc::normalizeReference('INV/٠٠١'));
        $this->assertSame('inv001', Svc::normalizeReference('INV۰۰۱'));
        $this->assertNull(Svc::normalizeReference('---'));
        $this->assertNull(Svc::normalizeReference(null));
        $this->assertSame('0', Svc::normalizeReference('0'));
        $this->assertSame('فاتورة1', Svc::normalizeReference('فاتورة-١'));
    }

    /** @test */
    public function vendor_key_prefers_partner_then_normalized_name(): void
    {
        $this->assertSame('p:abc', Svc::vendorKey('ABC', 'ignored'));
        $this->assertSame('n:acme co', Svc::vendorKey(null, '  ACME   Co '));
        $this->assertSame('none', Svc::vendorKey(null, '  '));
        $this->assertSame('none', Svc::vendorKey('', null));
    }

    /** @test */
    public function key_is_stable_order_insensitive_and_domain_separated(): void
    {
        $p = $this->expense();
        $shuffled = array_reverse($p, true);
        $this->assertSame(Svc::key(Svc::DOMAIN_EXPENSE, $p), Svc::key(Svc::DOMAIN_EXPENSE, $shuffled));
        $this->assertNotSame(Svc::key(Svc::DOMAIN_EXPENSE, $p), Svc::key(Svc::DOMAIN_PURCHASE, $p));
        $this->assertNotSame(Svc::key(Svc::DOMAIN_EXPENSE, $p), Svc::key(Svc::DOMAIN_EXPENSE, $this->expense('INV-002')));
        $this->assertNotSame(Svc::key(Svc::DOMAIN_EXPENSE, $p), Svc::key(Svc::DOMAIN_EXPENSE, $this->expense('INV-001', 10051)));
        $this->assertNotSame(Svc::key(Svc::DOMAIN_EXPENSE, $p), Svc::key(Svc::DOMAIN_EXPENSE, $this->expense('INV-001', 10050, 'occ-2')));
        $this->assertMatchesRegularExpression('/^[0-9a-f]{64}$/', Svc::key(Svc::DOMAIN_EXPENSE, $p));
    }

    /** @test */
    public function equivalent_references_produce_the_same_expense_key(): void
    {
        $a = Svc::expensePredicate(null, 'Acme Co', 'INV-001', '2026-10-01', 100);
        $b = Svc::expensePredicate(null, 'acme  co', ' inv 001', '2026-10-01', 100);
        $this->assertSame(Svc::key(Svc::DOMAIN_EXPENSE, $a), Svc::key(Svc::DOMAIN_EXPENSE, $b));
        // بلا مرجع يحجز بمفتاح بديل ولا يسقط الحجز
        $c = Svc::expensePredicate(null, 'Acme Co', '', '2026-10-01', 100);
        $this->assertNull($c['reference']);
        $this->assertNotSame(Svc::key(Svc::DOMAIN_EXPENSE, $a), Svc::key(Svc::DOMAIN_EXPENSE, $c));
    }

    /** @test */
    public function first_reservation_wins_and_the_second_reports_the_holder(): void
    {
        $holder = (string) Str::uuid();
        $this->reserve($this->expense(), $holder);

        $e = $this->caught(fn () => $this->reserve($this->expense()), DuplicateDocumentException::class);

        $this->assertInstanceOf(DuplicateDocumentException::class, $e);
        $this->assertSame('duplicate_document', $e->reason);
        $this->assertSame(Svc::DOMAIN_EXPENSE, $e->domain);
        $this->assertSame('expense', $e->existingType);
        $this->assertSame($holder, $e->existingId);
        $this->assertSame(1, ImportDocumentReservation::query()->count());
    }

    /** @test */
    public function a_conflict_does_not_abort_the_surrounding_transaction(): void
    {
        $this->reserve($this->expense());

        // على PostgreSQL كان INSERT عادي سيُجهض المعاملة فتفشل العبارة التالية؛ ON CONFLICT DO NOTHING يتركها سليمة.
        $count = DB::transaction(function () {
            $caught = false;
            try {
                $this->svc->reserve(Svc::DOMAIN_EXPENSE, $this->expense(), 'expense', (string) Str::uuid(), Svc::SOURCE_STANDARD);
            } catch (DuplicateDocumentException) {
                $caught = true;
            }
            $this->assertTrue($caught);

            return ImportDocumentReservation::query()->count();
        });

        $this->assertSame(1, $count);
    }

    /** @test */
    public function same_identity_in_another_domain_does_not_conflict(): void
    {
        $this->reserve($this->expense());
        $other = DB::transaction(fn () => $this->svc->reserve(Svc::DOMAIN_PURCHASE, $this->expense(), 'purchase', (string) Str::uuid(), Svc::SOURCE_MANUAL));
        $this->assertSame(Svc::DOMAIN_PURCHASE, $other->domain);
        $this->assertSame(2, ImportDocumentReservation::query()->count());
    }

    /** @test */
    public function reservations_are_isolated_between_tenants(): void
    {
        $this->reserve($this->expense());
        $tenantB = $this->registerTenant('resv-b', 'resv-b@t.test')['tenant_id'];
        app(TenantContext::class)->set($tenantB);

        $row = $this->reserve($this->expense());

        $this->assertSame($tenantB, $row->tenant_id);
        $this->assertSame(1, ImportDocumentReservation::query()->count());
        $this->assertNull($this->svc->find(Svc::DOMAIN_EXPENSE, 'nope'));
        app(TenantContext::class)->set($this->tenant);
        $this->assertSame(1, ImportDocumentReservation::query()->count());
        $this->assertSame(2, DB::table('import_document_reservations')->count());
    }

    /** @test */
    public function the_predicate_and_source_are_stored_for_audit(): void
    {
        $row = $this->reserve($this->expense('INV-9', 500, 'o1'));
        $this->assertSame('inv9', $row->predicate['reference']);
        $this->assertSame(500, $row->predicate['amount']);
        $this->assertSame('o1', $row->predicate['occurrence']);
        $this->assertSame(Svc::SOURCE_STANDARD, $row->source);
        $this->assertSame($row->id, $this->svc->find(Svc::DOMAIN_EXPENSE, $this->expense('INV-9', 500, 'o1'))?->id);
    }

    /** @test */
    public function rekey_moves_the_reservation_atomically_and_frees_the_old_identity(): void
    {
        $doc = (string) Str::uuid();
        $this->reserve($this->expense('A-1'), $doc);

        DB::transaction(fn () => $this->svc->rekey('expense', $doc, $this->expense('A-2')));

        $this->assertNull($this->svc->find(Svc::DOMAIN_EXPENSE, $this->expense('A-1')));
        $this->assertSame($doc, $this->svc->find(Svc::DOMAIN_EXPENSE, $this->expense('A-2'))?->document_id);
        $this->assertSame(1, ImportDocumentReservation::query()->count());
        $this->reserve($this->expense('A-1')); // الهوية القديمة صارت حرة
    }

    /** @test */
    public function rekey_to_a_taken_identity_throws_and_rolls_back_leaving_the_original(): void
    {
        $doc = (string) Str::uuid();
        $this->reserve($this->expense('A-1'), $doc);
        $this->reserve($this->expense('B-1'));

        $e = $this->caught(fn () => DB::transaction(fn () => $this->svc->rekey('expense', $doc, $this->expense('B-1'))), DuplicateDocumentException::class);

        $this->assertInstanceOf(DuplicateDocumentException::class, $e);
        $this->assertSame($doc, $this->svc->find(Svc::DOMAIN_EXPENSE, $this->expense('A-1'))?->document_id);
        $this->assertSame(2, ImportDocumentReservation::query()->count());
    }

    /** @test */
    public function rekey_with_the_same_identity_and_for_an_unreserved_document_are_noops(): void
    {
        $doc = (string) Str::uuid();
        $first = $this->reserve($this->expense('A-1'), $doc);
        DB::transaction(function () use ($doc) {
            $this->svc->rekey('expense', $doc, $this->expense('a 1'));   // مكافئ بعد التطبيع
            $this->svc->rekey('expense', (string) Str::uuid(), $this->expense('Z'));   // بلا حجز
        });

        $this->assertSame(1, ImportDocumentReservation::query()->count());
        $this->assertSame($first->id, ImportDocumentReservation::query()->first()->id);
    }

    /** @test */
    public function release_frees_the_identity_and_reports_the_count(): void
    {
        $doc = (string) Str::uuid();
        $this->reserve($this->expense(), $doc);

        $this->assertSame(1, DB::transaction(fn () => $this->svc->release('expense', $doc)));
        $this->assertSame(0, DB::transaction(fn () => $this->svc->release('expense', $doc)));
        $this->reserve($this->expense());
    }

    /** @test */
    public function purchase_predicate_is_supplier_and_normalized_invoice_number(): void
    {
        $s = (string) Str::uuid();
        $a = Svc::purchasePredicate($s, 'PO 77');
        $this->assertSame(Svc::key(Svc::DOMAIN_PURCHASE, $a), Svc::key(Svc::DOMAIN_PURCHASE, Svc::purchasePredicate(strtoupper($s), 'po-77')));
        $this->assertNotSame(Svc::key(Svc::DOMAIN_PURCHASE, $a), Svc::key(Svc::DOMAIN_PURCHASE, Svc::purchasePredicate((string) Str::uuid(), 'PO 77')));
    }

    /** @test */
    public function it_refuses_unknown_domain_or_source(): void
    {
        $this->caught(fn () => DB::transaction(fn () => $this->svc->reserve('nope', [], 'x', 'y', Svc::SOURCE_STANDARD)), LogicException::class);
        $this->caught(fn () => DB::transaction(fn () => $this->svc->reserve(Svc::DOMAIN_EXPENSE, $this->expense(), 'expense', (string) Str::uuid(), 'bogus')), LogicException::class);
        $this->assertSame(0, ImportDocumentReservation::query()->count());
    }

    /** @test */
    public function it_requires_a_tenant_context(): void
    {
        app(TenantContext::class)->forget();
        $this->caught(fn () => DB::transaction(fn () => $this->svc->reserve(Svc::DOMAIN_EXPENSE, $this->expense(), 'expense', (string) Str::uuid(), Svc::SOURCE_STANDARD)), LogicException::class);
    }

    /** @test */
    public function the_database_enforces_uniqueness_even_for_raw_inserts(): void
    {
        $row = $this->reserve($this->expense());
        $dup = [
            'id' => (string) Str::uuid(), 'tenant_id' => $this->tenant, 'domain' => Svc::DOMAIN_EXPENSE, 'dedupe_key' => $row->dedupe_key,
            'document_type' => 'expense', 'document_id' => (string) Str::uuid(), 'source' => 'manual', 'predicate' => '{}',
            'created_at' => now(), 'updated_at' => now(),
        ];
        $this->assertSame(0, DB::table('import_document_reservations')->insertOrIgnore($dup));
    }
}
