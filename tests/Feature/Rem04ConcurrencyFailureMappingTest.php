<?php

namespace Tests\Feature;

use App\Services\Accounting\InvoiceService;
use App\Support\ConcurrencyConflict;
use App\Tenancy\TenantContext;
use Illuminate\Database\DeadlockException;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use PDOException;
use RuntimeException;
use Tests\TestCase;

/**
 * REM-04 / SEC-02 (قرار المالك بعد المراجعة) — عقد استجابة تعارض التزامن:
 *
 *  - `POST /invoices/{id}/post` وحده: ضحية جمود/تسلسل (SQLSTATE 40P01 / 40001) ⇒ **503** +
 *    `Retry-After: 1` + `error_code = concurrency_conflict` + رسالة عربية/إنجليزية آمنة.
 *  - **بلا إعادة محاولة** داخل المعاملة (محاولة واحدة) — الجمود الأصلي مُعالَج بسبب الجذر
 *    (`FOR NO KEY UPDATE`) لا بالمحاولات.
 *  - `ApiController::domain()` لا يطبّق أي تحويل عام: بقية المسارات تبقى على سلوكها السابق (500).
 *  - أي خطأ قاعدة بيانات آخر على مسار الترحيل نفسه يبقى 500.
 *
 * يعمل بلا تغيير على SQLite وPostgreSQL (الفشل محقون بعد أن تكتب المعاملة كل أثرها).
 * `RefreshDatabase` تلفّ الاختبار بمعاملة، فتصير معاملة الترحيل متداخلة ولا تُلغى كتاباتها
 * عند الاستثناء — لذلك اكتمال الإلغاء والتعافي والثوابت المالية تُثبتها اختبارات PostgreSQL
 * (`Rem04PostingLockOrderPostgresTest`) التي تعمل بلا معاملة خارجية؛ وهنا عقد الاستجابة فقط.
 */
class Rem04ConcurrencyFailureMappingTest extends TestCase
{
    use InteractsWithApi;
    use RefreshDatabase;

    private const SQL_LEAKS = ['40P01', '40001', 'SQLSTATE', 'update "tenants"', 'tenants', 'deadlock'];

    protected function tearDown(): void
    {
        Rem04FlakyInvoiceService::reset(0);

        parent::tearDown();
    }

    private function pdoError(string $sqlState, string $message): QueryException
    {
        $pdo = new PDOException($message);
        $pdo->errorInfo = [$sqlState, 7, $message];

        return new QueryException('pgsql', 'update "tenants" set x = 1', [], $pdo);
    }

    /** @return array{token: string, invoice: string, tenant: string} */
    private function draftCreditInvoice(): array
    {
        $auth = $this->registerTenant('rem04-map-'.uniqid(), 'rem04map'.uniqid().'@example.test');
        app(TenantContext::class)->set($auth['tenant_id']);

        $partner = $this->withToken($auth['token'])->postJson('/api/partners', ['name' => 'عميل', 'type' => 'customer'])->assertCreated()['data']['id'];
        $invoice = $this->withToken($auth['token'])->postJson('/api/invoices', [
            'partner_id' => $partner, 'payment_type' => 'credit',
            'items' => [['description' => 'خدمة', 'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15]],
        ])->assertCreated()['data']['id'];

        return ['token' => $auth['token'], 'invoice' => $invoice, 'tenant' => $auth['tenant_id']];
    }

    private function useFlakyInvoiceService(int $failures, string $sqlState = '40P01'): void
    {
        app()->bind(InvoiceService::class, fn ($app) => $app->build(Rem04FlakyInvoiceService::class));
        Rem04FlakyInvoiceService::reset($failures, $sqlState);
    }

    // ───────────────────────── المطابقة (وحدة) ─────────────────────────

    /** @test */
    public function only_deadlock_and_serialization_failures_match(): void
    {
        $this->assertTrue(ConcurrencyConflict::matches($this->pdoError('40P01', 'SQLSTATE[40P01]: Deadlock detected')));
        $this->assertTrue(ConcurrencyConflict::matches($this->pdoError('40001', 'SQLSTATE[40001]: Serialization failure')));
        // داخل معاملة متداخلة يلفّ Laravel الضحية بـDeadlockException (الأصل في previous، أو بلا أصل).
        $this->assertTrue(ConcurrencyConflict::matches(new DeadlockException('deadlock detected', 0, $this->pdoError('40P01', 'deadlock detected'))));
        $this->assertTrue(ConcurrencyConflict::matches(new DeadlockException('deadlock detected')));
        // سبب بعيد في سلسلة previous.
        $this->assertTrue(ConcurrencyConflict::matches(new RuntimeException('wrapper', 0, $this->pdoError('40001', 'x'))));

        $this->assertFalse(ConcurrencyConflict::matches($this->pdoError('23505', 'SQLSTATE[23505]: Unique violation')));
        $this->assertFalse(ConcurrencyConflict::matches($this->pdoError('23503', 'SQLSTATE[23503]: Foreign key violation')));
        $this->assertFalse(ConcurrencyConflict::matches($this->pdoError('XX000', 'internal error')));
        $this->assertFalse(ConcurrencyConflict::matches($this->pdoError('HY000', 'database is locked')));
        $this->assertFalse(ConcurrencyConflict::matches(new RuntimeException('خطأ عمل')));
    }

    /** @test */
    public function the_response_contract_is_503_retry_after_error_code_and_a_safe_bilingual_message(): void
    {
        $response = ConcurrencyConflict::response();

        $this->assertSame(503, $response->getStatusCode());
        $this->assertSame('1', $response->headers->get('Retry-After'));
        $body = json_decode((string) $response->getContent(), true);
        $this->assertSame(['message', 'message_en', 'error_code'], array_keys($body));
        $this->assertSame('concurrency_conflict', $body['error_code']);
        $this->assertMatchesRegularExpression('/\p{Arabic}/u', $body['message']);
        $this->assertMatchesRegularExpression('/^[\x20-\x7E]+$/', $body['message_en']);
        foreach (self::SQL_LEAKS as $leak) {
            $this->assertStringNotContainsStringIgnoringCase($leak, $body['message']);
            $this->assertStringNotContainsStringIgnoringCase($leak, $body['message_en']);
        }
    }

    // ───────────────────── POST /invoices/{id}/post ─────────────────────

    /**
     * @test
     * @dataProvider concurrencyStates
     */
    public function invoice_post_answers_503_with_retry_after_and_error_code_in_a_single_attempt(string $sqlState): void
    {
        $ctx = $this->draftCreditInvoice();
        $this->useFlakyInvoiceService(1, $sqlState); // تفشل بعد أن كتبت المعاملة القيد وICV والحالة

        $response = $this->withToken($ctx['token'])->postJson("/api/invoices/{$ctx['invoice']}/post");

        $response->assertStatus(503)
            ->assertJsonPath('error_code', 'concurrency_conflict')
            ->assertJsonStructure(['message', 'message_en', 'error_code']);
        $this->assertSame('1', $response->headers->get('Retry-After'));
        $this->assertSame(1, Rem04FlakyInvoiceService::$calls, 'محاولة واحدة — لا إعادة محاولة.');

        $body = (string) $response->getContent();
        foreach (self::SQL_LEAKS as $leak) {
            $this->assertStringNotContainsStringIgnoringCase($leak, $body, 'لا تسرّب لنص SQL أو رمز SQLSTATE.');
        }
    }

    /** @return array<string, array{string}> */
    public static function concurrencyStates(): array
    {
        return ['deadlock 40P01' => ['40P01'], 'serialization 40001' => ['40001']];
    }

    /** @test */
    public function invoice_post_keeps_500_for_any_other_database_error(): void
    {
        $ctx = $this->draftCreditInvoice();
        $this->useFlakyInvoiceService(1, '23505');

        $response = $this->withToken($ctx['token'])->postJson("/api/invoices/{$ctx['invoice']}/post");

        $response->assertStatus(500);
        $this->assertNull($response->headers->get('Retry-After'));
        $this->assertNull($response->json('error_code'));
    }

    /** @test */
    public function invoice_post_business_errors_still_map_to_422(): void
    {
        $ctx = $this->draftCreditInvoice();
        $this->withToken($ctx['token'])->postJson("/api/invoices/{$ctx['invoice']}/post")->assertOk();

        $response = $this->withToken($ctx['token'])->postJson("/api/invoices/{$ctx['invoice']}/post");

        $response->assertStatus(422);
        $this->assertNull($response->json('error_code'));
    }

    // ───────────── بقية المسارات: لا تحويل عام عبر domain() ─────────────

    /** @test */
    public function an_unrelated_endpoint_of_the_same_controller_gets_no_global_mapping(): void
    {
        $ctx = $this->draftCreditInvoice();
        $this->mock(InvoiceService::class, function ($mock) {
            $mock->shouldReceive('deleteDraft')->andThrow($this->pdoError('40P01', 'SQLSTATE[40P01]: Deadlock detected'));
        });

        $response = $this->withToken($ctx['token'])->deleteJson("/api/invoices/{$ctx['invoice']}");

        $response->assertStatus(500);
        $this->assertNull($response->headers->get('Retry-After'));
        $this->assertNull($response->json('error_code'));
    }

    /** @test */
    public function an_endpoint_of_another_controller_gets_no_global_mapping(): void
    {
        $ctx = $this->draftCreditInvoice();
        $partnerId = DB::table('partners')->where('tenant_id', $ctx['tenant'])->value('id');
        $payment = $this->withToken($ctx['token'])->postJson('/api/payments', [
            'partner_id' => $partnerId, 'amount' => 1000, 'direction' => 'received', 'method' => 'cash',
        ]);
        $payment->assertCreated();

        $this->mock(\App\Services\Accounting\PaymentService::class, function ($mock) {
            $mock->shouldReceive('post')->andThrow($this->pdoError('40001', 'SQLSTATE[40001]: Serialization failure'));
        });

        $response = $this->withToken($ctx['token'])->postJson('/api/payments/'.$payment['data']['id'].'/post');

        $response->assertStatus(500);
        $this->assertNull($response->headers->get('Retry-After'));
        $this->assertNull($response->json('error_code'));
    }

    /** @test */
    public function domain_rethrows_every_database_error_unchanged_and_maps_only_business_errors(): void
    {
        $controller = new class extends \App\Http\Controllers\Api\ApiController {
            public function run(\Closure $fn): mixed
            {
                return $this->domain($fn);
            }
        };

        foreach ([
            $this->pdoError('40P01', 'deadlock'),
            $this->pdoError('40001', 'serialization'),
            new DeadlockException('deadlock detected', 0, $this->pdoError('40P01', 'deadlock')),
            $this->pdoError('23505', 'unique'),
        ] as $original) {
            try {
                $controller->run(fn () => throw $original);
                $this->fail('expected the database error to be rethrown');
            } catch (PDOException $e) {
                $this->assertSame($original, $e, 'domain() لا يحوّل أخطاء قاعدة البيانات.');
            }
        }

        try {
            $controller->run(fn () => throw new RuntimeException('خطأ عمل'));
            $this->fail('expected 422');
        } catch (\Symfony\Component\HttpKernel\Exception\HttpException $e) {
            $this->assertSame(422, $e->getStatusCode());
            $this->assertSame('خطأ عمل', $e->getMessage());
        }

        $this->assertSame('ok', $controller->run(fn () => 'ok'));
    }
}
