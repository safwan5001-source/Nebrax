<?php

namespace Tests\Feature;

use App\Models\Invoice;
use App\Models\JournalEntry;
use App\Models\Partner;
use App\Models\ZatcaCredential;
use App\Services\Accounting\InvoiceService;
use App\Services\Accounting\ZatcaInvoiceHasher;
use App\Services\Accounting\ZatcaSubmissionDispatcher;
use App\Services\Accounting\ZatcaSubmissionService;
use App\Support\Settings;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * REM-18b-2 (مراجعة F1) — سلامة فاتورة صدرت عبر السلسلة المشتركة حين يُعدَّل `zatca_hash` وحده أو `zatca_xml` وحده.
 *
 * السياج F1 يجمّد هوية السلسلة (`zatca_icv`/`zatca_uuid`/`zatca_previous_hash`) فقط، ويترك `zatca_xml`/`zatca_hash`/`zatca_qr`/
 * `zatca_cleared_xml` قابلةً للكتابة كاليوم (مسار الإرسال يكتب الأخير، وفحوص ما قبل الإرسال تعتمد على إمكان تغيير اللقطة).
 * هذه الاختبارات توثّق **الإصدار اللاحق**: لا يتأثر PIH بعمود الهاش، ويفشل مغلقاً دون استهلاك ICV إن تغيّر XML المستند السابق دلالياً،
 * ولا يتحقق إلا من السابق مباشرةً. أما **الإرسال** فيحرسه `ZatcaIssuedDocumentIntegrity` (اختبارات `ZatcaSubmissionIntegrityTest`):
 * الثغرتان اللتان كانتا هنا (`known_gap_a` وقبول XML معدَّل لقطةً قبل تسجيل المحاولة) أُغلقتا في TAX-ZATCA Document Integrity Hardening
 * وصارت اختباراتهما هناك رفضاً. الإرسال معطَّل افتراضياً ولا اتصال حقيقياً هنا (`Http::fake`).
 */
class ZatcaChainIssuedInvoiceIntegrityTest extends TestCase
{
    use CapturesThrowable;
    use InteractsWithApi;
    use RefreshDatabase;

    private string $tenantId;

    private Partner $customer;

    protected function setUp(): void
    {
        parent::setUp();
        $auth = $this->registerTenant('zatca-issued-integrity', 'zatca-issued-integrity@example.test');
        $this->tenantId = $auth['tenant_id'];
        app(TenantContext::class)->set($this->tenantId);
        $this->customer = Partner::create(['name' => 'عميل السلامة', 'type' => 'customer']);
    }

    // ═══════════════ الحالة A — تعديل zatca_hash وحده ═══════════════

    #[Test]
    public function a_hash_only_change_is_permitted_by_the_database_and_never_reaches_the_next_pih(): void
    {
        $first = $this->issue();
        $entry = $this->entry($first);
        $identity = $first->only(['zatca_icv', 'zatca_uuid', 'zatca_previous_hash', 'zatca_xml']);
        $tampered = $this->wellFormedWrongHash($entry->hash);

        // 1) القاعدة تسمح: F1 لا يجمّد zatca_hash (قرار موثَّق)، سواء عبر النموذج أو SQL خام.
        $first->update(['zatca_hash' => $tampered]);
        $this->assertSame($tampered, DB::table('invoices')->where('id', $first->id)->value('zatca_hash'));
        DB::table('invoices')->where('id', $first->id)->update(['zatca_hash' => $tampered]);
        $stored = DB::table('invoices')->where('id', $first->id)->first();
        $this->assertSame($tampered, $stored->zatca_hash);

        // ICV وUUID والهاش السابق وXML كما هي، والمدخل الثابت لم يتغيّر.
        $this->assertSame($identity['zatca_icv'], (int) $stored->zatca_icv);
        $this->assertSame($identity['zatca_uuid'], $stored->zatca_uuid);
        $this->assertSame($identity['zatca_previous_hash'], $stored->zatca_previous_hash);
        $this->assertSame($identity['zatca_xml'], $stored->zatca_xml);
        $this->assertEquals($entry, $this->entry($first));
        $this->assertNotSame($tampered, $this->entry($first)->hash);

        // 2) الإصدار اللاحق ينجح، وPIH = هاش XML المحفوظ = هاش المدخل الثابت — لا عمود zatca_hash المعدَّل.
        $second = $this->issue();
        $secondEntry = $this->entry($second);
        $this->assertSame(2, (int) $second->zatca_icv);
        $this->assertSame($entry->hash, app(ZatcaInvoiceHasher::class)->hash((string) $stored->zatca_xml));
        $this->assertSame($entry->hash, $second->zatca_previous_hash);
        $this->assertSame($entry->hash, $secondEntry->previous_hash);
        $this->assertNotSame($tampered, $second->zatca_previous_hash);
        $this->assertStringContainsString($entry->hash, (string) $second->zatca_xml);
        $this->assertStringNotContainsString($tampered, (string) $second->zatca_xml);

        // 3) الفجوة الوحيدة: العمود صار مخالفاً لمدخل السلسلة. لا مانع ولا إنذار تلقائي، لكن الاستعلام القرائي (Q7 في تقرير النشر) يكشفه.
        $divergent = DB::table('zatca_chain_entries as e')
            ->join('invoices as i', 'i.id', '=', 'e.invoice_id')
            ->whereColumn('e.hash', '<>', 'i.zatca_hash')
            ->pluck('i.id')->all();
        $this->assertSame([$first->id], $divergent);
    }

    // ═══════════════ الحالة B — تعديل zatca_xml وحده ═══════════════

    #[Test]
    public function an_xml_only_change_stops_the_next_issuance_without_consuming_an_icv(): void
    {
        $first = $this->issue();
        $originalXml = (string) $first->zatca_xml;
        $draft = $this->draft();
        $headBefore = (array) DB::table('zatca_chains')->where('tenant_id', $this->tenantId)->first();
        $entriesBefore = DB::table('zatca_chain_entries')->get()->all();
        $journalBefore = JournalEntry::count();

        $this->tamperXml($first, $originalXml);

        $e = $this->thrown(fn () => app(InvoiceService::class)->post($draft), 'XML تغيّر دلالياً بعد الإصدار');
        $this->assertStringContainsString('لا يطابق الهاش', $e->getMessage());

        // لا ICV مستهلك، ولا رأس تقدّم، ولا مدخل جديد، ولا أثر مالي، والمسودة كما هي.
        $this->assertSame($headBefore, (array) DB::table('zatca_chains')->where('tenant_id', $this->tenantId)->first());
        $this->assertEquals($entriesBefore, DB::table('zatca_chain_entries')->get()->all());
        $this->assertSame($journalBefore, JournalEntry::count());
        $draft = $draft->fresh();
        $this->assertSame('draft', $draft->status);
        $this->assertNull($draft->zatca_icv);
        $this->assertSame(1, (int) DB::table('invoices')->where('id', $first->id)->value('zatca_icv'));

        // بعد استعادة XML الأصلي ينجح الإصدار بـICV 2 نفسه — دليل أنه لم يُستهلك.
        DB::table('invoices')->where('id', $first->id)->update(['zatca_xml' => $originalXml]);
        $second = app(InvoiceService::class)->post($draft->fresh());
        $this->assertSame(2, (int) $second->zatca_icv);
        $this->assertSame($this->entry($first)->hash, $second->zatca_previous_hash);
    }

    #[Test]
    public function an_xml_change_after_the_attempt_was_registered_fails_before_any_network_access(): void
    {
        $first = $this->issue();
        $this->configureTransport();
        Http::fake();
        $attempt = $this->requestSubmission($first);

        $this->tamperXml($first, (string) $first->zatca_xml);
        $completed = app(ZatcaSubmissionDispatcher::class)->dispatch($attempt);

        $this->assertSame('failed', $completed->status);
        $this->assertSame('submission_preflight_failed', $completed->response_code);
        Http::assertNothingSent();
    }

    #[Test]
    public function the_next_issuance_verifies_only_its_immediate_predecessor(): void
    {
        $first = $this->issue();
        $second = $this->issue();
        $this->tamperXml($first, (string) $first->zatca_xml);

        // التحقق يخصّ المستند السابق مباشرةً (الذي سيُبنى PIH منه) فقط؛ المستند الأقدم المعدَّل لا يُرسَل أبداً (ZatcaSubmissionIntegrityTest)
        // وتُفحص السلسلة كاملة قرائياً بمقارنة هاش كل XML بمدخله.
        $third = $this->issue();
        $this->assertSame(3, (int) $third->zatca_icv);
        $this->assertSame($this->entry($second)->hash, $third->zatca_previous_hash);

        $hasher = app(ZatcaInvoiceHasher::class);
        $mismatched = [];
        foreach (DB::table('zatca_chain_entries')->orderBy('icv')->get() as $entry) {
            $xml = (string) DB::table('invoices')->where('id', $entry->invoice_id)->value('zatca_xml');
            if ($hasher->hash($xml) !== $entry->hash) {
                $mismatched[] = $entry->invoice_id;
            }
        }
        $this->assertSame([$first->id], $mismatched);
    }

    // ═══════════════ ما يبقى مسموحاً عمداً ═══════════════

    #[Test]
    public function the_cleared_xml_written_by_the_dispatcher_stays_permitted_and_leaves_the_chain_untouched(): void
    {
        $first = $this->issue();
        $entry = $this->entry($first);
        $identity = $first->only(['zatca_icv', 'zatca_uuid', 'zatca_previous_hash', 'zatca_hash', 'zatca_xml']);
        $first->update(['zatca_document_type' => 'standard']);
        $this->configureTransport();
        $cleared = '<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"><ID>cleared</ID></Invoice>';
        Http::fake(['https://gw-fatoora.zatca.gov.sa/*' => Http::response([
            'clearanceStatus' => 'CLEARED',
            'clearedInvoice' => base64_encode($cleared),
        ], 200)]);

        $completed = app(ZatcaSubmissionDispatcher::class)->dispatch($this->requestSubmission($first));

        $this->assertSame('accepted', $completed->status);
        $fresh = $first->fresh();
        $this->assertSame($cleared, $fresh->zatca_cleared_xml);
        $this->assertSame($identity, $fresh->only(array_keys($identity)));
        $this->assertEquals($entry, $this->entry($first));
    }

    // ───────────────────────── مساعدات ─────────────────────────

    private function draft(): Invoice
    {
        return app(InvoiceService::class)->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'credit'],
            [['description' => 'خدمة', 'quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
        );
    }

    private function issue(): Invoice
    {
        return app(InvoiceService::class)->post($this->draft());
    }

    private function entry(Invoice $invoice): object
    {
        return DB::table('zatca_chain_entries')->where('invoice_id', $invoice->id)->firstOrFail();
    }

    /** بصمة صحيحة الشكل (Base64 لـ32 بايت) تخالف الهاش الحقيقي. */
    private function wellFormedWrongHash(string $real): string
    {
        $wrong = base64_encode(hash('sha256', 'tampered-'.$real, true));
        $this->assertNotSame($real, $wrong);

        return $wrong;
    }

    /** تغيير دلالي (لا مسافات: تلك لا تغيّر الشكل المعياري ولا الهاش). يعيد XML الجديد. */
    private function tamperXml(Invoice $invoice, string $xml): string
    {
        $changed = str_replace(
            '<cbc:ProfileID>reporting:1.0</cbc:ProfileID>',
            '<cbc:ProfileID>reporting:1.1</cbc:ProfileID>',
            $xml,
        );
        $this->assertNotSame($xml, $changed, 'الاستبدال لم يغيّر XML');
        $this->assertNotSame(
            app(ZatcaInvoiceHasher::class)->hash($xml),
            app(ZatcaInvoiceHasher::class)->hash($changed),
            'التغيير يجب أن يغيّر الهاش المعياري',
        );
        DB::table('invoices')->where('id', $invoice->id)->update(['zatca_xml' => $changed]);

        return $changed;
    }

    /** اعتماد النقل يُنشأ بعد الإصدار عمداً: وجوده يجعل الإصدار التالي موقَّعاً ويحتاج سياسة توقيع. */
    private function configureTransport(): void
    {
        Settings::put('zatca', ['active_environment' => 'simulation']);
        ZatcaCredential::create([
            'environment' => 'simulation',
            'stage' => 'production',
            'status' => 'configured',
            'credentials' => ['binary_security_token' => 'csid', 'secret' => 'secret'],
            'certificate_fingerprint' => str_repeat('a', 64),
            'configured_at' => now(),
            'expires_at' => now()->addDay(),
        ]);
    }

    private function requestSubmission(Invoice $invoice)
    {
        return app(ZatcaSubmissionService::class)->requestManual($invoice->fresh(), 'integrity-'.bin2hex(random_bytes(4)), null)['attempt'];
    }
}
