<?php

namespace Tests\Feature;

use App\Models\Invoice;
use App\Models\Partner;
use App\Models\ZatcaCredential;
use App\Models\ZatcaSubmissionAttempt;
use App\Services\Accounting\InvoiceService;
use App\Services\Accounting\ZatcaSubmissionDispatcher;
use App\Services\Accounting\ZatcaSubmissionService;
use App\Support\Settings;
use App\Support\ZatcaIntegrityException;
use App\Tenancy\TenantContext;
use Illuminate\Contracts\Encryption\DecryptException;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Log\Events\MessageLogged;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Schema;
use Mockery;
use PDOException;
use RuntimeException;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  TAX-N01 — المُرسِل لا يبتلع الأسباب (تشخيص فقط، بلا تغيير آلة الحالة)
 * ═══════════════════════════════════════════════════════════════
 *  كان `catch (Throwable)` في `ZatcaSubmissionDispatcher` يحوّل كل شيء إلى
 *  `failed / submission_preflight_failed / retryable=false` بلا أي سجل. الآن يُسجَّل سطر
 *  مهيكل واحد (`zatca_submission_dispatch_failed`) بالحقول الأربعة المسموحة فقط، **قبل**
 *  تثبيت الفشل. ما يُحفَظ في الصف يبقى كما كان حرفياً — وتتحقق الاختبارات من ذلك لكل سبب.
 *
 *  الحقول المسموحة: attempt_id · tenant_id · exception_class · cause_code. لا رسالة
 *  استثناء ولا تتبّع مكدّس ولا XML ولا اعتماد ولا ردّ.
 *
 *  تشغيل: php artisan test --filter=TaxN01ZatcaDispatcherDiagnosticsTest
 */
class TaxN01ZatcaDispatcherDiagnosticsTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private const EVENT = 'zatca_submission_dispatch_failed';

    private const MARKERS = ['SECRET_XML_MARKER', 'PRIVATE_KEY_MARKER', 'TOKEN_MARKER', 'CREDENTIAL_MARKER'];

    private array $auth;

    private Invoice $invoice;

    /** @var array<int, MessageLogged> */
    private array $logged = [];

    protected function setUp(): void
    {
        parent::setUp();
        $this->auth = $this->registerTenant('taxn01', 'taxn01@example.test');
        app(TenantContext::class)->set($this->auth['tenant_id']);
        $customer = Partner::create(['name' => 'عميل التشخيص', 'type' => 'customer']);
        $draft = app(InvoiceService::class)->create(
            ['partner_id' => $customer->id, 'payment_type' => 'credit'],
            [['description' => 'خدمة', 'quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
        );
        $this->invoice = app(InvoiceService::class)->post($draft);
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

        Queue::fake();
        Http::preventStrayRequests();
        Log::listen(function (MessageLogged $event): void {
            $this->logged[] = $event;
        });
    }

    // ───────────────────────── مساعدات ─────────────────────────

    private function attempt(string $key = 'taxn01-1'): ZatcaSubmissionAttempt
    {
        return app(ZatcaSubmissionService::class)->requestManual($this->invoice->fresh(), $key, null)['attempt'];
    }

    /** @return array<int, MessageLogged> أسطر الفشل التشخيصية فقط. */
    private function failureLogs(): array
    {
        return array_values(array_filter($this->logged, fn (MessageLogged $e) => $e->message === self::EVENT));
    }

    private function onlyFailureLog(): MessageLogged
    {
        $logs = $this->failureLogs();
        $this->assertCount(1, $logs, 'سطر مهيكل واحد بالضبط لكل فشل');

        return $logs[0];
    }

    private function assertSafeContext(MessageLogged $log, ZatcaSubmissionAttempt $attempt, string $cause, string $exceptionClass): void
    {
        $this->assertSame('error', $log->level);
        $this->assertSame(
            ['attempt_id', 'cause_code', 'exception_class', 'tenant_id'],
            collect(array_keys($log->context))->sort()->values()->all(),
            'الحقول المسموحة فقط',
        );
        $this->assertSame($attempt->id, $log->context['attempt_id']);
        $this->assertSame($this->auth['tenant_id'], $log->context['tenant_id']);
        $this->assertSame($cause, $log->context['cause_code']);
        $this->assertSame($exceptionClass, $log->context['exception_class']);
    }

    /** لا علامات سرية ولا وسوم XML ولا ترويسة مفتاح ولا Authorization في أي سطر سُجِّل. */
    private function assertNothingSensitiveLogged(): void
    {
        $blob = json_encode(array_map(fn (MessageLogged $e) => [$e->level, $e->message, $e->context], $this->logged), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        foreach (self::MARKERS as $marker) {
            $this->assertStringNotContainsString($marker, $blob, "{$marker} تسرّب إلى السجل");
        }
        foreach (['<Invoice', '<?xml', 'BEGIN PRIVATE KEY', 'BEGIN CERTIFICATE', 'Authorization', 'Basic ', 'csid', 'secret'] as $needle) {
            $this->assertStringNotContainsString($needle, $blob, "«{$needle}» تسرّب إلى السجل");
        }
    }

    /** الحالة المحفوظة كما كانت قبل TAX-N01: failed / submission_preflight_failed / retryable=false. */
    private function assertPersistedPreflightFailure(ZatcaSubmissionAttempt $completed): void
    {
        $this->assertSame('failed', $completed->status);
        $this->assertSame('submission_preflight_failed', $completed->response_code);
        $this->assertNull($completed->response_http_status);
        $this->assertFalse($completed->response_payload['retryable']);
    }

    /** @return array<string, mixed> */
    private function snapshotWorld(): array
    {
        return [
            'attempts' => DB::table('zatca_submission_attempts')->count(),
            'invoice' => (array) DB::table('invoices')->where('id', $this->invoice->id)->first(),
            'credential' => (array) DB::table('zatca_credentials')->first(),
            'journal_entries' => DB::table('journal_entries')->count(),
            'journal_lines' => DB::table('journal_lines')->count(),
            'stock_movements' => DB::table('stock_movements')->count(),
            'payments' => DB::table('payments')->count(),
            'max_icv' => DB::table('invoices')->max('zatca_icv'),
        ];
    }

    private function clearanceFake(): void
    {
        $this->invoice->update(['zatca_document_type' => 'standard']);
        $xml = '<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"><ID>cleared</ID></Invoice>';
        Http::fake(['*' => Http::response(['clearanceStatus' => 'CLEARED', 'clearedInvoice' => base64_encode($xml)], 200)]);
    }

    // ═══════════════ A — خطأ قاعدة البيانات ═══════════════

    /** @test */
    public function a_database_error_in_the_dispatcher_is_logged_and_persists_the_same_failed_state_on_sqlite(): void
    {
        if (DB::connection()->getDriverName() !== 'sqlite') {
            $this->markTestSkipped('على PostgreSQL تُجهَض المعاملة؛ يغطيها الاختبار التالي.');
        }

        $this->clearanceFake();
        $attempt = $this->attempt();
        $before = $this->snapshotWorld();
        // `UPDATE invoices SET zatca_cleared_xml` يفشل فعلاً (عمود غير موجود) داخل معاملة المُرسِل نفسها.
        Schema::table('invoices', fn ($t) => $t->renameColumn('zatca_cleared_xml', 'zatca_cleared_xml_x'));

        $completed = app(ZatcaSubmissionDispatcher::class)->dispatch($attempt);

        $this->assertPersistedPreflightFailure($completed);
        $this->assertSafeContext($this->onlyFailureLog(), $attempt, 'database_error', QueryException::class);
        $this->assertSame($before['attempts'], DB::table('zatca_submission_attempts')->count());
        $this->assertSame($before['credential'], (array) DB::table('zatca_credentials')->first());
        $this->assertSame($before['journal_entries'], DB::table('journal_entries')->count());
        $this->assertSame($before['max_icv'], DB::table('invoices')->max('zatca_icv'));
        Queue::assertNothingPushed();
        $this->assertNothingSensitiveLogged();
    }

    /**
     * فرضية إجهاض المعاملة (PostgreSQL): خطأ SQL داخل معاملة المُرسِل يُجهضها، فيفشل `complete()`
     * في معالج الفشل نفسه بـ`25P02` وتتراجع المعاملة كلها: تبقى المحاولة `pending` ويصعد الاستثناء.
     * هذا السلوك **قائم قبل TAX-N01 ولم يتغيّر** (معالجته بنيوياً تخص REM-22)؛ الجديد أن السبب
     * الأصلي صار مسجَّلاً قبل أن يضيع خلف 25P02.
     *
     * @test
     */
    public function on_postgresql_a_database_error_aborts_the_transaction_and_the_root_cause_is_still_logged(): void
    {
        if (DB::connection()->getDriverName() !== 'pgsql') {
            $this->markTestSkipped('خاص بـPostgreSQL.');
        }

        $this->clearanceFake();
        $attempt = $this->attempt();
        Schema::table('invoices', fn ($t) => $t->renameColumn('zatca_cleared_xml', 'zatca_cleared_xml_x'));

        try {
            app(ZatcaSubmissionDispatcher::class)->dispatch($attempt);
            $this->fail('كان يجب أن يصعد الاستثناء الثانوي.');
        } catch (PDOException $e) {
            $this->assertSame('25P02', (string) $e->getCode(), 'الخطأ الظاهر ثانوي: المعاملة مجهَضة');
            $this->assertNotInstanceOf(QueryException::class, $e);
        }

        // السبب الأصلي (QueryException) سُجِّل قبل التثبيت الفاشل؛ وحالة المحاولة لم تتغيّر.
        $this->assertSafeContext($this->onlyFailureLog(), $attempt, 'database_error', QueryException::class);
        $this->assertSame('pending', DB::table('zatca_submission_attempts')->where('id', $attempt->id)->value('status'));
        Queue::assertNothingPushed();
        $this->assertNothingSensitiveLogged();
    }

    /** @test */
    public function a_database_error_inside_complete_is_logged_once_and_still_propagates_with_the_attempt_pending(): void
    {
        Http::fake(['*' => Http::response(['reportingStatus' => 'REPORTED'], 200)]);
        $attempt = $this->attempt();
        Schema::table('zatca_submission_attempts', fn ($t) => $t->renameColumn('response_payload', 'response_payload_x'));

        try {
            app(ZatcaSubmissionDispatcher::class)->dispatch($attempt);
            $this->fail('كان يجب أن يصعد الاستثناء (لا يمكن تثبيت أي نتيجة).');
        } catch (QueryException $e) {
            $this->assertInstanceOf(PDOException::class, $e);
        }

        $this->assertSafeContext($this->onlyFailureLog(), $attempt, 'database_error', QueryException::class);
        $this->assertSame('pending', DB::table('zatca_submission_attempts')->where('id', $attempt->id)->value('status'));
        $this->assertNothingSensitiveLogged();
    }

    // ═══════════════ B — عدم تطابق اللقطة ═══════════════

    /** @test */
    public function a_changed_xml_snapshot_is_classified_without_logging_any_xml(): void
    {
        Http::fake();
        $attempt = $this->attempt();
        $this->invoice->update(['zatca_xml' => $this->invoice->zatca_xml.' SECRET_XML_MARKER']);
        $before = $this->snapshotWorld();

        $completed = app(ZatcaSubmissionDispatcher::class)->dispatch($attempt);

        $this->assertPersistedPreflightFailure($completed);
        $this->assertSafeContext($this->onlyFailureLog(), $attempt, 'snapshot_mismatch', RuntimeException::class);
        Http::assertNothingSent();
        Queue::assertNothingPushed();
        $this->assertSame($before, $this->snapshotWorld());
        $this->assertNothingSensitiveLogged();
    }

    /** @test */
    public function a_document_type_that_no_longer_matches_the_attempt_is_a_snapshot_mismatch(): void
    {
        Http::fake();
        $attempt = $this->attempt(); // reporting (فاتورة مبسّطة)
        $this->invoice->update(['zatca_document_type' => 'standard']);

        $completed = app(ZatcaSubmissionDispatcher::class)->dispatch($attempt);

        $this->assertPersistedPreflightFailure($completed);
        $this->assertSafeContext($this->onlyFailureLog(), $attempt, 'snapshot_mismatch', RuntimeException::class);
        Http::assertNothingSent();
    }

    // ═══════════════ C — الاعتماد ═══════════════

    /** @test */
    public function an_unreadable_encrypted_credential_is_classified_without_logging_credential_material(): void
    {
        Http::fake();
        $attempt = $this->attempt();
        DB::table('zatca_credentials')->update(['credentials' => 'not-a-valid-payload CREDENTIAL_MARKER PRIVATE_KEY_MARKER']);
        $before = $this->snapshotWorld();

        $completed = app(ZatcaSubmissionDispatcher::class)->dispatch($attempt);

        $this->assertPersistedPreflightFailure($completed);
        $this->assertSafeContext($this->onlyFailureLog(), $attempt, 'credential_unreadable', DecryptException::class);
        Http::assertNothingSent();
        $this->assertSame($before, $this->snapshotWorld(), 'الاعتماد لم يُمسّ');
        $this->assertNothingSensitiveLogged();
    }

    /** @test */
    public function an_expired_credential_is_a_distinct_unusable_cause(): void
    {
        Http::fake();
        $attempt = $this->attempt();
        DB::table('zatca_credentials')->update(['expires_at' => now()->subDay()]);

        $completed = app(ZatcaSubmissionDispatcher::class)->dispatch($attempt);

        $this->assertPersistedPreflightFailure($completed);
        $this->assertSafeContext($this->onlyFailureLog(), $attempt, 'credential_unusable', RuntimeException::class);
        Http::assertNothingSent();
        $this->assertNothingSensitiveLogged();
    }

    // ═══════════════ D — النقل ═══════════════

    /** @test */
    public function an_unexpected_exception_thrown_by_the_http_layer_is_a_transport_error(): void
    {
        Http::fake(function () {
            throw new RuntimeException('Authorization: Basic TOKEN_MARKER body=<Invoice>SECRET_XML_MARKER</Invoice> -----BEGIN PRIVATE KEY----- PRIVATE_KEY_MARKER');
        });
        $attempt = $this->attempt();
        $before = $this->snapshotWorld();

        $completed = app(ZatcaSubmissionDispatcher::class)->dispatch($attempt);

        $this->assertPersistedPreflightFailure($completed);
        $this->assertSafeContext($this->onlyFailureLog(), $attempt, 'transport_error', RuntimeException::class);
        Queue::assertNothingPushed();
        $this->assertSame($before, $this->snapshotWorld());
        $this->assertNothingSensitiveLogged();
    }

    /**
     * كان رفض هذه البصمة المشوَّهة يحدث داخل النقل (`transport_error`). منذ حارس سلامة المستند الصادر (TAX-ZATCA Document Integrity
     * Hardening) تُرفض في مرحلة اللقطة قبل الاعتماد والنقل لأي فاتورة صدرت عبر السلسلة: الفشل نفسه (failed/submission_preflight_failed،
     * لا طلب شبكي) لكن أبكر. تحقّق النقل من شكل البصمة باقٍ دفاعاً ثانياً ويُختبر لفاتورة ما قبل السلسلة في ZatcaSubmissionIntegrityTest
     * وZatcaHttpTransportTest.
     *
     * @test
     */
    public function an_invalid_stored_hash_is_now_rejected_at_the_snapshot_stage_before_the_transport(): void
    {
        Http::fake();
        $attempt = $this->attempt();
        $this->invoice->update(['zatca_hash' => 'not-a-sha256-base64']); // لا يمسّ request_hash (محسوب من XML)

        $completed = app(ZatcaSubmissionDispatcher::class)->dispatch($attempt);

        $this->assertPersistedPreflightFailure($completed);
        $this->assertSafeContext($this->onlyFailureLog(), $attempt, 'snapshot_mismatch', ZatcaIntegrityException::class);
        Http::assertNothingSent();
    }

    /**
     * توصيف الحدّ الفعلي: `ZatcaHttpTransport` يحوّل `ConnectionException` بنفسه إلى نتيجة
     * `failed / connection_failed / retryable=true` ولا يصل المُرسِل استثناء. النتيجة مُرمَّزة
     * ومحفوظة أصلاً، فلا يُضاف سطر فشل المُرسِل ولا تتغيّر الحالة.
     *
     * @test
     */
    public function a_connection_failure_is_already_mapped_by_the_transport_and_is_unchanged(): void
    {
        Http::fake(function () {
            throw new ConnectionException('cURL error 7 TOKEN_MARKER');
        });
        $attempt = $this->attempt();

        $completed = app(ZatcaSubmissionDispatcher::class)->dispatch($attempt);

        $this->assertSame('failed', $completed->status);
        $this->assertSame('connection_failed', $completed->response_code);
        $this->assertTrue($completed->response_payload['retryable']);
        $this->assertSame([], $this->failureLogs());
        $this->assertNothingSensitiveLogged();
    }

    // ═══════════════ E — الاحتياطي العام ═══════════════

    /** @test */
    public function an_unclassified_non_database_failure_uses_the_generic_fallback(): void
    {
        Http::fake(['*' => Http::response(['reportingStatus' => 'REPORTED'], 200)]);
        $attempt = $this->attempt();

        // `complete()` الأولى (مسار النجاح) ترمي استثناءً غير قاعدي؛ الثانية (مسار الفشل) حقيقية.
        $real = app(ZatcaSubmissionService::class);
        $spy = Mockery::mock(ZatcaSubmissionService::class)->makePartial();
        $calls = 0;
        $spy->shouldReceive('complete')->andReturnUsing(function (...$args) use (&$calls, $real) {
            if (++$calls === 1) {
                throw new RuntimeException('SECRET_XML_MARKER unexpected');
            }

            return $real->complete(...$args);
        });
        app()->instance(ZatcaSubmissionService::class, $spy);

        $completed = app(ZatcaSubmissionDispatcher::class)->dispatch($attempt);

        $this->assertPersistedPreflightFailure($completed);
        $this->assertSafeContext($this->onlyFailureLog(), $attempt, 'preflight_error', RuntimeException::class);
        $this->assertNothingSensitiveLogged();
    }

    // ═══════════════ F/G — النجاح والقبول والرفض بلا تغيير ═══════════════

    /** @return array<string, array{0: int, 1: string, 2: bool}> */
    public static function httpOutcomes(): array
    {
        return [
            'accepted'           => [200, 'accepted', false],
            'rejected'           => [400, 'rejected', false],
            'temporary (retry)'  => [503, 'failed', true],
        ];
    }

    /**
     * @test
     * @dataProvider httpOutcomes
     */
    public function accepted_rejected_and_retryable_http_outcomes_are_unchanged_and_never_emit_the_failure_log(int $http, string $status, bool $retryable): void
    {
        Http::fake(['*' => Http::response(['status' => 'X', 'secret' => 'TOKEN_MARKER'], $http)]);
        $attempt = $this->attempt();

        $completed = app(ZatcaSubmissionDispatcher::class)->dispatch($attempt);

        $this->assertSame($status, $completed->status);
        $this->assertSame($http, $completed->response_http_status);
        $this->assertSame($retryable, $completed->response_payload['retryable']);
        $this->assertArrayNotHasKey('secret', $completed->response_payload);
        // المحاولة المنتهية لا تُعاد: تعود هي نفسها بلا شبكة جديدة.
        $this->assertSame($completed->id, app(ZatcaSubmissionDispatcher::class)->dispatch($completed)->id);
        Http::assertSentCount(1);

        $this->assertSame([], $this->failureLogs(), 'لا سطر فشل للمسارات المعتادة');
        $this->assertNothingSensitiveLogged();
    }
}
