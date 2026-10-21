<?php

namespace Tests\Feature;

use App\Jobs\Accounting\SendZatcaSubmission;
use App\Models\Invoice;
use App\Models\Partner;
use App\Models\ZatcaCredential;
use App\Models\ZatcaSubmissionAttempt;
use App\Services\Accounting\InvoiceService;
use App\Services\Accounting\ZatcaInvoiceHasher;
use App\Services\Accounting\ZatcaIssuedDocumentIntegrity;
use App\Services\Accounting\ZatcaSubmissionDispatcher;
use App\Services\Accounting\ZatcaSubmissionQueue;
use App\Services\Accounting\ZatcaSubmissionService;
use App\Support\Settings;
use App\Support\ZatcaIntegrityException;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * سلامة المستند الصادر قبل أي إرسال إلى ZATCA (`ZatcaIssuedDocumentIntegrity`) — SQLite وPostgreSQL.
 *
 * لفاتورة لها مدخل في السلسلة المشتركة يجب أن يتطابق هاش XML المحفوظ (بالتحويل الرسمي) مع `zatca_hash` ومع المدخل الثابت،
 * وتتطابق الهوية (المستأجر/الفاتورة/ICV/UUID/PIH)، في ثلاث نقاط: قبل تسجيل المحاولة، وقبل صفّها، وقبل النقل في المُرسِل.
 * كل رفض هنا قبل أي طلب شبكي (`Http::preventStrayRequests` + `assertNothingSent`). فواتير ما قبل السلسلة تبقى على فحوصها القديمة.
 * الإرسال معطَّل افتراضياً ولا اتصال حقيقي هنا.
 */
class ZatcaSubmissionIntegrityTest extends TestCase
{
    use CapturesThrowable;
    use InteractsWithApi;
    use RefreshDatabase;

    private array $auth;

    private Partner $customer;

    protected function setUp(): void
    {
        parent::setUp();
        $this->auth = $this->registerTenant('zatca-submission-integrity', 'zatca-submission-integrity@example.test');
        app(TenantContext::class)->set($this->auth['tenant_id']);
        $this->customer = Partner::create(['name' => 'عميل الإرسال', 'type' => 'customer']);
        Http::preventStrayRequests();
    }

    // ═══════════════ 1–2: قبل تسجيل المحاولة ═══════════════

    #[Test]
    public function a_hash_only_change_is_rejected_before_the_attempt_is_created(): void
    {
        $invoice = $this->issue();
        $this->configureTransport();
        $this->tamperHash($invoice);

        $e = $this->thrown(fn () => $this->requestSubmission($invoice), 'zatca_hash معدَّل', ZatcaIntegrityException::class);

        $this->assertSame('hash_column_mismatch', $e->reason);
        $this->assertSame(0, ZatcaSubmissionAttempt::count());
    }

    #[Test]
    public function an_xml_only_change_is_rejected_before_the_attempt_is_created_so_it_can_never_become_the_snapshot(): void
    {
        $invoice = $this->issue();
        $this->configureTransport();
        $this->tamperXml($invoice);

        $e = $this->thrown(fn () => $this->requestSubmission($invoice), 'zatca_xml معدَّل', ZatcaIntegrityException::class);

        $this->assertSame('xml_hash_mismatch', $e->reason);
        $this->assertSame(0, ZatcaSubmissionAttempt::count());
    }

    #[Test]
    public function the_api_answers_422_without_creating_an_attempt_or_queueing(): void
    {
        $invoice = $this->issue();
        $this->configureTransport();
        $this->enableDispatch();
        $this->tamperXml($invoice);

        $this->withToken($this->auth['token'])
            ->withHeader('Idempotency-Key', 'tampered-api-1')
            ->postJson("/api/invoices/{$invoice->id}/zatca/submissions")
            ->assertStatus(422);

        $this->assertSame(0, ZatcaSubmissionAttempt::count());
        Queue::assertNothingPushed();
        Http::assertNothingSent();
    }

    // ═══════════════ 3: بعد تسجيل المحاولة وقبل الإرسال ═══════════════

    #[Test]
    public function a_hash_change_after_the_attempt_was_created_fails_before_any_network_access(): void
    {
        $invoice = $this->issue();
        $this->configureTransport();
        Http::fake(); // يسجّل أي طلب خارج؛ بدونه يرفض preventStrayRequests الطلب فيُخفي غياب الحارس
        $attempt = $this->requestSubmission($invoice);
        $this->tamperHash($invoice);

        $completed = app(ZatcaSubmissionDispatcher::class)->dispatch($attempt);

        $this->assertPreflightFailure($completed);
        Http::assertNothingSent();
    }

    #[Test]
    public function an_xml_change_after_the_attempt_was_created_fails_before_any_network_access(): void
    {
        $invoice = $this->issue();
        $this->configureTransport();
        Http::fake();
        $attempt = $this->requestSubmission($invoice);
        $this->tamperXml($invoice);

        $completed = app(ZatcaSubmissionDispatcher::class)->dispatch($attempt);

        $this->assertPreflightFailure($completed);
        Http::assertNothingSent();
    }

    #[Test]
    public function the_dispatcher_rejects_a_consistent_but_wrong_snapshot_the_request_hash_alone_would_accept(): void
    {
        $invoice = $this->issue();
        $this->configureTransport();
        Http::fake();
        $attempt = $this->requestSubmission($invoice);
        // تغيير يطال العمود فقط: request_hash (من XML) ما زال مطابقاً، لكن البصمة المرسلة لم تعد بصمة ما صدر.
        $this->tamperHash($invoice);
        $this->assertSame($attempt->request_hash, hash('sha256', (string) Invoice::find($invoice->id)->zatca_xml));

        $log = $this->captureFailureLog(fn () => app(ZatcaSubmissionDispatcher::class)->dispatch($attempt));

        $this->assertSame(ZatcaIntegrityException::class, $log['exception_class']);
        $this->assertSame('snapshot_mismatch', $log['cause_code']);
        Http::assertNothingSent();
    }

    #[Test]
    public function an_attempt_is_not_queued_when_the_invoice_no_longer_matches_its_issue_record(): void
    {
        $invoice = $this->issue();
        $this->configureTransport();
        $this->enableDispatch();
        $attempt = $this->requestSubmission($invoice);
        $this->tamperHash($invoice);

        $e = $this->thrown(fn () => app(ZatcaSubmissionQueue::class)->enqueue($attempt), 'صفّ مستند معدَّل', ZatcaIntegrityException::class);

        $this->assertSame('hash_column_mismatch', $e->reason);
        $this->assertSame(0, (int) $attempt->fresh()->queue_count);
        Queue::assertNothingPushed();

        $this->withToken($this->auth['token'])
            ->postJson("/api/invoices/{$invoice->id}/zatca/submissions/{$attempt->id}/dispatch")
            ->assertStatus(422);
        Queue::assertNothingPushed();
    }

    // ═══════════════ 4: إعادة المحاولة ═══════════════

    #[Test]
    public function a_retry_with_a_modified_invoice_is_rejected_and_no_new_attempt_is_created(): void
    {
        $invoice = $this->issue();
        $this->configureTransport();
        Http::fake(['https://gw-fatoora.zatca.gov.sa/*' => Http::response(['message' => 'unavailable'], 503)]);
        $first = app(ZatcaSubmissionDispatcher::class)->dispatch($this->requestSubmission($invoice, 'retry-1'));
        $this->assertSame('failed', $first->status);
        Http::assertSentCount(1);

        $this->tamperHash($invoice);
        $this->thrown(fn () => $this->requestSubmission($invoice, 'retry-2'), 'إعادة محاولة لمستند معدَّل', ZatcaIntegrityException::class);

        $this->assertSame(1, ZatcaSubmissionAttempt::count());
        Http::assertSentCount(1); // لا طلب ثانٍ
    }

    // ═══════════════ 5: مستند سليم ═══════════════

    #[Test]
    public function an_unchanged_issued_invoice_passes_every_check_and_is_sent_with_the_chain_hash(): void
    {
        $invoice = $this->issue();
        $entry = DB::table('zatca_chain_entries')->where('invoice_id', $invoice->id)->first();
        $this->configureTransport();
        Http::fake(['https://gw-fatoora.zatca.gov.sa/*' => Http::response(['reportingStatus' => 'REPORTED'], 200)]);

        $this->assertSame(ZatcaIssuedDocumentIntegrity::CHAIN, app(ZatcaIssuedDocumentIntegrity::class)->assertIntact($invoice->fresh()));
        $completed = app(ZatcaSubmissionDispatcher::class)->dispatch($this->requestSubmission($invoice));

        $this->assertSame('accepted', $completed->status);
        Http::assertSent(fn (Request $request) => $request['invoiceHash'] === $entry->hash
            && base64_decode($request['invoice'], true) === $invoice->fresh()->zatca_xml);
    }

    // ═══════════════ 6: ما قبل السلسلة ═══════════════

    #[Test]
    public function a_legacy_invoice_without_a_chain_entry_keeps_working_and_its_raw_hash_is_not_reinterpreted(): void
    {
        $realXml = (string) $this->issue()->zatca_xml; // XML حقيقي من مستأجر السلسلة، يُستعمل مادةً لصف قديم
        $this->useFreshTenant('zatca-integrity-legacy-only');
        $legacy = $this->legacyInvoice($realXml, 1);
        $this->assertNotSame(app(ZatcaInvoiceHasher::class)->hash($realXml), $legacy->zatca_hash, 'هاش خام يخالف الرسمي');
        $this->assertSame(0, DB::table('zatca_chains')->where('tenant_id', $legacy->tenant_id)->count());
        $this->configureTransport();
        Http::fake(['https://gw-fatoora.zatca.gov.sa/*' => Http::response(['reportingStatus' => 'REPORTED'], 200)]);

        $this->assertSame(ZatcaIssuedDocumentIntegrity::LEGACY, app(ZatcaIssuedDocumentIntegrity::class)->assertIntact($legacy));
        $completed = app(ZatcaSubmissionDispatcher::class)->dispatch($this->requestSubmission($legacy));

        $this->assertSame('accepted', $completed->status);
        Http::assertSent(fn (Request $request) => $request['invoiceHash'] === $legacy->zatca_hash);
    }

    #[Test]
    public function the_transport_format_check_still_rejects_a_malformed_hash_on_a_legacy_invoice(): void
    {
        $realXml = (string) $this->issue()->zatca_xml;
        $this->useFreshTenant('zatca-integrity-legacy-format');
        $legacy = $this->legacyInvoice($realXml, 1);
        $this->configureTransport();
        Http::fake();
        $attempt = $this->requestSubmission($legacy);
        DB::table('invoices')->where('id', $legacy->id)->update(['zatca_hash' => 'not-a-sha256-base64']);

        $log = $this->captureFailureLog(fn () => app(ZatcaSubmissionDispatcher::class)->dispatch($attempt));

        // الحارس لا يصل إلى فاتورة قديمة؛ يبقى رفض النقل نفسه (دفاع ثانٍ قائم) ولا طلب شبكي.
        $this->assertSame('transport_error', $log['cause_code']);
        $this->assertSame(\RuntimeException::class, $log['exception_class']);
        Http::assertNothingSent();
    }

    #[Test]
    public function a_legacy_invoice_stays_legacy_after_its_tenant_opens_a_chain_while_the_new_invoice_is_checked_strictly(): void
    {
        $realXml = (string) $this->issue()->zatca_xml;
        $this->useFreshTenant('zatca-integrity-legacy-mixed');
        $legacy = $this->legacyInvoice($realXml, 1);
        $chained = $this->issue(); // يفتح الرأس بذرة 1، ICV 2
        $this->assertSame(1, (int) DB::table('zatca_chains')->where('tenant_id', $legacy->tenant_id)->value('seed_icv'));
        $this->assertSame(2, (int) $chained->zatca_icv);

        $guard = app(ZatcaIssuedDocumentIntegrity::class);
        $this->assertSame(ZatcaIssuedDocumentIntegrity::LEGACY, $guard->assertIntact($legacy->fresh()));
        $this->assertSame(ZatcaIssuedDocumentIntegrity::CHAIN, $guard->assertIntact($chained->fresh()));

        // السلوك القديم المحفوظ والمخاطرة الموثَّقة: لا فحص لهاش/XML فاتورة ما قبل السلسلة (لا مرجع ثابت لها).
        $this->tamperXml($legacy);
        DB::table('invoices')->where('id', $legacy->id)->update(['zatca_hash' => $this->wrongHash()]);
        $this->assertSame(ZatcaIssuedDocumentIntegrity::LEGACY, $guard->assertIntact($legacy->fresh()));
        $this->tamperHash($chained);
        $this->thrown(fn () => $guard->assertIntact($chained->fresh()), 'الفاتورة الجديدة صارمة', ZatcaIntegrityException::class);
    }

    // ═══════════════ 7–8: هوية المستند ═══════════════

    #[Test]
    public function an_entry_that_is_invisible_or_belongs_to_another_document_fails_closed(): void
    {
        $guard = app(ZatcaIssuedDocumentIntegrity::class);
        $a1 = $this->issue();
        $a2 = $this->issue();

        // مستند بهوية فاتورة أخرى: المدخل الموجود لمستند آخر ⇒ ICV لا يطابق.
        $forged = $a2->fresh()->replicate();
        $forged->id = $a1->id;
        $forged->tenant_id = $a1->tenant_id;
        $e = $this->thrown(fn () => $guard->assertIntact($forged), 'مدخل مستند آخر', ZatcaIntegrityException::class);
        $this->assertSame('icv_mismatch', $e->reason);

        // سياق مستأجر آخر: فشل مغلق بدل اعتبار المستند قديماً.
        $a1Model = $a1->fresh();
        $other = $this->useFreshTenant('zatca-integrity-other-tenant');
        $e = $this->thrown(fn () => $guard->assertIntact($a1Model), 'سياق مستأجر مختلف', ZatcaIntegrityException::class);
        $this->assertSame('tenant_context', $e->reason);

        // فاتورة المستأجر الآخر بمعرّف لا يملك مستأجرها مدخلاً له: المدخل غير مرئي، وICV فوق البذرة ⇒ لا تُعامَل قديمة.
        $bOwn = $this->issue();
        $ghost = $bOwn->fresh()->replicate();
        $ghost->id = (string) \Illuminate\Support\Str::uuid();
        $ghost->tenant_id = $other;
        $e = $this->thrown(fn () => $guard->assertIntact($ghost), 'مدخل غائب', ZatcaIntegrityException::class);
        $this->assertSame('entry_missing', $e->reason);
    }

    #[Test]
    public function an_icv_uuid_or_pih_that_differs_from_the_issue_record_fails_closed(): void
    {
        $invoice = $this->issue();
        $guard = app(ZatcaIssuedDocumentIntegrity::class);
        $this->assertSame(ZatcaIssuedDocumentIntegrity::CHAIN, $guard->assertIntact($invoice->fresh()));

        // السياج F1 يمنع هذه الحالات في القاعدة؛ هنا نثبت أن الحارس يرفضها ولو وصلته (دفاع بالعمق) — تعديل في الذاكرة لا يُحفظ.
        foreach ([
            'zatca_icv' => [99, 'icv_mismatch'],
            'zatca_uuid' => [(string) \Illuminate\Support\Str::uuid(), 'uuid_mismatch'],
            'zatca_previous_hash' => [$this->wrongHash(), 'pih_mismatch'],
            'zatca_hash' => [$this->wrongHash(), 'hash_column_mismatch'],
        ] as $attribute => [$value, $reason]) {
            $changed = $invoice->fresh();
            $changed->setAttribute($attribute, $value);
            $e = $this->thrown(fn () => $guard->assertIntact($changed), "{$attribute} يخالف المدخل", ZatcaIntegrityException::class);
            $this->assertSame($reason, $e->reason, $attribute);
        }

        $noXml = $invoice->fresh();
        $noXml->setAttribute('zatca_xml', '  ');
        $this->assertSame('xml_missing', $this->thrown(fn () => $guard->assertIntact($noXml), 'XML فارغ', ZatcaIntegrityException::class)->reason);
        $broken = $invoice->fresh();
        $broken->setAttribute('zatca_xml', '<Invoice');
        $this->assertSame('xml_unreadable', $this->thrown(fn () => $guard->assertIntact($broken), 'XML تالف', ZatcaIntegrityException::class)->reason);
    }

    // ═══════════════ 10: zatca_cleared_xml ═══════════════

    #[Test]
    public function writing_the_cleared_xml_stays_valid_and_does_not_disturb_the_integrity_check(): void
    {
        $invoice = $this->issue();
        $invoice->update(['zatca_document_type' => 'standard']);
        $this->configureTransport();
        $cleared = '<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"><ID>cleared</ID></Invoice>';
        Http::fake(['https://gw-fatoora.zatca.gov.sa/*' => Http::response([
            'clearanceStatus' => 'CLEARED',
            'clearedInvoice' => base64_encode($cleared),
        ], 200)]);

        $completed = app(ZatcaSubmissionDispatcher::class)->dispatch($this->requestSubmission($invoice));

        $this->assertSame('accepted', $completed->status);
        $fresh = $invoice->fresh();
        $this->assertSame($cleared, $fresh->zatca_cleared_xml);
        $this->assertSame(ZatcaIssuedDocumentIntegrity::CHAIN, app(ZatcaIssuedDocumentIntegrity::class)->assertIntact($fresh));
        DB::table('invoices')->where('id', $invoice->id)->update(['zatca_cleared_xml' => $cleared.'<!-- r -->']);
        $this->assertSame(ZatcaIssuedDocumentIntegrity::CHAIN, app(ZatcaIssuedDocumentIntegrity::class)->assertIntact($invoice->fresh()));
    }

    // ═══════════════ ج: مستند أقدم ═══════════════

    #[Test]
    public function an_older_invoice_whose_xml_was_changed_can_never_be_transmitted_even_though_the_next_issuance_does_not_notice(): void
    {
        $older = $this->issue();
        $this->issue();
        $this->tamperXml($older);
        $third = $this->issue(); // السلسلة تتحقق من السابق مباشرةً فقط (REM-18b-2) — ما زال ينجح
        $this->assertSame(3, (int) $third->zatca_icv);
        $this->configureTransport();

        $e = $this->thrown(fn () => $this->requestSubmission($older), 'مستند أقدم معدَّل', ZatcaIntegrityException::class);

        $this->assertSame('xml_hash_mismatch', $e->reason);
        $this->assertSame(0, ZatcaSubmissionAttempt::count());
        Http::assertNothingSent();
    }

    // ───────────────────────── مساعدات ─────────────────────────

    private function issue(): Invoice
    {
        $draft = app(InvoiceService::class)->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'credit'],
            [['description' => 'خدمة', 'quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
        );

        return app(InvoiceService::class)->post($draft);
    }

    /** مستأجر جديد يصير هو السياق الحالي (للاختبارات متعددة المستأجرين). يعيد معرّفه. */
    private function useFreshTenant(string $slug): string
    {
        $auth = $this->registerTenant($slug, $slug.'@example.test');
        app(TenantContext::class)->set($auth['tenant_id']);
        $this->auth = $auth;
        $this->customer = Partner::create(['name' => 'عميل '.$slug, 'type' => 'customer']);

        return $auth['tenant_id'];
    }

    /**
     * صفّ «صدر قبل السلسلة»: مسودة تُرحَّل بكتابة خام (كما كان الإصدار القديم يترك الصف) بهاش خام مختلف عن الرسمي ولا مدخل لها.
     * يُنشأ في مستأجر بلا رأس سلسلة ⇒ السياج F1 لا يمنعه.
     */
    private function legacyInvoice(string $xml, int $icv): Invoice
    {
        $draft = app(InvoiceService::class)->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'credit'],
            [['description' => 'خدمة قديمة', 'quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
        );
        DB::table('invoices')->where('id', $draft->id)->update([
            'status' => 'posted',
            'zatca_document_type' => 'simplified',
            'zatca_xml' => $xml,
            'zatca_hash' => base64_encode(hash('sha256', $xml, true)),
            'zatca_uuid' => (string) \Illuminate\Support\Str::uuid(),
            'zatca_icv' => $icv,
            'zatca_previous_hash' => 'NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==',
        ]);

        return Invoice::findOrFail($draft->id);
    }

    private function wrongHash(): string
    {
        return base64_encode(hash('sha256', 'not-the-issued-document-'.random_int(1, PHP_INT_MAX), true));
    }

    private function tamperHash(Invoice $invoice): void
    {
        DB::table('invoices')->where('id', $invoice->id)->update(['zatca_hash' => $this->wrongHash()]);
    }

    /** تغيير دلالي في XML (لا مسافات: تلك لا تغيّر الشكل المعياري ولا الهاش). */
    private function tamperXml(Invoice $invoice): void
    {
        $xml = (string) DB::table('invoices')->where('id', $invoice->id)->value('zatca_xml');
        $changed = str_replace('<cbc:ProfileID>reporting:1.0</cbc:ProfileID>', '<cbc:ProfileID>reporting:1.1</cbc:ProfileID>', $xml);
        $this->assertNotSame($xml, $changed);
        DB::table('invoices')->where('id', $invoice->id)->update(['zatca_xml' => $changed]);
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

    private function enableDispatch(): void
    {
        Queue::fake();
        config([
            'zatca.transport.dispatch_enabled' => true,
            'zatca.transport.queue_connection' => 'database',
            'zatca.transport.queue' => 'zatca',
        ]);
    }

    private function requestSubmission(Invoice $invoice, string $key = 'integrity-1'): ZatcaSubmissionAttempt
    {
        return app(ZatcaSubmissionService::class)->requestManual($invoice->fresh(), $key, null)['attempt'];
    }

    private function assertPreflightFailure(ZatcaSubmissionAttempt $completed): void
    {
        $this->assertSame('failed', $completed->status);
        $this->assertSame('submission_preflight_failed', $completed->response_code);
        $this->assertFalse($completed->response_payload['retryable']);
    }

    /** @return array<string, mixed> سياق سطر الفشل التشخيصي الوحيد الذي يسجّله المُرسِل. */
    private function captureFailureLog(callable $operation): array
    {
        $logs = [];
        \Illuminate\Support\Facades\Log::listen(function (\Illuminate\Log\Events\MessageLogged $event) use (&$logs): void {
            if ($event->message === 'zatca_submission_dispatch_failed') {
                $logs[] = $event->context;
            }
        });
        $operation();
        $this->assertCount(1, $logs);

        return $logs[0];
    }
}
