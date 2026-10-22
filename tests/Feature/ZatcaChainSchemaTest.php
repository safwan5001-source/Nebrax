<?php

namespace Tests\Feature;

use App\Models\CreditNote;
use App\Models\Tenant;
use App\Models\ZatcaChain;
use App\Models\ZatcaChainEntry;
use App\Tenancy\CompanyWide;
use App\Tenancy\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use LogicException;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Test;
use RuntimeException;
use Tests\TestCase;

/**
 * REM-18b-1 — أساس سلسلة ZATCA المشتركة (مخطط فقط): تثبيت المخطط، التفرّد، قيود نوع المستند، عزل المستأجر، حراس
 * UPDATE/DELETE/TRUNCATE، توافق حذف المستأجر، وسلامة التراجع. تعمل على SQLite وPostgreSQL بالحالات نفسها (ما عدا TRUNCATE).
 *
 * الصفوف تُدخَل خاماً عبر `DB::table()` عمداً: الحراس المُختبَرة في القاعدة وتصمد أمام ما لا يمرّ بأحداث النموذج.
 * DDL معاملاتي في المحرّكين فتُنفَّذ اختبارات الترحيل داخل معاملة RefreshDatabase وتُستعاد بعدها.
 */
class ZatcaChainSchemaTest extends TestCase
{
    use CapturesThrowable;
    use RefreshDatabase;

    private const CHAINS_MIGRATION = '2026_11_18_010000_create_zatca_chain_tables.php';

    private const NOTES_MIGRATION = '2026_11_18_020000_add_zatca_columns_to_credit_notes.php';

    private const NOTE_COLUMNS = [
        'zatca_status', 'zatca_skip_reason', 'zatca_document_type', 'zatca_reason_code', 'issued_at', 'party_snapshot',
        'zatca_uuid', 'zatca_icv', 'zatca_previous_hash', 'zatca_hash', 'zatca_qr', 'zatca_xml',
    ];

    // ───────────────────────── تثبيت المخطط ─────────────────────────

    #[Test]
    public function the_schema_installs_empty_with_the_agreed_columns(): void
    {
        $this->assertTrue(Schema::hasTable('zatca_chains'));
        $this->assertTrue(Schema::hasTable('zatca_chain_entries'));
        $this->assertSame(0, DB::table('zatca_chains')->count());
        $this->assertSame(0, DB::table('zatca_chain_entries')->count());

        $this->assertSame([], array_diff(
            ['id', 'tenant_id', 'chain_key', 'last_icv', 'seed_icv', 'seed_legacy_count', 'seed_excluded_null_icv', 'seeded_at', 'created_at', 'updated_at'],
            Schema::getColumnListing('zatca_chains'),
        ));
        $this->assertSame([], array_diff(
            ['id', 'tenant_id', 'chain_id', 'icv', 'document_type', 'invoice_id', 'credit_note_id', 'type_code', 'subtype',
                'zatca_uuid', 'previous_hash', 'hash', 'signed', 'issued_at', 'created_at'],
            Schema::getColumnListing('zatca_chain_entries'),
        ));
        $this->assertNotContains('updated_at', Schema::getColumnListing('zatca_chain_entries'), 'المدخل لا يتغيّر: لا updated_at');
    }

    #[Test]
    public function credit_notes_gain_only_nullable_zatca_columns(): void
    {
        $columns = collect(Schema::getColumns('credit_notes'))->keyBy('name');

        foreach (self::NOTE_COLUMNS as $name) {
            $this->assertTrue($columns->has($name), $name);
            $this->assertTrue($columns[$name]['nullable'], "{$name} nullable");
            $this->assertNull($columns[$name]['default'], "{$name} بلا قيمة افتراضية");
        }
    }

    #[Test]
    public function previous_hash_and_hash_fit_a_base64_of_the_hex_digest(): void
    {
        // PIH الابتدائي (BR-KSA-26) = 88 حرفاً — تصحيح لطول 64 الوارد في مسودة التصميم.
        $genesis = base64_encode(hash('sha256', '0'));
        $this->assertSame(88, strlen($genesis));

        [$tenant, $chain] = $this->tenantWithChain();
        $invoice = $this->invoice($tenant);
        $this->insertEntry($tenant, $chain, 1, $this->invoiceEntry($invoice, ['previous_hash' => $genesis, 'hash' => $genesis]));

        $this->assertSame($genesis, DB::table('zatca_chain_entries')->value('previous_hash'));
    }

    // ───────────────────────── التفرّد ─────────────────────────

    #[Test]
    public function a_tenant_has_one_chain_per_key(): void
    {
        $tenant = $this->tenant();
        $this->insertChain($tenant);

        $e = $this->rejects(fn () => $this->insertChain($tenant));
        $this->assertMatchesRegularExpression('/zatca_chain_tenant_key_unique|zatca_chains\.tenant_id, zatca_chains\.chain_key/', $e->getMessage());
        $this->assertSame(1, DB::table('zatca_chains')->where('tenant_id', $tenant)->count());
    }

    #[Test]
    public function an_icv_is_unique_within_a_chain_and_entries_cannot_skip_or_repeat(): void
    {
        [$tenant, $chain] = $this->tenantWithChain();
        $a = $this->invoice($tenant);
        $b = $this->invoice($tenant);
        $c = $this->invoice($tenant);
        $this->insertEntry($tenant, $chain, 1, $this->invoiceEntry($a));

        $this->rejects(fn () => $this->insertEntry($tenant, $chain, 1, $this->invoiceEntry($b)), 'تكرار ICV');
        $this->rejects(fn () => $this->insertEntry($tenant, $chain, 3, $this->invoiceEntry($b)), 'قفزة ICV');
        $this->rejects(fn () => $this->insertEntry($tenant, $chain, 0, $this->invoiceEntry($b)), 'ICV صفر');

        $this->insertEntry($tenant, $chain, 2, $this->invoiceEntry($b));
        $this->insertEntry($tenant, $chain, 3, $this->invoiceEntry($c));
        $this->assertSame(3, (int) DB::table('zatca_chains')->where('id', $chain)->value('last_icv'));
        $this->assertSame(3, DB::table('zatca_chain_entries')->count());
    }

    #[Test]
    public function the_head_advances_atomically_with_each_entry_and_a_rejected_entry_leaves_it_untouched(): void
    {
        [$tenant, $chain] = $this->tenantWithChain();
        $a = $this->invoice($tenant);
        $this->insertEntry($tenant, $chain, 1, $this->invoiceEntry($a));
        $this->assertSame(1, (int) DB::table('zatca_chains')->where('id', $chain)->value('last_icv'));

        $this->rejects(fn () => $this->insertEntry($tenant, $chain, 5, $this->invoiceEntry($this->invoice($tenant))));
        $this->assertSame(1, (int) DB::table('zatca_chains')->where('id', $chain)->value('last_icv'));
        $this->assertSame(1, DB::table('zatca_chain_entries')->count());
    }

    #[Test]
    public function a_document_has_at_most_one_entry_and_a_uuid_is_unique_per_tenant(): void
    {
        [$tenant, $chain] = $this->tenantWithChain();
        $invoice = $this->invoice($tenant);
        $note = $this->creditNote($tenant);
        $uuid = (string) Str::uuid();
        $this->insertEntry($tenant, $chain, 1, $this->invoiceEntry($invoice, ['zatca_uuid' => $uuid]));

        $this->rejects(fn () => $this->insertEntry($tenant, $chain, 2, $this->invoiceEntry($invoice)), 'الفاتورة نفسها مرتين');
        $this->rejects(fn () => $this->insertEntry($tenant, $chain, 2, $this->noteEntry($note, ['zatca_uuid' => $uuid])), 'UUID مكرر');

        $this->insertEntry($tenant, $chain, 2, $this->noteEntry($note));
        $this->rejects(fn () => $this->insertEntry($tenant, $chain, 3, $this->noteEntry($note)), 'الإشعار نفسه مرتين');

        // UUID متكرر في مستأجر آخر مسموح (التفرّد لكل مستأجر).
        [$otherTenant, $otherChain] = $this->tenantWithChain();
        $this->insertEntry($otherTenant, $otherChain, 1, $this->invoiceEntry($this->invoice($otherTenant), ['zatca_uuid' => $uuid]));
        $this->assertSame(1, DB::table('zatca_chain_entries')->where('tenant_id', $otherTenant)->count());
    }

    // ───────────────────────── قيود نوع المستند ─────────────────────────

    #[Test]
    public function an_entry_references_exactly_one_document_matching_its_type_and_code(): void
    {
        [$tenant, $chain] = $this->tenantWithChain();
        $invoice = $this->invoice($tenant);
        $note = $this->creditNote($tenant);

        $bad = [
            'unknown document type' => $this->invoiceEntry($invoice, ['document_type' => 'debit_note']),
            'invoice entry without invoice' => $this->invoiceEntry($invoice, ['invoice_id' => null]),
            'both documents' => $this->invoiceEntry($invoice, ['credit_note_id' => $note]),
            'credit note entry with an invoice' => $this->noteEntry($note, ['invoice_id' => $invoice]),
            'credit note entry without a note' => $this->noteEntry($note, ['credit_note_id' => null]),
            'invoice with code 381' => $this->invoiceEntry($invoice, ['type_code' => '381']),
            'credit note with code 388' => $this->noteEntry($note, ['type_code' => '388']),
            'debit code 383' => $this->noteEntry($note, ['type_code' => '383']),
            'unknown subtype' => $this->invoiceEntry($invoice, ['subtype' => 'Standard']),
            'empty subtype' => $this->invoiceEntry($invoice, ['subtype' => '']),
            'empty hash' => $this->invoiceEntry($invoice, ['hash' => '']),
            'empty previous hash' => $this->invoiceEntry($invoice, ['previous_hash' => '']),
        ];
        foreach ($bad as $label => $row) {
            $this->rejects(fn () => $this->insertEntry($tenant, $chain, 1, $row), $label);
        }
        $this->assertSame(0, DB::table('zatca_chain_entries')->count());
        $this->assertSame(0, (int) DB::table('zatca_chains')->where('id', $chain)->value('last_icv'));

        $this->insertEntry($tenant, $chain, 1, $this->invoiceEntry($invoice, ['subtype' => 'simplified']));
        $this->insertEntry($tenant, $chain, 2, $this->noteEntry($note));
        $this->assertSame(['invoice', 'credit_note'], DB::table('zatca_chain_entries')->orderBy('icv')->pluck('document_type')->all());
    }

    #[Test]
    public function the_credit_note_status_accepts_only_the_agreed_values_or_null(): void
    {
        // قيد الحالة من 18b-1 يُختبر بمعزل عن سياج F2 (REM-18b-3b) الذي يجعل القرار لمرة واحدة؛ F2 له اختباره الخاص.
        $this->f2Migration()->down();
        $tenant = $this->tenant();
        $note = $this->creditNote($tenant);

        foreach (['generated', 'not_generated', 'disabled', null] as $value) {
            DB::table('credit_notes')->where('id', $note)->update(['zatca_status' => $value]);
            $this->assertSame($value, DB::table('credit_notes')->where('id', $note)->value('zatca_status'));
        }
        $this->rejects(fn () => DB::table('credit_notes')->where('id', $note)->update(['zatca_status' => 'issued']));
        $this->rejects(fn () => $this->creditNote($tenant, ['zatca_status' => 'bogus']));
    }

    // ───────────────────────── بذرة الرأس ─────────────────────────

    #[Test]
    public function a_chain_head_is_seeded_only_at_the_legacy_maximum_icv_of_its_tenant(): void
    {
        $tenant = $this->tenant();
        $legacyA = $this->invoice($tenant);
        $legacyB = $this->invoice($tenant);
        $this->invoice($tenant); // بلا ICV (مسودة): يُتجاهل
        $this->setLegacyIcv($legacyA, 1);
        $this->setLegacyIcv($legacyB, 7);

        $this->rejects(fn () => $this->insertChain($tenant, ['last_icv' => 0, 'seed_icv' => 0]), 'بذرة 0 مع قديم 7');
        $this->rejects(fn () => $this->insertChain($tenant, ['last_icv' => 1, 'seed_icv' => 1]), 'بذرة أقل من الأقصى');
        $this->rejects(fn () => $this->insertChain($tenant, ['last_icv' => 8, 'seed_icv' => 7]), 'رأس يتجاوز البذرة');
        $this->rejects(fn () => $this->insertChain($tenant, ['chain_key' => 'env:production', 'last_icv' => 7, 'seed_icv' => 7]), 'مفتاح غير مدعوم');
        $this->rejects(fn () => $this->insertChain($tenant, ['chain_key' => '', 'last_icv' => 7, 'seed_icv' => 7]), 'مفتاح فارغ');

        $this->insertChain($tenant, ['last_icv' => 7, 'seed_icv' => 7, 'seed_legacy_count' => 2, 'seed_excluded_null_icv' => 0]);
        $this->assertSame(7, (int) DB::table('zatca_chains')->where('tenant_id', $tenant)->value('seed_icv'));
    }

    #[Test]
    public function a_tenant_without_legacy_numbering_seeds_at_zero_and_ignores_other_tenants(): void
    {
        $other = $this->tenant();
        $this->setLegacyIcv($this->invoice($other), 41);

        $tenant = $this->tenant();
        $this->rejects(fn () => $this->insertChain($tenant, ['last_icv' => 41, 'seed_icv' => 41]), 'قديم مستأجر آخر');
        $this->insertChain($tenant);
        $this->assertSame(0, (int) DB::table('zatca_chains')->where('tenant_id', $tenant)->value('seed_icv'));
    }

    #[Test]
    public function the_first_entry_after_a_legacy_seed_continues_from_the_legacy_maximum(): void
    {
        $tenant = $this->tenant();
        $this->setLegacyIcv($this->invoice($tenant), 3);
        $chain = $this->insertChain($tenant, ['last_icv' => 3, 'seed_icv' => 3]);

        $this->rejects(fn () => $this->insertEntry($tenant, $chain, 3, $this->invoiceEntry($this->invoice($tenant))), 'إعادة استعمال ICV قديم');
        $this->rejects(fn () => $this->insertEntry($tenant, $chain, 1, $this->invoiceEntry($this->invoice($tenant))), 'ICV أقل من البذرة');
        $this->insertEntry($tenant, $chain, 4, $this->invoiceEntry($this->invoice($tenant)));
        $this->assertSame(4, (int) DB::table('zatca_chains')->where('id', $chain)->value('last_icv'));
    }

    // ───────────────────────── عزل المستأجر ─────────────────────────

    #[Test]
    public function an_entry_cannot_reference_another_tenants_chain_or_documents(): void
    {
        [$tenantA, $chainA] = $this->tenantWithChain();
        [$tenantB, $chainB] = $this->tenantWithChain();
        $invoiceB = $this->invoice($tenantB);
        $noteB = $this->creditNote($tenantB);

        $this->rejects(fn () => $this->insertEntry($tenantA, $chainA, 1, $this->invoiceEntry($invoiceB)), 'فاتورة مستأجر آخر');
        $this->rejects(fn () => $this->insertEntry($tenantA, $chainA, 1, $this->noteEntry($noteB)), 'إشعار مستأجر آخر');
        $this->rejects(fn () => $this->insertEntry($tenantA, $chainB, 1, $this->invoiceEntry($this->invoice($tenantA))), 'سلسلة مستأجر آخر');

        $this->assertSame(0, DB::table('zatca_chain_entries')->count());
        $this->assertSame([0, 0], [(int) DB::table('zatca_chains')->where('id', $chainA)->value('last_icv'), (int) DB::table('zatca_chains')->where('id', $chainB)->value('last_icv')]);
    }

    #[Test]
    public function the_models_are_company_wide_and_scoped_to_the_current_tenant(): void
    {
        $this->assertTrue(is_subclass_of(ZatcaChain::class, CompanyWide::class));
        $this->assertTrue(is_subclass_of(ZatcaChainEntry::class, CompanyWide::class));

        [$tenantA, $chainA] = $this->tenantWithChain();
        [$tenantB] = $this->tenantWithChain();
        $this->insertEntry($tenantA, $chainA, 1, $this->invoiceEntry($this->invoice($tenantA)));

        app(TenantContext::class)->set($tenantA);
        $this->assertSame([$chainA], ZatcaChain::query()->pluck('id')->all());
        $this->assertSame(1, ZatcaChainEntry::query()->count());

        app(TenantContext::class)->set($tenantB);
        $this->assertSame(1, ZatcaChain::query()->count());
        $this->assertNotSame($chainA, ZatcaChain::query()->value('id'));
        $this->assertSame(0, ZatcaChainEntry::query()->count(), 'مدخل مستأجر آخر غير مرئي');
    }

    #[Test]
    public function the_models_create_a_chain_and_entries_with_the_tenant_taken_from_context(): void
    {
        $tenant = $this->tenant();
        app(TenantContext::class)->set($tenant);
        $invoice = $this->invoice($tenant);

        $chain = ZatcaChain::create(['chain_key' => 'tenant', 'seed_icv' => 0, 'last_icv' => 0]);
        $entry = ZatcaChainEntry::create([
            'chain_id' => $chain->id, 'icv' => 1, 'document_type' => 'invoice', 'invoice_id' => $invoice, 'type_code' => '388',
            'subtype' => 'standard', 'zatca_uuid' => (string) Str::uuid(), 'previous_hash' => 'p', 'hash' => 'h',
            'signed' => false, 'issued_at' => now(),
        ]);

        $this->assertSame($tenant, $entry->tenant_id);
        $this->assertSame(1, (int) $chain->fresh()->last_icv);
        $this->assertSame($entry->id, $chain->entries()->value('id'));
    }

    // ───────────────────────── الحراس: UPDATE / DELETE / TRUNCATE ─────────────────────────

    #[Test]
    public function issued_entries_cannot_be_updated_even_by_raw_sql(): void
    {
        [$tenant, $chain] = $this->tenantWithChain();
        $id = $this->insertEntry($tenant, $chain, 1, $this->invoiceEntry($this->invoice($tenant)));

        foreach ([['hash' => 'tampered'], ['previous_hash' => 'x'], ['icv' => 9], ['signed' => true], ['subtype' => 'simplified']] as $change) {
            $this->rejects(fn () => DB::table('zatca_chain_entries')->where('id', $id)->update($change), json_encode($change));
        }
        // حتى تحديث بلا تغيير فعلي يُرفض.
        $this->rejects(fn () => DB::table('zatca_chain_entries')->where('id', $id)->update(['hash' => DB::raw('hash')]));
        $this->assertSame('h', DB::table('zatca_chain_entries')->where('id', $id)->value('hash'));
    }

    #[Test]
    public function issued_entries_and_heads_cannot_be_deleted_while_their_tenant_exists(): void
    {
        [$tenant, $chain] = $this->tenantWithChain();
        $id = $this->insertEntry($tenant, $chain, 1, $this->invoiceEntry($this->invoice($tenant)));

        $this->rejects(fn () => DB::table('zatca_chain_entries')->where('id', $id)->delete(), 'حذف مدخل');
        $this->rejects(fn () => DB::table('zatca_chain_entries')->where('tenant_id', $tenant)->delete(), 'حذف جماعي');
        $this->rejects(fn () => DB::table('zatca_chains')->where('id', $chain)->delete(), 'حذف رأس (مقيَّد أيضاً بمدخل)');
        $this->assertSame(1, DB::table('zatca_chain_entries')->count());
    }

    #[Test]
    public function an_empty_head_cannot_be_deleted_either_while_its_tenant_exists(): void
    {
        [$tenant, $chain] = $this->tenantWithChain();

        $this->rejects(fn () => DB::table('zatca_chains')->where('id', $chain)->delete());
        $this->assertSame(1, DB::table('zatca_chains')->count());
    }

    #[Test]
    public function a_soft_deleted_tenant_keeps_its_chain_protected(): void
    {
        [$tenant, $chain] = $this->tenantWithChain();
        $id = $this->insertEntry($tenant, $chain, 1, $this->invoiceEntry($this->invoice($tenant)));

        Tenant::query()->whereKey($tenant)->firstOrFail()->delete(); // SoftDeletes
        $this->assertNotNull(DB::table('tenants')->where('id', $tenant)->value('deleted_at'));

        $this->rejects(fn () => DB::table('zatca_chain_entries')->where('id', $id)->delete());
        $this->assertSame(1, DB::table('zatca_chain_entries')->count());
    }

    #[Test]
    public function the_head_only_moves_forward_by_one_with_a_matching_entry_and_keeps_its_identity(): void
    {
        [$tenant, $chain] = $this->tenantWithChain();
        $other = $this->tenant();
        $this->insertEntry($tenant, $chain, 1, $this->invoiceEntry($this->invoice($tenant)));

        $changes = [
            'jump ahead' => ['last_icv' => 9],
            'roll back' => ['last_icv' => 0],
            'same value' => ['last_icv' => 1],
            'advance without an entry' => ['last_icv' => 2],
            'key' => ['chain_key' => 'other'],
            'seed' => ['seed_icv' => 5],
            'tenant' => ['tenant_id' => $other],
            'touch only' => ['updated_at' => now()->addDay()],
        ];
        foreach ($changes as $label => $change) {
            $this->rejects(fn () => DB::table('zatca_chains')->where('id', $chain)->update($change), $label);
        }
        $this->assertSame(1, (int) DB::table('zatca_chains')->where('id', $chain)->value('last_icv'));
    }

    #[Test]
    public function documents_with_an_entry_cannot_be_deleted_on_their_own(): void
    {
        [$tenant, $chain] = $this->tenantWithChain();
        $invoice = $this->invoice($tenant);
        $note = $this->creditNote($tenant);
        $this->insertEntry($tenant, $chain, 1, $this->invoiceEntry($invoice));
        $this->insertEntry($tenant, $chain, 2, $this->noteEntry($note));

        $this->rejects(fn () => DB::table('invoices')->where('id', $invoice)->delete(), 'فاتورة بمدخل');
        $this->rejects(fn () => DB::table('credit_notes')->where('id', $note)->delete(), 'إشعار بمدخل');
        $this->assertSame(2, DB::table('zatca_chain_entries')->count());
    }

    #[Test]
    public function truncate_is_rejected_on_postgresql(): void
    {
        if (DB::connection()->getDriverName() !== 'pgsql') {
            $this->markTestSkipped('TRUNCATE غير موجود في SQLite.');
        }
        [$tenant, $chain] = $this->tenantWithChain();
        $this->insertEntry($tenant, $chain, 1, $this->invoiceEntry($this->invoice($tenant)));

        $this->rejects(fn () => DB::statement('TRUNCATE zatca_chain_entries'), 'TRUNCATE مدخلات');
        $this->rejects(fn () => DB::statement('TRUNCATE zatca_chains CASCADE'), 'TRUNCATE رؤوس');
        $this->rejects(fn () => DB::statement('TRUNCATE tenants CASCADE'), 'TRUNCATE مستأجرين متسلسل');
        $this->assertSame(1, DB::table('zatca_chain_entries')->count());
        $this->assertSame(1, DB::table('zatca_chains')->count());
    }

    #[Test]
    public function the_model_guards_give_an_early_error_on_update_and_delete(): void
    {
        $tenant = $this->tenant();
        app(TenantContext::class)->set($tenant);
        $chain = ZatcaChain::create(['chain_key' => 'tenant', 'seed_icv' => 0, 'last_icv' => 0]);
        $entry = ZatcaChainEntry::create([
            'chain_id' => $chain->id, 'icv' => 1, 'document_type' => 'invoice', 'invoice_id' => $this->invoice($tenant), 'type_code' => '388',
            'subtype' => 'standard', 'zatca_uuid' => (string) Str::uuid(), 'previous_hash' => 'p', 'hash' => 'h', 'issued_at' => now(),
        ]);

        $entry->hash = 'x';
        $this->assertThrows(fn () => $entry->save(), LogicException::class);
        $this->assertThrows(fn () => $entry->delete(), LogicException::class);
        $this->assertThrows(fn () => $chain->delete(), LogicException::class);
    }

    // ───────────────────────── توافق حذف المستأجر ─────────────────────────

    #[Test]
    public function hard_deleting_a_tenant_still_removes_everything_it_owns(): void
    {
        [$tenant, $chain] = $this->tenantWithChain();
        $invoice = $this->invoice($tenant);
        $this->insertEntry($tenant, $chain, 1, $this->invoiceEntry($invoice));
        // SQLite لا يحذف مستأجراً له إشعار دائن حتى **قبل** هذا المخطط (credit_notes.partner_id RESTRICT فوري يُفحص قبل
        // cascade العملاء)؛ فيُضاف الإشعار ومدخله على PostgreSQL فقط. المقارنة في الاختبار التالي تغطي الإشعار على المحرّكين.
        if (DB::connection()->getDriverName() === 'pgsql') {
            $this->insertEntry($tenant, $chain, 2, $this->noteEntry($this->creditNote($tenant)));
        }

        [$survivor, $survivorChain] = $this->tenantWithChain();
        $survivingInvoice = $this->invoice($survivor);
        $this->insertEntry($survivor, $survivorChain, 1, $this->invoiceEntry($survivingInvoice));

        // نفس السلوك القائم اليوم: حذف المستأجر النهائي يزيل فواتيره وإشعاراته (CASCADE) وهنا مداخله ورأسه أيضاً.
        DB::table('tenants')->where('id', $tenant)->delete();

        foreach (['invoices', 'credit_notes', 'zatca_chains', 'zatca_chain_entries'] as $table) {
            $this->assertSame(0, DB::table($table)->where('tenant_id', $tenant)->count(), $table);
        }
        $this->assertSame(1, DB::table('zatca_chain_entries')->where('tenant_id', $survivor)->count(), 'مستأجر آخر لم يتأثر');
        $this->assertSame(1, (int) DB::table('zatca_chains')->where('id', $survivorChain)->value('last_icv'));
    }

    #[Test]
    public function hard_deleting_a_tenant_whose_note_references_its_invoice_behaves_exactly_as_before_the_schema(): void
    {
        // `credit_notes.original_invoice_id` RESTRICT مع CASCADE المستأجر يفشل في SQLite **قبل** هذا المخطط أيضاً (قيد فوري
        // يُفحص بترتيب الحذف)، وينجح في PostgreSQL. المقارنة تثبّت أن الجداول الجديدة لا تغيّر النتيجة في أيٍّ منهما.
        [$tenant, $chain] = $this->tenantWithChain();
        $invoice = $this->invoice($tenant);
        $note = $this->creditNote($tenant, ['original_invoice_id' => $invoice]);
        $this->insertEntry($tenant, $chain, 1, $this->invoiceEntry($invoice));
        $this->insertEntry($tenant, $chain, 2, $this->noteEntry($note));

        $baseline = $this->tenant();
        $baselineInvoice = $this->invoice($baseline);
        $this->creditNote($baseline, ['original_invoice_id' => $baselineInvoice]);

        $deletes = static function (string $id): bool {
            try {
                DB::transaction(fn () => DB::table('tenants')->where('id', $id)->delete());

                return true;
            } catch (QueryException) {
                return false;
            }
        };

        $this->assertSame($deletes($baseline), $deletes($tenant), 'نتيجة الحذف مع الجداول الجديدة = نتيجتها بدونها');
        if (DB::connection()->getDriverName() === 'pgsql') {
            $this->assertSame(0, DB::table('zatca_chain_entries')->where('tenant_id', $tenant)->count());
            $this->assertSame(0, DB::table('zatca_chains')->where('tenant_id', $tenant)->count());
        }
    }

    // ───────────────────────── الترحيل والتراجع ─────────────────────────

    #[Test]
    public function the_chain_migration_rolls_back_and_reapplies_when_empty(): void
    {
        $this->fenceMigration()->down(); // ترتيب التراجع الحقيقي: F1 أولاً
        $this->chainsMigration()->down();
        $this->assertFalse(Schema::hasTable('zatca_chains'));
        $this->assertFalse(Schema::hasTable('zatca_chain_entries'));

        $this->chainsMigration()->up();
        $this->fenceMigration()->up();
        $this->assertTrue(Schema::hasTable('zatca_chains'));
        $this->assertTrue(Schema::hasTable('zatca_chain_entries'));

        // المُشغّلات أُعيد إنشاؤها فعلاً.
        [$tenant, $chain] = $this->tenantWithChain();
        $id = $this->insertEntry($tenant, $chain, 1, $this->invoiceEntry($this->invoice($tenant)));
        $this->rejects(fn () => DB::table('zatca_chain_entries')->where('id', $id)->update(['hash' => 'x']));
    }

    #[Test]
    public function the_chain_migration_refuses_to_roll_back_over_a_head_or_an_entry(): void
    {
        [$tenant, $chain] = $this->tenantWithChain();

        $this->assertRollbackRefused(fn () => $this->chainsMigration()->down(), 'رأس بلا مدخلات');
        $this->assertTrue(Schema::hasTable('zatca_chains'));

        $this->insertEntry($tenant, $chain, 1, $this->invoiceEntry($this->invoice($tenant)));
        $this->assertRollbackRefused(fn () => $this->chainsMigration()->down(), 'رأس ومدخل');
        $this->assertTrue(Schema::hasTable('zatca_chain_entries'));
        $this->assertSame(1, DB::table('zatca_chain_entries')->count());
    }

    #[Test]
    #[DataProvider('everyEnvironment')]
    public function rollback_refusal_does_not_depend_on_the_environment(string $environment): void
    {
        [$tenant, $chain] = $this->tenantWithChain();
        $this->insertEntry($tenant, $chain, 1, $this->invoiceEntry($this->invoice($tenant)));
        $this->app['env'] = $environment;

        $this->assertRollbackRefused(fn () => $this->chainsMigration()->down(), $environment);
    }

    /** @return array<string, array{0: string}> */
    public static function everyEnvironment(): array
    {
        return ['production' => ['production'], 'staging' => ['staging'], 'local' => ['local'], 'testing' => ['testing']];
    }

    #[Test]
    public function the_credit_note_columns_roll_back_and_reapply_when_no_artifact_exists(): void
    {
        $tenant = $this->tenant();
        $note = $this->creditNote($tenant);

        // ترتيب `migrate:rollback` الحقيقي: سياج F2 يقرأ أعمدة الإشعار فيُسقَط أولاً ويُعاد أخيراً.
        $this->f2Migration()->down();
        $this->notesMigration()->down();
        foreach (self::NOTE_COLUMNS as $column) {
            $this->assertFalse(Schema::hasColumn('credit_notes', $column), $column);
        }
        $this->assertSame(1, DB::table('credit_notes')->where('id', $note)->count(), 'الإشعار القائم لم يُمسّ');

        $this->notesMigration()->up();
        foreach (self::NOTE_COLUMNS as $column) {
            $this->assertTrue(Schema::hasColumn('credit_notes', $column), $column);
        }
        $this->f2Migration()->up();
        $this->rejects(fn () => DB::table('credit_notes')->where('id', $note)->update(['zatca_status' => 'bogus']));
    }

    /** @return array<string, array{0: string, 1: mixed}> */
    public static function issuedArtifacts(): array
    {
        return [
            'status' => ['zatca_status', 'not_generated'],
            'skip reason' => ['zatca_skip_reason', 'payment_means_unresolved'],
            'document type' => ['zatca_document_type', 'standard'],
            'reason code' => ['zatca_reason_code', 'goods_or_services_refund'],
            'issued at' => ['issued_at', '2026-02-10 08:15:30'],
            'party snapshot' => ['party_snapshot', '{"v":1}'],
            'uuid' => ['zatca_uuid', '11111111-1111-4111-8111-111111111111'],
            'icv' => ['zatca_icv', 7],
            'previous hash' => ['zatca_previous_hash', 'p'],
            'hash' => ['zatca_hash', 'h'],
            'qr' => ['zatca_qr', 'qr'],
            'xml' => ['zatca_xml', '<Invoice/>'],
        ];
    }

    #[Test]
    #[DataProvider('issuedArtifacts')]
    public function the_credit_note_migration_refuses_to_roll_back_over_any_issued_artifact(string $column, mixed $value): void
    {
        // قيم مفردة بلا مستند مكتمل لا يقبلها سياج F2؛ نُسقطه لنُبقي الاختبار على رفض تراجع 18b-1 وحده.
        $this->f2Migration()->down();
        $tenant = $this->tenant();
        $this->creditNote($tenant, [$column => $value]);

        $this->assertRollbackRefused(fn () => $this->notesMigration()->down(), $column);
        $this->assertTrue(Schema::hasColumn('credit_notes', $column), 'الأعمدة باقية بعد الرفض');
        $this->assertSame(1, DB::table('credit_notes')->whereNotNull($column)->count());
    }

    #[Test]
    public function the_migrations_leave_existing_invoice_and_credit_note_rows_untouched(): void
    {
        // ترتيب `migrate:rollback` الحقيقي: السياج F1 (REM-18b-2) أولاً لأنه يقرأ جداول السلسلة.
        $this->f2Migration()->down();
        $this->fenceMigration()->down();
        $this->notesMigration()->down();
        $this->chainsMigration()->down();

        $tenant = $this->tenant();
        $invoice = $this->invoice($tenant);
        $this->setLegacyIcv($invoice, 5);
        $note = $this->creditNote($tenant, ['original_invoice_id' => $invoice]);
        $invoicesBefore = DB::table('invoices')->orderBy('id')->get()->map(fn ($r) => (array) $r)->all();
        $notesBefore = DB::table('credit_notes')->orderBy('id')->get()->map(fn ($r) => (array) $r)->all();

        $this->chainsMigration()->up();
        $this->notesMigration()->up();
        $this->fenceMigration()->up();
        $this->f2Migration()->up();

        $this->assertSame($invoicesBefore, DB::table('invoices')->orderBy('id')->get()->map(fn ($r) => (array) $r)->all(), 'الفواتير كما هي بايتاً ببايت');
        $afterNotes = DB::table('credit_notes')->orderBy('id')->get()->map(fn ($r) => (array) $r)->all();
        foreach ($afterNotes as $i => $row) {
            foreach (self::NOTE_COLUMNS as $column) {
                $this->assertNull($row[$column], $column);
                unset($row[$column]);
            }
            $this->assertSame($notesBefore[$i], $row, 'الأعمدة القديمة للإشعار كما هي');
        }
        $this->assertSame(0, DB::table('zatca_chains')->count(), 'لا Backfill');
        $this->assertSame(0, DB::table('zatca_chain_entries')->count(), 'لا Backfill');
        $this->assertSame($note, DB::table('credit_notes')->value('id'));
    }

    // ───────────────────────── لا ربط بالمسارات القائمة ─────────────────────────

    #[Test]
    public function only_the_allocator_and_its_issuers_write_the_chain(): void
    {
        // المخصِّص هو الكاتب الوحيد: عبر ZatcaService للفواتير (REM-18b-2) وعبر ZatcaCreditNoteIssuer للإشعارات الدائنة النقدية (REM-18b-3c).
        // ZatcaIssuedDocumentIntegrity قارئ فقط (حارس ما قبل الإرسال) — يُتحقق من ذلك أدناه.
        $allowed = ['ZatcaChain.php', 'ZatcaChainEntry.php', 'ZatcaChainAllocator.php', 'ZatcaChainSlot.php', 'ZatcaService.php', 'ZatcaIssuedDocumentIntegrity.php', 'ZatcaCreditNoteIssuer.php'];
        $hits = [];
        $iterator = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator(base_path('app'), \FilesystemIterator::SKIP_DOTS));
        foreach ($iterator as $file) {
            if (! $file->isFile() || $file->getExtension() !== 'php' || in_array($file->getFilename(), $allowed, true)) {
                continue;
            }
            if (preg_match('/ZatcaChain|zatca_chain|zatca_chains/', (string) file_get_contents($file->getPathname())) === 1) {
                $hits[] = $file->getPathname();
            }
        }
        $this->assertSame([], $hits, 'لا كاتب للسلسلة خارج المخصِّص.');

        $guard = (string) file_get_contents(base_path('app/Services/Accounting/ZatcaIssuedDocumentIntegrity.php'));
        $this->assertDoesNotMatchRegularExpression(
            '/->(save|create|insert|update|delete|forceDelete|upsert|increment|decrement)\(|DB::(table|statement|unprepared|insert|update|delete)|new ZatcaChain(Entry)?\(/',
            $guard,
            'حارس سلامة المستند الصادر قراءة فقط',
        );

        $fillable = (new CreditNote())->getFillable();
        foreach (self::NOTE_COLUMNS as $column) {
            $this->assertNotContains($column, $fillable, "{$column} لا يدخل \$fillable قبل REM-18b-3");
        }
        $service = (string) file_get_contents(base_path('app/Services/Accounting/CreditNoteService.php'));
        // REM-18b-3c: الإصدار عبر ZatcaCreditNoteIssuer وحده؛ الخدمة لا تلمس المخصِّص ولا البانيّ مباشرةً.
        $this->assertDoesNotMatchRegularExpression('/ZatcaChainAllocator|ZatcaCreditNoteXml|recordInvoice|recordCreditNote|->record\(/', $service, 'CreditNoteService لا يلمس السلسلة أو البانيّ مباشرةً');
        $this->assertStringContainsString('ZatcaCreditNoteIssuer', $service);
    }

    // ───────────────────────── مساعدات ─────────────────────────

    private function chainsMigration(): object
    {
        return require database_path('migrations/'.self::CHAINS_MIGRATION);
    }

    private function fenceMigration(): object
    {
        return require database_path('migrations/2026_11_19_010000_add_zatca_chain_fence_to_invoices.php');
    }

    private function f2Migration(): object
    {
        return require database_path('migrations/2026_11_22_010000_add_zatca_credit_note_fences.php');
    }

    private function notesMigration(): object
    {
        return require database_path('migrations/'.self::NOTES_MIGRATION);
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

    private function assertRollbackRefused(callable $rollback, string $label): void
    {
        $e = $this->thrown($rollback, "rollback must be refused: {$label}");
        $this->assertStringContainsString('Rollback refused', $e->getMessage(), $label);
    }

    private function tenant(): string
    {
        return Tenant::create([
            'name' => 'مستأجر سلسلة', 'slug' => 'zatca-chain-'.Str::random(10),
            'vat_number' => '300000000000003', 'currency' => 'SAR', 'is_active' => true,
        ])->id;
    }

    /** @return array{0: string, 1: string} [tenantId, chainId] */
    private function tenantWithChain(): array
    {
        $tenant = $this->tenant();

        return [$tenant, $this->insertChain($tenant)];
    }

    /** @param array<string, mixed> $overrides */
    private function insertChain(string $tenant, array $overrides = []): string
    {
        $row = array_merge([
            'id' => (string) Str::uuid(), 'tenant_id' => $tenant, 'chain_key' => 'tenant',
            'last_icv' => 0, 'seed_icv' => 0, 'created_at' => now(), 'updated_at' => now(),
        ], $overrides);
        DB::table('zatca_chains')->insert($row);

        return $row['id'];
    }

    private function partner(string $tenant): string
    {
        static $cache = [];
        $key = $tenant;
        if (! isset($cache[$key]) || DB::table('partners')->where('id', $cache[$key])->doesntExist()) {
            $cache[$key] = (string) Str::uuid();
            DB::table('partners')->insert([
                'id' => $cache[$key], 'tenant_id' => $tenant, 'name' => 'عميل', 'type' => 'customer',
                'created_at' => now(), 'updated_at' => now(),
            ]);
        }

        return $cache[$key];
    }

    private function invoice(string $tenant): string
    {
        $id = (string) Str::uuid();
        DB::table('invoices')->insert([
            'id' => $id, 'tenant_id' => $tenant, 'number' => 'INV-'.Str::random(8), 'partner_id' => $this->partner($tenant),
            'invoice_date' => '2026-02-10', 'created_at' => now(), 'updated_at' => now(),
        ]);

        return $id;
    }

    /** @param array<string, mixed> $overrides */
    private function creditNote(string $tenant, array $overrides = []): string
    {
        $id = (string) Str::uuid();
        DB::table('credit_notes')->insert(array_merge([
            'id' => $id, 'tenant_id' => $tenant, 'number' => 'CN-'.Str::random(8), 'partner_id' => $this->partner($tenant),
            'note_date' => '2026-02-10', 'created_at' => now(), 'updated_at' => now(),
        ], $overrides));

        return $id;
    }

    private function setLegacyIcv(string $invoice, int $icv): void
    {
        DB::table('invoices')->where('id', $invoice)->update(['zatca_icv' => $icv, 'zatca_hash' => 'legacy-'.$icv]);
    }

    /**
     * @param array<string, mixed> $overrides
     * @return array<string, mixed>
     */
    private function invoiceEntry(string $invoice, array $overrides = []): array
    {
        return array_merge([
            'document_type' => 'invoice', 'invoice_id' => $invoice, 'credit_note_id' => null, 'type_code' => '388', 'subtype' => 'standard',
        ], $overrides);
    }

    /**
     * @param array<string, mixed> $overrides
     * @return array<string, mixed>
     */
    private function noteEntry(string $note, array $overrides = []): array
    {
        return array_merge([
            'document_type' => 'credit_note', 'invoice_id' => null, 'credit_note_id' => $note, 'type_code' => '381', 'subtype' => 'standard',
        ], $overrides);
    }

    /** @param array<string, mixed> $document */
    private function insertEntry(string $tenant, string $chain, int $icv, array $document): string
    {
        $row = array_merge([
            'id' => (string) Str::uuid(), 'tenant_id' => $tenant, 'chain_id' => $chain, 'icv' => $icv,
            'zatca_uuid' => (string) Str::uuid(), 'previous_hash' => 'p', 'hash' => 'h', 'signed' => false,
            'issued_at' => '2026-02-10 08:15:30', 'created_at' => now(),
        ], $document);
        DB::table('zatca_chain_entries')->insert($row);

        return $row['id'];
    }
}
