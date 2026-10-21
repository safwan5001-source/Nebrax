<?php

namespace Tests\Feature;

use App\Models\Invoice;
use App\Models\JournalEntry;
use App\Models\Partner;
use App\Models\Tenant;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\InvoiceService;
use App\Services\Accounting\ZatcaChainAllocator;
use App\Services\Accounting\ZatcaInvoiceHasher;
use App\Services\Accounting\ZatcaService;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Test;
use ReflectionMethod;
use RuntimeException;
use Tests\TestCase;

/**
 * REM-18b-2 — مخصِّص سلسلة ZATCA المشتركة للفواتير + السياج F1 (SQLite وPostgreSQL).
 *
 * يثبت: استمرار PIH من السجل القديم إلى المداخل الجديدة؛ تطابق ICV/PIH وXML مع القاعدة القديمة (`max+1` وهاش XML السابق)؛
 * الفاتورة القياسية والمبسّطة في سلسلة واحدة؛ عزل المستأجرين؛ التراجع بلا ICV مستهلك؛ الفشل المغلق على XML قديم مفقود/تالف
 * أو مستند سابق عُدّل بعد صدوره؛ F-6 (فاتورة بلا ICV لا تصير رأساً)؛ والسياج F1 أمام الكاتب القديم وسلوك النشر المختلط.
 * التزامن الحقيقي على PostgreSQL في `ZatcaChainAllocatorPostgresTest`.
 */
class ZatcaChainAllocatorTest extends TestCase
{
    use CapturesThrowable;
    use RefreshDatabase;

    private Tenant $tenant;

    private Partner $customer;

    protected function setUp(): void
    {
        parent::setUp();
        [$this->tenant, $this->customer] = $this->makeTenant('awj-chain-allocator');
    }

    // ───────────────────────── السلسلة الجديدة ─────────────────────────

    #[Test]
    public function the_first_invoice_of_a_new_tenant_opens_the_chain_at_one_with_the_official_genesis(): void
    {
        $invoice = $this->issue();

        $this->assertSame(1, (int) $invoice->zatca_icv);
        $this->assertSame(ZatcaChainAllocator::genesisHash(), $invoice->zatca_previous_hash);
        $this->assertSame(app(ZatcaService::class)->genesisHash(), ZatcaChainAllocator::genesisHash());

        $chain = DB::table('zatca_chains')->where('tenant_id', $this->tenant->id)->first();
        $this->assertSame(['tenant', 0, 1], [$chain->chain_key, (int) $chain->seed_icv, (int) $chain->last_icv]);
        $this->assertSame(0, (int) $chain->seed_legacy_count);

        $entry = DB::table('zatca_chain_entries')->where('invoice_id', $invoice->id)->first();
        $this->assertSame([1, 'invoice', '388', 'standard', false], [(int) $entry->icv, $entry->document_type, $entry->type_code, $entry->subtype, (bool) $entry->signed]);
        $this->assertSame($invoice->zatca_uuid, $entry->zatca_uuid);
        $this->assertSame($invoice->zatca_hash, $entry->hash);
        $this->assertSame($invoice->zatca_previous_hash, $entry->previous_hash);
        $this->assertSame(app(ZatcaInvoiceHasher::class)->hash($invoice->zatca_xml), $entry->hash);
    }

    #[Test]
    public function invoices_chain_one_after_another_with_standard_and_simplified_in_the_same_chain(): void
    {
        $posted = [$this->issue('standard'), $this->issue('simplified'), $this->issue('standard'), $this->issue('simplified')];

        foreach ($posted as $i => $invoice) {
            $this->assertSame($i + 1, (int) $invoice->zatca_icv);
            if ($i > 0) {
                $this->assertSame($posted[$i - 1]->zatca_hash, $invoice->zatca_previous_hash);
            }
        }
        $this->assertSame(['standard', 'simplified', 'standard', 'simplified'],
            DB::table('zatca_chain_entries')->orderBy('icv')->pluck('subtype')->all());
        $this->assertSame(4, (int) DB::table('zatca_chains')->where('tenant_id', $this->tenant->id)->value('last_icv'));
        $this->assertChainWalks($this->tenant);
    }

    #[Test]
    public function icv_pih_and_xml_are_exactly_what_the_previous_rule_produced(): void
    {
        // القاعدة القديمة (ZatcaService قبل REM-18b-2): ICV = max(invoices.zatca_icv)+1، وPIH = هاش XML الفاتورة صاحبة ذلك الأقصى.
        $service = app(ZatcaService::class);
        $build = new ReflectionMethod(ZatcaService::class, 'buildXml');
        $attach = new ReflectionMethod(ZatcaService::class, 'attachQr');
        $hasher = app(ZatcaInvoiceHasher::class);

        foreach (['standard', 'simplified', 'standard'] as $type) {
            $max = Invoice::query()->whereNotNull('zatca_icv')->max('zatca_icv');
            $expectedIcv = (int) $max + 1;
            $expectedPrev = $max === null ? $service->genesisHash()
                : $hasher->hash((string) Invoice::query()->where('zatca_icv', $max)->value('zatca_xml'));

            $invoice = $this->issue($type)->load('lines');

            $this->assertSame($expectedIcv, (int) $invoice->zatca_icv, $type);
            $this->assertSame($expectedPrev, $invoice->zatca_previous_hash, $type);
            // XML بايتاً ببايت = ما كان سيبنيه الكود السابق بالمدخلات نفسها (UUID ولحظة الإصدار واللقطة المخزَّنة).
            $parties = \App\Support\ZatcaPartyXml::requireSnapshot($invoice);
            $expectedXml = $attach->invoke($service, $build->invoke($service, $invoice, $parties, $invoice->zatca_uuid, $expectedIcv, $expectedPrev), $invoice->zatca_qr);
            $this->assertSame($expectedXml, $invoice->zatca_xml, $type);
        }
    }

    // ───────────────────────── الانتقال من السجل القديم ─────────────────────────

    #[Test]
    public function the_first_entry_continues_from_the_stored_xml_of_the_last_legacy_invoice(): void
    {
        $xml = $this->xmlFromAnotherTenant();
        $hasher = app(ZatcaInvoiceHasher::class);
        $this->insertLegacy(1, $xml, 'raw-hash-1');
        $this->insertLegacy(2, $xml.' ', 'raw-hash-2');
        $last = str_replace('<cbc:ProfileID>', '<!-- legacy 3 --><cbc:ProfileID>', $xml);
        // هاش عمود قديم «خام» يختلف عن الهاش المعياري: PIH يُشتق من XML لا من العمود (REM-17).
        $this->insertLegacy(3, $last, base64_encode(hash('sha256', $last, true)));

        $next = $this->issue();

        $this->assertSame(4, (int) $next->zatca_icv);
        $this->assertSame($hasher->hash($last), $next->zatca_previous_hash);
        $this->assertNotSame(base64_encode(hash('sha256', $last, true)), $next->zatca_previous_hash);
        $chain = DB::table('zatca_chains')->where('tenant_id', $this->tenant->id)->first();
        $this->assertSame([3, 4, 3], [(int) $chain->seed_icv, (int) $chain->last_icv, (int) $chain->seed_legacy_count]);

        // بعد أول مدخل لا رجوع إلى القديم: التالي يتبع المدخل الجديد.
        $after = $this->issue();
        $this->assertSame(5, (int) $after->zatca_icv);
        $this->assertSame($next->zatca_hash, $after->zatca_previous_hash);
    }

    #[Test]
    public function a_legacy_chain_that_started_from_the_pre_rem17_genesis_is_continued_and_never_repaired(): void
    {
        $xml = str_replace('>'.ZatcaChainAllocator::genesisHash().'<', '>'.ZatcaService::LEGACY_GENESIS_HASH.'<', $this->xmlFromAnotherTenant());
        $id = $this->insertLegacy(1, $xml, app(ZatcaInvoiceHasher::class)->hash($xml), ZatcaService::LEGACY_GENESIS_HASH);
        $before = (array) DB::table('invoices')->where('id', $id)->first();

        $next = $this->issue();

        $this->assertSame(2, (int) $next->zatca_icv);
        $this->assertSame($before['zatca_hash'], $next->zatca_previous_hash);
        $this->assertSame($before, (array) DB::table('invoices')->where('id', $id)->first(), 'الصف التاريخي لم يُمسّ');
    }

    #[Test]
    public function a_posted_invoice_without_icv_never_becomes_the_head_f6(): void
    {
        $xml = $this->xmlFromAnotherTenant();
        $this->insertLegacy(1, $xml, 'h1');
        $this->insertLegacy(2, $xml.' ', 'h2');
        // فاتورة قديمة رُحّلت بهاش قبل وجود ICV (شكل ما بين الهجرتين 000012 و000013)، أُدرجت **بعد** غيرها. ORDER BY zatca_icv DESC
        // كان يضعها أولاً في PostgreSQL (NULLS FIRST) فيبدأ العدّ من 1 من جديد.
        $this->insertLegacy(null, '<x/>', 'phase-one-only');

        $next = $this->issue();

        $this->assertSame(3, (int) $next->zatca_icv);
        $this->assertSame(app(ZatcaInvoiceHasher::class)->hash($xml.' '), $next->zatca_previous_hash);
        $chain = DB::table('zatca_chains')->where('tenant_id', $this->tenant->id)->first();
        $this->assertSame([2, 2, 1], [(int) $chain->seed_icv, (int) $chain->seed_legacy_count, (int) $chain->seed_excluded_null_icv]);
    }

    #[Test]
    public function missing_or_malformed_legacy_xml_fails_closed_without_consuming_anything(): void
    {
        foreach (['missing' => null, 'blank' => '   ', 'malformed' => '<Invoice><broken>', 'dtd' => '<!DOCTYPE x [<!ENTITY a "b">]><x>&a;</x>'] as $label => $xml) {
            DB::beginTransaction();
            try {
                $this->insertLegacy(1, $xml, 'h');
                $draft = $this->draft();
                $e = $this->runtimeFailure(fn () => app(InvoiceService::class)->post($draft), $label);
                $this->assertStringContainsString('ZATCA', $e->getMessage(), $label);
                $this->assertSame('draft', $draft->fresh()->status, $label);
                $this->assertNull($draft->fresh()->zatca_icv, $label);
                $this->assertSame(0, DB::table('zatca_chains')->where('tenant_id', $this->tenant->id)->count(), "{$label}: لا رأس يتيم");
                $this->assertSame(0, DB::table('zatca_chain_entries')->count(), $label);
                $this->assertSame(0, JournalEntry::query()->where('source_id', $draft->id)->count(), "{$label}: لا قيد");
            } finally {
                DB::rollBack();
            }
        }
    }

    #[Test]
    public function a_previous_document_whose_xml_changed_after_issue_stops_the_chain(): void
    {
        $first = $this->issue();
        // XML ليس مجمَّداً في القاعدة (مسار الإرسال وفحوصه يعتمدان ذلك)، لكن السلسلة لا تُبنى على مستند غير ما صدر.
        // تغيير دلالي (لا مسافة بعد الجذر: تلك لا تغيّر الشكل المعياري ولا الهاش).
        $changed = str_replace('<cbc:ProfileID>reporting:1.0</cbc:ProfileID>', '<cbc:ProfileID>reporting:1.1</cbc:ProfileID>', $first->zatca_xml);
        $this->assertNotSame($first->zatca_xml, $changed);
        DB::table('invoices')->where('id', $first->id)->update(['zatca_xml' => $changed]);
        $draft = $this->draft();

        $e = $this->runtimeFailure(fn () => app(InvoiceService::class)->post($draft), 'tampered previous XML');
        $this->assertStringContainsString('لا يطابق الهاش', $e->getMessage());
        $this->assertSame('draft', $draft->fresh()->status);
        $this->assertSame(1, (int) DB::table('zatca_chains')->where('tenant_id', $this->tenant->id)->value('last_icv'));
    }

    // ───────────────────────── العزل والتراجع وعدم التكرار ─────────────────────────

    #[Test]
    public function tenants_keep_independent_chains(): void
    {
        [$other, $otherCustomer] = $this->makeTenant('awj-chain-allocator-other');

        $this->useTenant($this->tenant);
        $a1 = $this->issue();
        $this->useTenant($other, $otherCustomer);
        $b1 = $this->issue();
        $b2 = $this->issue();
        $this->useTenant($this->tenant);
        $a2 = $this->issue();

        $this->assertSame([1, 2], [(int) $a1->zatca_icv, (int) $a2->zatca_icv]);
        $this->assertSame([1, 2], [(int) $b1->zatca_icv, (int) $b2->zatca_icv]);
        $this->assertSame($a1->zatca_hash, $a2->zatca_previous_hash);
        $this->assertSame(ZatcaChainAllocator::genesisHash(), $b1->zatca_previous_hash);
        $this->assertSame(2, DB::table('zatca_chains')->count());
        $this->assertSame(2, DB::table('zatca_chain_entries')->where('tenant_id', $other->id)->count());
        $this->assertSame(1, \App\Models\ZatcaChain::query()->count(), 'نطاق المستأجر على النموذج');
    }

    #[Test]
    public function a_failure_after_signing_rolls_back_the_entry_and_the_head_and_the_icv_is_reissued(): void
    {
        $this->issue();
        app()->bind(InvoiceService::class, fn ($app) => $app->build(Rem04FlakyInvoiceService::class));
        Rem04FlakyInvoiceService::reset(1, 'HY000');
        $draft = $this->draft();

        try {
            app(InvoiceService::class)->post($draft);
            $this->fail('settle() failure must propagate');
        } catch (QueryException) {
            $this->addToAssertionCount(1);
        }
        $this->assertSame('draft', $draft->fresh()->status);
        $this->assertSame(1, (int) DB::table('zatca_chains')->where('tenant_id', $this->tenant->id)->value('last_icv'));
        $this->assertSame(1, DB::table('zatca_chain_entries')->count());

        $reposted = app(InvoiceService::class)->post($draft->fresh());
        $this->assertSame(2, (int) $reposted->zatca_icv, 'لا فجوة: ICV نفسه يُعاد بعد تراجع غير ملتزَم');
    }

    #[Test]
    public function a_posted_invoice_is_never_issued_twice(): void
    {
        $draft = $this->draft();
        app(InvoiceService::class)->post($draft);

        $this->runtimeFailure(fn () => app(InvoiceService::class)->post($draft->fresh()), 'second post');
        $this->assertSame(1, DB::table('zatca_chain_entries')->where('invoice_id', $draft->id)->count());
        $this->assertSame(1, (int) DB::table('zatca_chains')->where('tenant_id', $this->tenant->id)->value('last_icv'));
    }

    #[Test]
    public function reserve_refuses_a_tenant_other_than_the_current_context(): void
    {
        [$other] = $this->makeTenant('awj-chain-allocator-ctx');
        $this->useTenant($this->tenant);

        $this->expectException(RuntimeException::class);
        app(ZatcaChainAllocator::class)->reserve($other->id);
    }

    #[Test]
    public function posting_creates_no_submission_attempt_and_dispatch_stays_disabled(): void
    {
        $this->issue();

        $this->assertFalse((bool) config('zatca.transport.dispatch_enabled'));
        $this->assertSame(0, DB::table('zatca_submission_attempts')->count());
    }

    // ───────────────────────── السياج F1 والنشر المختلط ─────────────────────────

    #[Test]
    public function once_a_tenant_has_a_chain_an_icv_without_a_matching_entry_is_rejected(): void
    {
        $issued = $this->issue();
        $draft = $this->draft();
        $hasher = app(ZatcaInvoiceHasher::class);

        // ما كان الإصدار السابق سيكتبه بالضبط: max+1 وهاش XML السابق — بلا مدخل سلسلة.
        $oldWriter = [
            'status' => 'posted', 'zatca_icv' => 2, 'zatca_uuid' => (string) Str::uuid(),
            'zatca_previous_hash' => $hasher->hash($issued->zatca_xml), 'zatca_hash' => 'h', 'zatca_xml' => '<x/>',
        ];
        $this->rejects(fn () => DB::table('invoices')->where('id', $draft->id)->update($oldWriter), 'كاتب قديم');
        $this->rejects(fn () => DB::table('invoices')->where('id', $draft->id)->update(['zatca_icv' => 99]), 'ICV وحده');
        $this->rejects(fn () => DB::table('invoices')->insert($this->legacyRow(2, '<x/>', 'h')), 'إدراج بICV');
        // ولا مدخلٌ لفاتورة أخرى يكفي: المطابقة على الفاتورة نفسها وقيمها كلها.
        $this->rejects(fn () => DB::table('invoices')->where('id', $draft->id)->update([
            'zatca_icv' => 1, 'zatca_uuid' => $issued->zatca_uuid, 'zatca_previous_hash' => $issued->zatca_previous_hash, 'zatca_hash' => $issued->zatca_hash,
        ]), 'نسخ قيم مدخل فاتورة أخرى');

        $this->assertNull(DB::table('invoices')->where('id', $draft->id)->value('zatca_icv'));
        $this->assertSame(1, (int) DB::table('zatca_chains')->where('tenant_id', $this->tenant->id)->value('last_icv'));
        // والمخصِّص نفسه يمرّ.
        $this->assertSame(2, (int) app(InvoiceService::class)->post($draft->fresh())->zatca_icv);
    }

    #[Test]
    public function the_chain_identity_of_an_issued_invoice_is_frozen_while_other_columns_stay_writable(): void
    {
        $issued = $this->issue();

        foreach ([['zatca_icv' => 7], ['zatca_icv' => null], ['zatca_uuid' => (string) Str::uuid()], ['zatca_previous_hash' => 'x']] as $change) {
            $this->rejects(fn () => DB::table('invoices')->where('id', $issued->id)->update($change), json_encode($change));
        }
        // ما يكتبه مسار الإرسال (XML المعتمد من المنصة) وما تكشفه فحوص ما قبل الإرسال يبقى قابلاً للكتابة كاليوم.
        DB::table('invoices')->where('id', $issued->id)->update(['zatca_cleared_xml' => '<cleared/>']);
        DB::table('invoices')->where('id', $issued->id)->update(['zatca_hash' => 'tampered']);
        $this->assertSame('tampered', DB::table('invoices')->where('id', $issued->id)->value('zatca_hash'));
        $this->assertSame($issued->zatca_hash, DB::table('zatca_chain_entries')->where('invoice_id', $issued->id)->value('hash'), 'المدخل ثابت');
    }

    #[Test]
    public function an_old_instance_keeps_working_until_the_tenant_opens_its_chain_and_is_fenced_afterwards(): void
    {
        // نسخة قديمة تعمل أثناء النشر: قبل أن يملك المستأجر رأس سلسلة تكتب max+1 مباشرةً على invoices — مسموح، وهو ما
        // كانت ستبدأ منه البذرة نفسها.
        $xml = $this->xmlFromAnotherTenant();
        $legacy = $this->draft();
        DB::table('invoices')->where('id', $legacy->id)->update([
            'status' => 'posted', 'zatca_icv' => 1, 'zatca_uuid' => (string) Str::uuid(),
            'zatca_previous_hash' => ZatcaChainAllocator::genesisHash(), 'zatca_hash' => 'old-1', 'zatca_xml' => $xml,
        ]);

        // نسخة جديدة ترحّل: البذرة = 1 (يتحقق منها المُشغّل T6) ثم ICV 2 بهاش XML القديم.
        $new = $this->issue();
        $this->assertSame(2, (int) $new->zatca_icv);
        $this->assertSame(app(ZatcaInvoiceHasher::class)->hash($xml), $new->zatca_previous_hash);

        // بعدها النسخة القديمة لهذا المستأجر تفشل مغلقة: max+1 = 3 بلا مدخل.
        $late = $this->draft();
        $this->rejects(fn () => DB::table('invoices')->where('id', $late->id)->update([
            'status' => 'posted', 'zatca_icv' => 3, 'zatca_uuid' => (string) Str::uuid(),
            'zatca_previous_hash' => app(ZatcaInvoiceHasher::class)->hash($new->zatca_xml), 'zatca_hash' => 'old-3', 'zatca_xml' => '<x/>',
        ]), 'كاتب قديم بعد فتح السلسلة');

        // ومستأجر آخر لم يفتح سلسلته بعد لا يتأثر.
        [$other, $otherCustomer] = $this->makeTenant('awj-chain-allocator-untouched');
        $this->useTenant($other, $otherCustomer);
        $untouched = $this->draft();
        DB::table('invoices')->where('id', $untouched->id)->update(['status' => 'posted', 'zatca_icv' => 1, 'zatca_hash' => 'old', 'zatca_xml' => $xml]);
        $this->assertSame(1, (int) DB::table('invoices')->where('id', $untouched->id)->value('zatca_icv'));
    }

    #[Test]
    public function the_fence_migration_refuses_to_roll_back_after_the_first_chain_entry(): void
    {
        $migration = require database_path('migrations/2026_11_19_010000_add_zatca_chain_fence_to_invoices.php');

        $migration->down();
        $migration->up();

        $this->issue();
        $e = $this->runtimeFailure(fn () => $migration->down(), 'fence rollback');
        $this->assertStringContainsString('Rollback refused', $e->getMessage());
        // السياج ما زال فعّالاً.
        $draft = $this->draft();
        $this->rejects(fn () => DB::table('invoices')->where('id', $draft->id)->update(['zatca_icv' => 2]));
    }

    // ───────────────────────── مساعدات ─────────────────────────

    /** @return array{0: Tenant, 1: Partner} */
    private function makeTenant(string $slug): array
    {
        $tenant = Tenant::create(['name' => 'شركة '.$slug, 'slug' => $slug.'-'.Str::random(6), 'vat_number' => '300000000000003', 'currency' => 'SAR']);
        app(TenantContext::class)->set($tenant->id);
        app(BranchContext::class)->forget();
        app(ChartOfAccountsSeeder::class)->seed($tenant->id);
        $customer = Partner::create(['name' => 'عميل', 'type' => 'customer']);

        return [$tenant, $customer];
    }

    private function useTenant(Tenant $tenant, ?Partner $customer = null): void
    {
        app(TenantContext::class)->set($tenant->id);
        if ($customer !== null) {
            $this->customer = $customer;
        } elseif ($tenant->is($this->tenant)) {
            $this->customer = Partner::query()->where('tenant_id', $tenant->id)->firstOrFail();
        }
    }

    private function draft(string $type = 'standard'): Invoice
    {
        return app(InvoiceService::class)->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'cash', 'zatca_document_type' => $type],
            [['description' => 'خدمة', 'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15]],
        );
    }

    private function issue(string $type = 'standard'): Invoice
    {
        return app(InvoiceService::class)->post($this->draft($type));
    }

    /** XML فاتورة رُحّلت فعلاً في مستأجر منفصل (مصدر نصّ واقعي لصفوف قديمة)؛ يعود السياق بعدها. */
    private function xmlFromAnotherTenant(): string
    {
        $current = $this->tenant;
        $customer = $this->customer;
        [$source, $sourceCustomer] = $this->makeTenant('awj-chain-legacy-source');
        $this->customer = $sourceCustomer;
        $xml = $this->issue()->zatca_xml;
        app(TenantContext::class)->set($current->id);
        $this->customer = $customer;

        return $xml;
    }

    /** @return array<string, mixed> */
    private function legacyRow(?int $icv, ?string $xml, string $hash, ?string $previous = null): array
    {
        return [
            'id' => (string) Str::uuid(), 'tenant_id' => $this->tenant->id, 'number' => 'INV-LEGACY-'.Str::random(6),
            'partner_id' => $this->customer->id, 'invoice_date' => '2026-01-10', 'status' => 'posted',
            'zatca_document_type' => 'standard', 'zatca_icv' => $icv, 'zatca_uuid' => (string) Str::uuid(),
            'zatca_xml' => $xml, 'zatca_hash' => $hash, 'zatca_previous_hash' => $previous ?? 'legacy-prev',
            'created_at' => now(), 'updated_at' => now(),
        ];
    }

    /** صفّ فاتورة كما كتبه الإصدار السابق (ICV على invoices بلا مدخل) — قبل أن يملك المستأجر رأس سلسلة. */
    private function insertLegacy(?int $icv, ?string $xml, string $hash, ?string $previous = null): string
    {
        $row = $this->legacyRow($icv, $xml, $hash, $previous);
        DB::table('invoices')->insert($row);

        return $row['id'];
    }

    private function runtimeFailure(callable $operation, string $label): RuntimeException
    {
        return $this->thrown($operation, "expected a RuntimeException: {$label}");
    }

    private function rejects(callable $operation, string $label = ''): void
    {
        try {
            DB::transaction($operation);
        } catch (QueryException) {
            $this->addToAssertionCount(1);

            return;
        }
        $this->fail('the database was expected to reject this operation'.($label !== '' ? ": {$label}" : ''));
    }

    private function assertChainWalks(Tenant $tenant): void
    {
        $hasher = app(ZatcaInvoiceHasher::class);
        $entries = DB::table('zatca_chain_entries')->where('tenant_id', $tenant->id)->orderBy('icv')->get();
        foreach ($entries as $i => $entry) {
            $xml = (string) DB::table('invoices')->where('id', $entry->invoice_id)->value('zatca_xml');
            $this->assertSame($entry->hash, $hasher->hash($xml));
            if ($i > 0) {
                $this->assertSame($entries[$i - 1]->hash, $entry->previous_hash);
                $this->assertSame((int) $entries[$i - 1]->icv + 1, (int) $entry->icv);
            }
        }
    }
}
