<?php

namespace Tests\Feature;

use App\Models\CreditNote;
use App\Models\JournalEntry;
use App\Models\PlatformAdministrator;
use App\Models\Tenant;
use App\Services\Accounting\CreditNoteService;
use App\Services\Accounting\ZatcaRolloutControlService;
use App\Tenancy\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Test;
use RuntimeException;
use Tests\TestCase;

/**
 * REM-18b-3b — سياج F2 على `credit_notes` (F2a سلامة القرار والمستند الصادر + F2b سياج الترحيل). مُشغّلات قاعدة بيانات فقط،
 * فتُختبر بصفوف خام عبر `DB::table()` على SQLite وPostgreSQL بالحالات نفسها. لا يُصدَر أي مستند ولا يُفعَّل أي مستأجر في الإنتاج:
 * المُصدِر الحقيقي (REM-18b-3c) غير موجود، والاختبار يحاكي ما سيكتبه (مدخل سلسلة ثم تحديث الإشعار في معاملة واحدة).
 */
class ZatcaCreditNoteFenceTest extends TestCase
{
    use CapturesThrowable;
    use InteractsWithApi;
    use RefreshDatabase;

    private const MIGRATION = '2026_11_22_010000_add_zatca_credit_note_fences.php';

    private const ZATCA_COLUMNS = [
        'zatca_status', 'zatca_skip_reason', 'zatca_document_type', 'zatca_reason_code', 'issued_at', 'party_snapshot',
        'zatca_uuid', 'zatca_icv', 'zatca_previous_hash', 'zatca_hash', 'zatca_qr', 'zatca_xml',
    ];

    private ZatcaRolloutControlService $controls;

    private PlatformAdministrator $admin;

    protected function setUp(): void
    {
        parent::setUp();
        $this->controls = app(ZatcaRolloutControlService::class);
        $this->admin = PlatformAdministrator::create([
            'name' => 'مدير منصة', 'email' => Str::random(10).'@platform.test', 'password' => 'secret-password-1', 'is_active' => true,
        ]);
    }

    // ═══════════════ التوافق مع التاريخ ═══════════════

    #[Test]
    public function historical_notes_without_any_zatca_value_stay_valid_and_editable_with_no_chain_entry(): void
    {
        $tenant = $this->tenant();
        $note = $this->note($tenant, ['status' => 'posted']);

        DB::table('credit_notes')->where('id', $note)->update(['reason' => 'تعديل غير ZATCA', 'updated_at' => now()]);
        DB::table('credit_notes')->where('id', $note)->update(['status' => 'cancelled']);

        $row = DB::table('credit_notes')->where('id', $note)->first();
        $this->assertSame('cancelled', $row->status);
        foreach (self::ZATCA_COLUMNS as $column) {
            $this->assertNull($row->{$column}, $column);
        }
        $this->assertSame(0, DB::table('zatca_chain_entries')->count());
        $this->assertSame(1, DB::table('credit_notes')->where('id', $note)->delete(), 'الإشعار التاريخي يُحذف كما كان');
    }

    #[Test]
    public function posting_with_no_activation_is_unchanged_for_sales_and_purchase_notes(): void
    {
        $tenant = $this->tenant();
        $sales = $this->note($tenant);
        $purchase = $this->note($tenant, ['type' => 'purchase']);

        DB::table('credit_notes')->whereIn('id', [$sales, $purchase])->update(['status' => 'posted']);

        $this->assertSame(2, DB::table('credit_notes')->where('tenant_id', $tenant)->where('status', 'posted')->count());
        $this->assertNull(DB::table('credit_notes')->where('id', $sales)->value('zatca_status'));
    }

    // ═══════════════ F2a — المستند الصادر ═══════════════

    #[Test]
    public function a_generated_note_with_its_matching_entry_is_accepted_in_one_transaction(): void
    {
        $tenant = $this->tenant();
        $note = $this->note($tenant);

        $issued = $this->issue($tenant, $note);

        $row = DB::table('credit_notes')->where('id', $note)->first();
        $this->assertSame('generated', $row->zatca_status);
        $this->assertSame('posted', $row->status);
        $this->assertSame($issued['zatca_icv'], (int) $row->zatca_icv);
        $this->assertSame(1, DB::table('zatca_chain_entries')->where('credit_note_id', $note)->count());
    }

    #[Test]
    public function a_generated_document_without_any_chain_entry_is_rejected(): void
    {
        $tenant = $this->tenant();
        $note = $this->note($tenant);

        $this->rejects(fn () => DB::table('credit_notes')->where('id', $note)->update($this->generated(7, 'u', Str::uuid())), 'لا مدخل');

        $this->assertNull(DB::table('credit_notes')->where('id', $note)->value('zatca_status'));
        $this->assertSame(0, DB::table('zatca_chain_entries')->count());
    }

    #[Test]
    public function a_generated_note_cannot_be_inserted_directly_because_its_entry_needs_the_note_first(): void
    {
        $tenant = $this->tenant();

        $this->rejects(fn () => $this->note($tenant, $this->generated(1, 'p', (string) Str::uuid()) + ['status' => 'posted']), 'إدراج مباشر');

        $this->assertSame(0, DB::table('credit_notes')->count());
    }

    /** @return array<string, array{0: string, 1: mixed}> */
    public static function mismatches(): array
    {
        return [
            'icv' => ['zatca_icv', 99],
            'uuid' => ['zatca_uuid', '99999999-9999-4999-8999-999999999999'],
            'previous hash' => ['zatca_previous_hash', 'bm90LXRoZS1waWg='],
            'hash' => ['zatca_hash', 'bm90LXRoZS1oYXNo'],
            'document type' => ['zatca_document_type', 'simplified'],
        ];
    }

    #[Test]
    #[DataProvider('mismatches')]
    public function a_generated_note_whose_value_differs_from_its_entry_is_rejected(string $column, mixed $value): void
    {
        $tenant = $this->tenant();
        $note = $this->note($tenant);
        $entry = $this->entryFor($tenant, $note);
        $values = array_merge($this->generated($entry['icv'], $entry['previous_hash'], $entry['zatca_uuid'], $entry['hash']), [$column => $value]);

        $this->rejects(fn () => DB::table('credit_notes')->where('id', $note)->update($values), $column);

        $this->assertNull(DB::table('credit_notes')->where('id', $note)->value('zatca_status'));
    }

    #[Test]
    public function an_entry_of_another_document_or_type_or_tenant_never_satisfies_the_note(): void
    {
        $tenant = $this->tenant();
        $other = $this->tenant();
        $note = $this->note($tenant);
        $sibling = $this->note($tenant);
        $foreign = $this->note($other);

        // مدخل لإشعار آخر في المستأجر نفسه، ومدخل مستأجر آخر، ومدخل فاتورة (388) — لا يطابق أيٌّ منها.
        $entryOfSibling = $this->entryFor($tenant, $sibling);
        $entryOfForeign = $this->entryFor($other, $foreign);
        $invoice = $this->invoice($tenant);
        $invoiceEntry = $this->insertEntry($tenant, $this->chainFor($tenant), $entryOfSibling['icv'] + 1, [
            'document_type' => 'invoice', 'invoice_id' => $invoice, 'credit_note_id' => null, 'type_code' => '388', 'subtype' => 'standard',
            'zatca_uuid' => (string) Str::uuid(), 'previous_hash' => 'cA==', 'hash' => 'aA==',
        ]);

        $attempts = [
            'إشعار شقيق' => $this->generated($entryOfSibling['icv'], $entryOfSibling['previous_hash'], $entryOfSibling['zatca_uuid'], $entryOfSibling['hash']),
            'مستأجر آخر' => $this->generated($entryOfForeign['icv'], $entryOfForeign['previous_hash'], $entryOfForeign['zatca_uuid'], $entryOfForeign['hash']),
        ];
        $invoiceRow = DB::table('zatca_chain_entries')->where('id', $invoiceEntry)->first();
        $attempts['مدخل فاتورة'] = $this->generated((int) $invoiceRow->icv, $invoiceRow->previous_hash, $invoiceRow->zatca_uuid, $invoiceRow->hash);

        foreach ($attempts as $label => $values) {
            $this->rejects(fn () => DB::table('credit_notes')->where('id', $note)->update($values), $label);
        }
        $this->assertNull(DB::table('credit_notes')->where('id', $note)->value('zatca_status'));
    }

    #[Test]
    public function an_issued_document_cannot_be_mutated_in_any_zatca_column(): void
    {
        $tenant = $this->tenant();
        $note = $this->note($tenant);
        $this->issue($tenant, $note);
        $before = (array) DB::table('credit_notes')->where('id', $note)->first();

        $changes = [
            'zatca_status' => 'disabled', 'zatca_skip_reason' => 'x', 'zatca_document_type' => 'simplified', 'zatca_reason_code' => 'other',
            'issued_at' => '2027-01-01 00:00:00', 'party_snapshot' => '{"v":2}', 'zatca_uuid' => (string) Str::uuid(), 'zatca_icv' => 50,
            'zatca_previous_hash' => 'eA==', 'zatca_hash' => 'eQ==', 'zatca_qr' => 'q2', 'zatca_xml' => '<Invoice>2</Invoice>',
        ];
        foreach ($changes as $column => $value) {
            $this->rejects(fn () => DB::table('credit_notes')->where('id', $note)->update([$column => $value]), $column);
        }
        foreach ([null, 'not_generated', 'disabled'] as $state) {
            $this->rejects(fn () => DB::table('credit_notes')->where('id', $note)->update(['zatca_status' => $state]), 'تحويل صامت إلى '.var_export($state, true));
        }

        $this->assertSame($before, (array) DB::table('credit_notes')->where('id', $note)->first(), 'الصف كما هو بايتاً ببايت');
        // الأعمدة غير الـZATCA تبقى قابلة للتعديل كالمعتاد.
        DB::table('credit_notes')->where('id', $note)->update(['reason' => 'ملاحظة لاحقة']);
        $this->assertSame('ملاحظة لاحقة', DB::table('credit_notes')->where('id', $note)->value('reason'));
    }

    #[Test]
    public function an_unchanged_rewrite_of_an_issued_document_is_not_a_mutation(): void
    {
        $tenant = $this->tenant();
        $note = $this->note($tenant);
        $this->issue($tenant, $note);

        DB::table('credit_notes')->where('id', $note)->update(['zatca_status' => 'generated', 'zatca_icv' => DB::raw('zatca_icv')]);

        $this->assertSame('generated', DB::table('credit_notes')->where('id', $note)->value('zatca_status'));
    }

    #[Test]
    public function recorded_non_issued_decisions_are_frozen_and_never_become_generated_later(): void
    {
        $tenant = $this->tenant();
        $disabled = $this->note($tenant, ['zatca_status' => 'disabled']);
        $skipped = $this->note($tenant, ['zatca_status' => 'not_generated', 'zatca_skip_reason' => 'payment_means_unresolved']);

        foreach ([$disabled, $skipped] as $note) {
            $entry = $this->entryFor($tenant, $note);
            $this->rejects(
                fn () => DB::table('credit_notes')->where('id', $note)->update($this->generated($entry['icv'], $entry['previous_hash'], $entry['zatca_uuid'], $entry['hash'])),
                'لا إصدار لاحق لقرار مسجَّل',
            );
            $this->rejects(fn () => DB::table('credit_notes')->where('id', $note)->update(['zatca_status' => null, 'zatca_skip_reason' => null]), 'لا مسح للقرار');
        }
        $this->rejects(fn () => DB::table('credit_notes')->where('id', $skipped)->update(['zatca_skip_reason' => 'غير ذلك']), 'سبب التخطي مجمّد');

        $this->assertSame('disabled', DB::table('credit_notes')->where('id', $disabled)->value('zatca_status'));
        $this->assertSame('payment_means_unresolved', DB::table('credit_notes')->where('id', $skipped)->value('zatca_skip_reason'));
        $this->assertSame(0, DB::table('credit_notes')->whereNotNull('zatca_icv')->count());
    }

    #[Test]
    public function a_decision_cannot_be_recorded_retroactively_on_an_already_posted_note(): void
    {
        $tenant = $this->tenant();
        $posted = $this->note($tenant, ['status' => 'posted']);

        $this->rejects(fn () => DB::table('credit_notes')->where('id', $posted)->update(['zatca_status' => 'disabled']), 'disabled');
        $this->rejects(fn () => DB::table('credit_notes')->where('id', $posted)->update(['zatca_status' => 'not_generated', 'zatca_skip_reason' => 'سبب']), 'not_generated');
        $entry = $this->entryFor($tenant, $posted);
        $this->rejects(
            fn () => DB::table('credit_notes')->where('id', $posted)->update($this->generated($entry['icv'], $entry['previous_hash'], $entry['zatca_uuid'], $entry['hash'])),
            'لا إصدار رجعي',
        );

        $this->assertNull(DB::table('credit_notes')->where('id', $posted)->value('zatca_status'));
    }

    #[Test]
    public function a_decision_may_be_recorded_in_the_update_that_posts_the_note(): void
    {
        $tenant = $this->tenant();
        $note = $this->note($tenant);

        DB::table('credit_notes')->where('id', $note)->update(['status' => 'posted', 'zatca_status' => 'not_generated', 'zatca_skip_reason' => 'payment_means_unresolved']);

        $this->assertSame('not_generated', DB::table('credit_notes')->where('id', $note)->value('zatca_status'));
    }

    // ═══════════════ تناسق الحالة ═══════════════

    /** @return array<string, array{0: array<string, mixed>}> */
    public static function inconsistentShapes(): array
    {
        $issued = ['zatca_uuid' => '11111111-1111-4111-8111-111111111111', 'zatca_icv' => 3, 'zatca_previous_hash' => 'cA==', 'zatca_hash' => 'aA==', 'zatca_qr' => 'qr', 'zatca_xml' => '<Invoice/>'];

        return [
            'artifacts without status' => [$issued],
            'skip reason without status' => [['zatca_skip_reason' => 'سبب']],
            'lone icv without status' => [['zatca_icv' => 1]],
            'not_generated without reason' => [['zatca_status' => 'not_generated']],
            'not_generated blank reason' => [['zatca_status' => 'not_generated', 'zatca_skip_reason' => '   ']],
            'not_generated with xml' => [['zatca_status' => 'not_generated', 'zatca_skip_reason' => 'سبب', 'zatca_xml' => '<Invoice/>']],
            'not_generated with hash' => [['zatca_status' => 'not_generated', 'zatca_skip_reason' => 'سبب', 'zatca_hash' => 'aA==']],
            'not_generated with icv' => [['zatca_status' => 'not_generated', 'zatca_skip_reason' => 'سبب', 'zatca_icv' => 2]],
            'disabled with xml' => [['zatca_status' => 'disabled', 'zatca_xml' => '<Invoice/>']],
            'disabled with hash' => [['zatca_status' => 'disabled', 'zatca_hash' => 'aA==']],
            'disabled with icv' => [['zatca_status' => 'disabled', 'zatca_icv' => 2]],
            'generated bare' => [['zatca_status' => 'generated']],
        ];
    }

    /** @param array<string, mixed> $values */
    #[Test]
    #[DataProvider('inconsistentShapes')]
    public function inconsistent_status_and_column_combinations_are_rejected_on_insert_and_update(array $values): void
    {
        $tenant = $this->tenant();
        $note = $this->note($tenant);

        $this->rejects(fn () => $this->note($tenant, $values + ['status' => 'posted']), 'insert');
        $this->rejects(fn () => DB::table('credit_notes')->where('id', $note)->update($values), 'update');
        $this->assertNull(DB::table('credit_notes')->where('id', $note)->value('zatca_status'));
    }

    /** @return array<string, array{0: string, 1: mixed}> */
    public static function incompleteGeneratedFields(): array
    {
        $fields = ['zatca_document_type', 'zatca_reason_code', 'issued_at', 'party_snapshot', 'zatca_uuid', 'zatca_icv', 'zatca_previous_hash', 'zatca_hash', 'zatca_qr', 'zatca_xml'];
        $cases = [];
        foreach ($fields as $field) {
            $cases["{$field} missing"] = [$field, null];
        }
        $cases['xml blank'] = ['zatca_xml', '   '];
        $cases['qr blank'] = ['zatca_qr', ''];
        $cases['icv zero'] = ['zatca_icv', 0];
        $cases['document type invalid'] = ['zatca_document_type', 'other'];
        $cases['skip reason present'] = ['zatca_skip_reason', 'سبب'];

        return $cases;
    }

    #[Test]
    #[DataProvider('incompleteGeneratedFields')]
    public function a_generated_document_must_be_complete(string $field, mixed $value): void
    {
        $tenant = $this->tenant();
        $note = $this->note($tenant);
        $entry = $this->entryFor($tenant, $note);
        $values = array_merge($this->generated($entry['icv'], $entry['previous_hash'], $entry['zatca_uuid'], $entry['hash']), [$field => $value]);

        $this->rejects(fn () => DB::table('credit_notes')->where('id', $note)->update($values), $field);

        $this->assertNull(DB::table('credit_notes')->where('id', $note)->value('zatca_status'));
    }

    #[Test]
    public function a_generated_document_requires_a_posted_sales_note(): void
    {
        $tenant = $this->tenant();
        $draft = $this->note($tenant);
        $entry = $this->entryFor($tenant, $draft);
        $values = $this->generated($entry['icv'], $entry['previous_hash'], $entry['zatca_uuid'], $entry['hash']);

        $this->rejects(fn () => DB::table('credit_notes')->where('id', $draft)->update(['status' => 'draft'] + $values), 'مسودة');
        $this->rejects(fn () => DB::table('credit_notes')->where('id', $draft)->update(['status' => 'cancelled'] + $values), 'ملغى');

        $this->assertSame('draft', DB::table('credit_notes')->where('id', $draft)->value('status'));
        $this->assertNull(DB::table('credit_notes')->where('id', $draft)->value('zatca_status'));
    }

    #[Test]
    public function purchase_credit_notes_carry_no_zatca_value_and_keep_their_behaviour(): void
    {
        $tenant = $this->tenant();
        $purchase = $this->note($tenant, ['type' => 'purchase']);

        foreach (self::ZATCA_COLUMNS as $column) {
            $value = match ($column) {
                'zatca_status' => 'disabled', 'zatca_icv' => 1, 'issued_at' => '2026-02-10 08:15:30', 'party_snapshot' => '{"v":1}',
                'zatca_uuid' => '11111111-1111-4111-8111-111111111111', default => 'x',
            };
            $this->rejects(fn () => DB::table('credit_notes')->where('id', $purchase)->update([$column => $value]), $column);
            $this->rejects(fn () => $this->note($tenant, ['type' => 'purchase', $column => $value]), "insert {$column}");
        }
        DB::table('credit_notes')->where('id', $purchase)->update(['status' => 'posted', 'reason' => 'مرتجع مشتريات']);
        $this->assertSame('posted', DB::table('credit_notes')->where('id', $purchase)->value('status'));
    }

    // ═══════════════ الحذف ═══════════════

    #[Test]
    public function an_issued_note_cannot_be_deleted_but_decisions_without_a_document_follow_existing_behaviour(): void
    {
        $tenant = $this->tenant();
        $issued = $this->note($tenant);
        $this->issue($tenant, $issued);
        $disabled = $this->note($tenant, ['zatca_status' => 'disabled']);

        $this->rejects(fn () => DB::table('credit_notes')->where('id', $issued)->delete(), 'generated');
        $this->assertSame(1, DB::table('credit_notes')->where('id', $disabled)->delete());
        $this->assertSame(1, DB::table('credit_notes')->where('id', $issued)->count());
        $this->assertSame(1, DB::table('zatca_chain_entries')->where('credit_note_id', $issued)->count());
    }

    #[Test]
    public function hard_deleting_a_tenant_still_removes_its_issued_notes_and_chain(): void
    {
        $tenant = $this->tenant();
        $this->issue($tenant, $this->note($tenant));
        $survivor = $this->tenant();
        $this->issue($survivor, $this->note($survivor));

        $baseline = $this->tenant();
        $this->note($baseline);
        $baselineDeletes = $this->deletes($baseline);

        if (DB::connection()->getDriverName() === 'sqlite') {
            // SQLite لا يحذف مستأجراً له إشعار دائن أصلاً (credit_notes.partner_id RESTRICT فوري يُفحص قبل cascade العملاء) — قبل F2 أيضاً.
            // السياج لا يغيّر ذلك: الإشعار الصادر يتصرّف كالإشعار العادي تماماً.
            $this->assertFalse($baselineDeletes, 'السلوك القائم على SQLite');
            $this->assertSame($baselineDeletes, $this->deletes($tenant), 'الإشعار الصادر كالعادي');
            $this->assertSame(1, DB::table('credit_notes')->where('tenant_id', $tenant)->count());

            return;
        }

        $this->assertTrue($baselineDeletes);
        $this->assertTrue($this->deletes($tenant), 'حذف المستأجر المتسلسل يمرّ رغم السياج');
        $this->assertSame(0, DB::table('credit_notes')->where('tenant_id', $tenant)->count());
        $this->assertSame(0, DB::table('zatca_chain_entries')->where('tenant_id', $tenant)->count());
        $this->assertSame(1, DB::table('credit_notes')->where('tenant_id', $survivor)->count(), 'مستأجر آخر لم يُمسّ');
        $this->assertSame(1, DB::table('zatca_chain_entries')->where('tenant_id', $survivor)->count());
    }

    private function deletes(string $tenant): bool
    {
        try {
            DB::transaction(fn () => DB::table('tenants')->where('id', $tenant)->delete());

            return true;
        } catch (QueryException) {
            return false;
        }
    }

    // ═══════════════ F2b — سياج الترحيل ═══════════════

    #[Test]
    public function an_activated_tenant_cannot_post_a_sales_note_without_an_explicit_decision(): void
    {
        $tenant = $this->tenant();
        $draft = $this->note($tenant);
        $this->controls->setTenantState($this->admin, $tenant, true, 'تفعيل تجريبي للاختبار');

        $this->rejects(fn () => DB::table('credit_notes')->where('id', $draft)->update(['status' => 'posted']), 'update');
        $this->rejects(fn () => $this->note($tenant, ['status' => 'posted']), 'insert');
        $this->rejects(fn () => DB::table('credit_notes')->where('id', $draft)->update(['status' => 'posted', 'zatca_status' => 'disabled']), 'قرار disabled لمستأجر مفعَّل');

        $this->assertSame('draft', DB::table('credit_notes')->where('id', $draft)->value('status'));
    }

    #[Test]
    public function an_activated_tenant_may_post_with_an_explicit_decision(): void
    {
        $tenant = $this->tenant();
        $skipped = $this->note($tenant);
        $issued = $this->note($tenant);
        $this->controls->setTenantState($this->admin, $tenant, true, 'تفعيل تجريبي للاختبار');

        DB::table('credit_notes')->where('id', $skipped)->update(['status' => 'posted', 'zatca_status' => 'not_generated', 'zatca_skip_reason' => 'payment_means_unresolved']);
        $this->issue($tenant, $issued);

        $this->assertSame(2, DB::table('credit_notes')->where('tenant_id', $tenant)->where('status', 'posted')->count());
    }

    #[Test]
    public function the_fence_ignores_purchase_notes_drafts_cancellations_and_notes_already_posted(): void
    {
        $tenant = $this->tenant();
        $historical = $this->note($tenant, ['status' => 'posted']);
        $purchase = $this->note($tenant, ['type' => 'purchase']);
        $draft = $this->note($tenant);
        $this->controls->setTenantState($this->admin, $tenant, true, 'تفعيل تجريبي للاختبار');

        DB::table('credit_notes')->where('id', $purchase)->update(['status' => 'posted']);
        DB::table('credit_notes')->where('id', $draft)->update(['status' => 'cancelled']);
        DB::table('credit_notes')->where('id', $historical)->update(['reason' => 'تعديل بعد التفعيل']);
        $this->note($tenant); // مسودة جديدة

        $this->assertSame('posted', DB::table('credit_notes')->where('id', $purchase)->value('status'));
        $this->assertSame('cancelled', DB::table('credit_notes')->where('id', $draft)->value('status'));
        $this->assertNull(DB::table('credit_notes')->where('id', $historical)->value('zatca_status'), 'لا قرار رجعي بعد التفعيل');
    }

    #[Test]
    public function the_platform_emergency_stop_overrides_activation_and_lifting_it_restores_the_fence(): void
    {
        $tenant = $this->tenant();
        $a = $this->note($tenant);
        $b = $this->note($tenant);
        $this->controls->setTenantState($this->admin, $tenant, true, 'تفعيل تجريبي للاختبار');
        $this->controls->setPlatformState($this->admin, false, 'إيقاف طارئ للاختبار');

        DB::table('credit_notes')->where('id', $a)->update(['status' => 'posted']);
        $this->assertSame('posted', DB::table('credit_notes')->where('id', $a)->value('status'), 'الإيقاف الطارئ يُعيد الترحيل القديم');

        $this->controls->setPlatformState($this->admin, true, 'رفع الإيقاف');
        $this->rejects(fn () => DB::table('credit_notes')->where('id', $b)->update(['status' => 'posted']), 'بعد رفع الإيقاف');
    }

    #[Test]
    public function a_missing_or_disabled_tenant_control_means_legacy_posting_and_activation_is_per_tenant(): void
    {
        $activated = $this->tenant();
        $plain = $this->tenant();
        $reverted = $this->tenant();
        $this->controls->setTenantState($this->admin, $activated, true, 'تفعيل تجريبي للاختبار');
        $this->controls->setTenantState($this->admin, $reverted, true, 'تفعيل ثم تعطيل');
        $this->controls->setTenantState($this->admin, $reverted, false, 'تعطيل');

        foreach ([$plain, $reverted] as $tenant) {
            $note = $this->note($tenant);
            DB::table('credit_notes')->where('id', $note)->update(['status' => 'posted']);
            $this->assertSame('posted', DB::table('credit_notes')->where('id', $note)->value('status'));
        }
        $this->rejects(fn () => DB::table('credit_notes')->where('id', $this->note($activated))->update(['status' => 'posted']), 'المفعَّل وحده');
    }

    #[Test]
    public function an_activation_flipping_after_a_decision_is_recorded_does_not_invalidate_it(): void
    {
        $tenant = $this->tenant();
        $note = $this->note($tenant);
        DB::table('credit_notes')->where('id', $note)->update(['zatca_status' => 'disabled']);
        $this->controls->setTenantState($this->admin, $tenant, true, 'تفعيل بعد تسجيل القرار');

        // قرار disabled سُجّل قبل التفعيل؛ الترحيل بعد التفعيل يُرفض (لا تخفيض صامت)، ويُرفع بإعادة التعطيل لا بمسح القرار.
        $this->rejects(fn () => DB::table('credit_notes')->where('id', $note)->update(['status' => 'posted']), 'قرار قديم + تفعيل');
        $this->controls->setTenantState($this->admin, $tenant, false, 'تعطيل');
        DB::table('credit_notes')->where('id', $note)->update(['status' => 'posted']);

        $this->assertSame('posted', DB::table('credit_notes')->where('id', $note)->value('status'));
    }

    // ═══════════════ الخدمة الحقيقية: لا تغيير محاسبي ═══════════════

    #[Test]
    public function the_real_posting_service_is_unchanged_for_a_disabled_tenant_and_fails_closed_after_activation(): void
    {
        $auth = $this->registerTenant('f2-fence', 'owner@f2-fence.test');
        $draft = $this->draftSourceNote($auth['token']);

        $this->controls->setTenantState($this->admin, $auth['tenant_id'], true, 'تفعيل تجريبي للاختبار');
        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertSame(0, JournalEntry::where('source_type', CreditNote::class)->where('source_id', $draft)->count());
        $e = $this->thrown(fn () => app(CreditNoteService::class)->post(CreditNote::findOrFail($draft)), 'مفعَّل بلا مُصدِر');
        $this->assertInstanceOf(QueryException::class, $e);
        $this->assertStringContainsString('explicit ZATCA issuance decision', $e->getMessage());

        // الفشل مغلق بالكامل: لا قيد ولا ترحيل ولا قرار.
        $this->assertSame('draft', DB::table('credit_notes')->where('id', $draft)->value('status'));
        $this->assertSame(0, JournalEntry::where('source_type', CreditNote::class)->where('source_id', $draft)->count());

        $this->controls->setTenantState($this->admin, $auth['tenant_id'], false, 'تعطيل');
        $posted = app(CreditNoteService::class)->post(CreditNote::findOrFail($draft));
        $this->assertSame('posted', $posted->status);
        $this->assertSame(1, JournalEntry::where('source_type', CreditNote::class)->where('source_id', $draft)->count(), 'القيد المحاسبي كما هو');
        $this->assertNull(DB::table('credit_notes')->where('id', $draft)->value('zatca_status'));
    }

    #[Test]
    public function the_service_and_model_are_not_wired_to_the_fences(): void
    {
        $service = (string) file_get_contents(base_path('app/Services/Accounting/CreditNoteService.php'));
        $this->assertDoesNotMatchRegularExpression('/ZatcaRollout|ZatcaChain|zatca_status|ZatcaCreditNoteXml/', $service, 'لا إصدار ولا قراءة ضوابط في خدمة الإشعار');
        foreach (self::ZATCA_COLUMNS as $column) {
            $this->assertNotContains($column, (new CreditNote())->getFillable(), $column);
        }
    }

    // ═══════════════ المخطط والتراجع ═══════════════

    #[Test]
    public function every_expected_trigger_is_installed(): void
    {
        $this->assertSame([], array_values(array_diff($this->f2Triggers(), $this->triggerNames())));
    }

    /** @return list<string> */
    private function f2Triggers(): array
    {
        return DB::connection()->getDriverName() === 'pgsql'
            ? ['credit_notes_zatca_fence', 'credit_notes_zatca_posting_fence', 'credit_notes_zatca_no_delete']
            : [
                'credit_notes_zatca_shape_insert', 'credit_notes_zatca_shape_update', 'credit_notes_zatca_entry_insert', 'credit_notes_zatca_entry_update',
                'credit_notes_zatca_frozen', 'credit_notes_zatca_retroactive', 'credit_notes_zatca_posting_insert', 'credit_notes_zatca_posting_update',
                'credit_notes_zatca_no_delete',
            ];
    }

    #[Test]
    public function the_migration_adds_no_column_or_index_and_touches_no_row(): void
    {
        $tenant = $this->tenant();
        $note = $this->note($tenant, ['status' => 'posted']);
        $before = (array) DB::table('credit_notes')->where('id', $note)->first();
        $columns = DB::getSchemaBuilder()->getColumnListing('credit_notes');

        $this->migration()->down();
        $this->migration()->up();

        $this->assertSame($columns, DB::getSchemaBuilder()->getColumnListing('credit_notes'));
        $this->assertSame($before, (array) DB::table('credit_notes')->where('id', $note)->first());
    }

    #[Test]
    public function the_migration_rolls_back_and_reapplies_when_no_decision_or_document_exists(): void
    {
        $tenant = $this->tenant();
        $note = $this->note($tenant);

        $this->migration()->down();
        $this->assertSame([], array_values(array_intersect($this->f2Triggers(), $this->triggerNames())), 'كل مُشغّلات F2 أُسقطت');
        // بلا سياج: لا حاجز F2b (سلوك ما قبل الهجرة).
        $this->controls->setTenantState($this->admin, $tenant, true, 'تفعيل تجريبي للاختبار');
        DB::table('credit_notes')->where('id', $note)->update(['status' => 'posted']);

        $this->migration()->up();
        $this->rejects(fn () => $this->note($tenant, ['status' => 'posted']), 'عاد السياج');
    }

    /** @return array<string, array{0: callable}> */
    public static function artifactsBlockingRollback(): array
    {
        return [
            'recorded decision' => [fn (self $t, string $tenant, string $note) => DB::table('credit_notes')->where('id', $note)->update(['zatca_status' => 'disabled'])],
            'issued document' => [fn (self $t, string $tenant, string $note) => $t->issue($tenant, $note)],
        ];
    }

    #[Test]
    #[DataProvider('artifactsBlockingRollback')]
    public function the_migration_refuses_to_roll_back_over_a_decision_or_document(callable $make): void
    {
        $tenant = $this->tenant();
        $note = $this->note($tenant);
        $make($this, $tenant, $note);

        $e = $this->thrown(fn () => $this->migration()->down(), 'التراجع مرفوض');
        $this->assertInstanceOf(RuntimeException::class, $e);
        $this->assertStringContainsString('Rollback refused', $e->getMessage());
        $this->assertContains('credit_notes_zatca_no_delete', $this->triggerNames(), 'السياج باقٍ بعد الرفض');
    }

    // ═══════════════ مساعدات ═══════════════

    private function migration(): object
    {
        return require database_path('migrations/'.self::MIGRATION);
    }

    /** @return list<string> */
    private function triggerNames(): array
    {
        if (DB::connection()->getDriverName() === 'pgsql') {
            return array_map(fn ($r) => $r->tgname, DB::select(
                "SELECT t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid WHERE c.relname = 'credit_notes' AND NOT t.tgisinternal"
            ));
        }

        return array_map(fn ($r) => $r->name, DB::select("SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'credit_notes'"));
    }

    /** يتوقّع رفض القاعدة (في savepoint كي لا تُجهَض معاملة PostgreSQL المحيطة). */
    private function rejects(callable $operation, string $label = ''): QueryException
    {
        try {
            DB::transaction($operation);
        } catch (QueryException $e) {
            return $e;
        }

        $this->fail('the database was expected to reject this operation'.($label !== '' ? ": {$label}" : ''));
    }

    private function tenant(): string
    {
        return Tenant::create([
            'name' => 'مستأجر F2', 'slug' => 'zatca-f2-'.Str::random(10),
            'vat_number' => '300000000000003', 'currency' => 'SAR', 'is_active' => true,
        ])->id;
    }

    private function partnerOf(string $tenant): string
    {
        $existing = DB::table('partners')->where('tenant_id', $tenant)->value('id');
        if ($existing !== null) {
            return $existing;
        }
        $id = (string) Str::uuid();
        DB::table('partners')->insert(['id' => $id, 'tenant_id' => $tenant, 'name' => 'عميل', 'type' => 'customer', 'created_at' => now(), 'updated_at' => now()]);

        return $id;
    }

    /** @param array<string, mixed> $overrides */
    private function note(string $tenant, array $overrides = []): string
    {
        $id = (string) Str::uuid();
        DB::table('credit_notes')->insert(array_merge([
            'id' => $id, 'tenant_id' => $tenant, 'number' => 'CN-'.Str::random(8), 'partner_id' => $this->partnerOf($tenant),
            'note_date' => '2026-02-10', 'created_at' => now(), 'updated_at' => now(),
        ], $overrides));

        return $id;
    }

    private function invoice(string $tenant): string
    {
        $id = (string) Str::uuid();
        DB::table('invoices')->insert([
            'id' => $id, 'tenant_id' => $tenant, 'number' => 'INV-'.Str::random(8), 'partner_id' => $this->partnerOf($tenant),
            'invoice_date' => '2026-02-10', 'created_at' => now(), 'updated_at' => now(),
        ]);

        return $id;
    }

    private function chainFor(string $tenant): string
    {
        $existing = DB::table('zatca_chains')->where('tenant_id', $tenant)->value('id');
        if ($existing !== null) {
            return $existing;
        }
        $id = (string) Str::uuid();
        DB::table('zatca_chains')->insert([
            'id' => $id, 'tenant_id' => $tenant, 'chain_key' => 'tenant', 'last_icv' => 0, 'seed_icv' => 0, 'created_at' => now(), 'updated_at' => now(),
        ]);

        return $id;
    }

    /**
     * يُدرج مدخل سلسلة (381) للإشعار كما سيفعل المخصِّص، ويعيد قيمه.
     *
     * @return array{icv: int, zatca_uuid: string, previous_hash: string, hash: string}
     */
    private function entryFor(string $tenant, string $note): array
    {
        $chain = $this->chainFor($tenant);
        $icv = (int) DB::table('zatca_chains')->where('id', $chain)->value('last_icv') + 1;
        $entry = [
            'icv' => $icv, 'zatca_uuid' => (string) Str::uuid(),
            'previous_hash' => base64_encode(hash('sha256', 'prev-'.$icv)), 'hash' => base64_encode(hash('sha256', 'hash-'.$icv)),
        ];
        $this->insertEntry($tenant, $chain, $icv, [
            'document_type' => 'credit_note', 'invoice_id' => null, 'credit_note_id' => $note, 'type_code' => '381', 'subtype' => 'standard',
            'zatca_uuid' => $entry['zatca_uuid'], 'previous_hash' => $entry['previous_hash'], 'hash' => $entry['hash'],
        ]);

        return $entry;
    }

    /** @param array<string, mixed> $document */
    private function insertEntry(string $tenant, string $chain, int $icv, array $document): string
    {
        $row = array_merge([
            'id' => (string) Str::uuid(), 'tenant_id' => $tenant, 'chain_id' => $chain, 'icv' => $icv, 'signed' => false,
            'issued_at' => '2026-02-10 08:15:30', 'created_at' => now(),
        ], $document);
        DB::table('zatca_chain_entries')->insert($row);

        return $row['id'];
    }

    /**
     * أعمدة الإشعار لمستند صادر كامل.
     *
     * @return array<string, mixed>
     */
    private function generated(int $icv, string $previousHash, string $uuid, string $hash = 'aA=='): array
    {
        return [
            'status' => 'posted', 'zatca_status' => 'generated', 'zatca_skip_reason' => null, 'zatca_document_type' => 'standard',
            'zatca_reason_code' => 'goods_or_services_refund', 'issued_at' => '2026-02-10 08:15:30', 'party_snapshot' => '{"v":1}',
            'zatca_uuid' => (string) $uuid, 'zatca_icv' => $icv, 'zatca_previous_hash' => $previousHash, 'zatca_hash' => $hash,
            'zatca_qr' => 'cXI=', 'zatca_xml' => '<Invoice/>',
        ];
    }

    /**
     * محاكاة المُصدِر: مدخل السلسلة ثم تحديث الإشعار، في معاملة واحدة.
     *
     * @return array<string, mixed> أعمدة الإشعار المكتوبة
     */
    public function issue(string $tenant, string $note): array
    {
        return DB::transaction(function () use ($tenant, $note) {
            $entry = $this->entryFor($tenant, $note);
            $values = $this->generated($entry['icv'], $entry['previous_hash'], $entry['zatca_uuid'], $entry['hash']);
            DB::table('credit_notes')->where('id', $note)->update($values);

            return $values;
        });
    }

    /** إشعار مبيعات مسودة من فاتورة مرحَّلة عبر الـAPI الحقيقي. */
    private function draftSourceNote(string $token): string
    {
        $customer = $this->withToken($token)->postJson('/api/partners', ['name' => 'عميل F2', 'type' => 'customer'])->assertCreated()['data']['id'];
        $invoice = $this->withToken($token)->postJson('/api/invoices', [
            'partner_id' => $customer, 'payment_type' => 'credit',
            'items' => [['description' => 'خدمة', 'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15]],
        ])->assertCreated()['data']['id'];
        $source = $this->withToken($token)->postJson("/api/invoices/{$invoice}/post")->assertOk()['data'];

        return $this->withToken($token)->postJson('/api/credit-notes', [
            'partner_id' => $source['partner_id'], 'original_invoice_id' => $source['id'],
            'items' => [['source_line_id' => $source['lines'][0]['id'], 'quantity' => 1]],
        ])->assertCreated()['data']['id'];
    }
}
