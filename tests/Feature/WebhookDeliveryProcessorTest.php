<?php

namespace Tests\Feature;

use App\Models\Tenant;
use App\Models\WebhookDelivery;
use App\Models\WebhookEndpoint;
use App\Models\WebhookEvent;
use App\Services\WebhookDeliveryProcessor;
use App\Support\WebhookSignature;
use App\Support\WebhookUrlValidator;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * PR-7 (حرِج للدمج): معالج تسليم الـ Webhooks. يثبت النجاح (2xx) والفشل/التراجع
 * (4xx/5xx/مهلة/اتصال)، والفشل النهائيّ عند النفاد، والتوقيع والترويسات على الجسم
 * الخام، والمقتطف المحدود، وإعادة تحقّق SSRF، ودلالة الإيجار (لا ازدواج + استعادة).
 */
class WebhookDeliveryProcessorTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithWebhooks;

    private const SECRET = 'whsec_deadbeefdeadbeefdeadbeefdeadbeef';

    protected function setUp(): void
    {
        parent::setUp();
        // مُحلِّل يسمح لـ hook.example.com؛ السياسة تسمح http للاختبار عبر seam.
        $this->app->bind(WebhookUrlValidator::class, fn () => new WebhookUrlValidator($this->fakeWebhookResolver(), false));
    }

    private function processor(): WebhookDeliveryProcessor
    {
        return app(WebhookDeliveryProcessor::class);
    }

    /** ينشئ اشتراكًا + حدثًا + تسليمًا مستحقًّا الآن. */
    private function seedDelivery(array $overrides = [], string $url = 'https://hook.example.com/receive'): WebhookDelivery
    {
        $tenant = Tenant::create(['name' => 'd', 'slug' => 'd-' . Str::random(5)]);
        $endpoint = $this->makeEndpoint($tenant, ['partner.created'], self::SECRET, $url);
        $event = WebhookEvent::query()->create([
            'tenant_id' => $tenant->id, 'type' => 'partner.created', 'api_version' => 'v1',
            'source_type' => 'App\\Models\\Partner', 'source_id' => (string) Str::uuid(),
            'payload' => ['id' => 'p1', 'name' => 'x'], 'occurred_at' => now(),
        ]);

        return WebhookDelivery::query()->create(array_merge([
            'tenant_id' => $tenant->id, 'webhook_event_id' => $event->id, 'webhook_endpoint_id' => $endpoint->id,
            'status' => WebhookDelivery::STATUS_PENDING, 'attempts' => 0, 'next_attempt_at' => now(),
        ], $overrides));
    }

    #[Test]
    public function a_2xx_response_marks_the_delivery_delivered(): void
    {
        Http::fake(['*' => Http::response('ok', 200)]);
        $delivery = $this->seedDelivery();

        $summary = $this->processor()->processDueBatch();

        $this->assertSame(1, $summary['delivered']);
        $delivery->refresh();
        $this->assertSame(WebhookDelivery::STATUS_DELIVERED, $delivery->status);
        $this->assertSame(1, $delivery->attempts);
        $this->assertNull($delivery->next_attempt_at);
        $this->assertNotNull($delivery->delivered_at);
        $this->assertNotNull($delivery->endpoint()->withoutGlobalScopes()->first()->last_success_at);
    }

    #[Test]
    public function the_delivery_is_signed_over_the_raw_body_with_the_expected_headers(): void
    {
        Http::fake(['*' => Http::response('', 200)]);
        $delivery = $this->seedDelivery();

        $this->processor()->processDueBatch();

        $recorded = Http::recorded();
        $this->assertCount(1, $recorded);
        [$request] = $recorded[0];

        $body = $request->body();
        $ts = (int) $request->header(WebhookSignature::HEADER_TIMESTAMP)[0];
        $sigHeader = $request->header(WebhookSignature::HEADER_SIGNATURE)[0];
        $this->assertMatchesRegularExpression('/^t=\d+,v1=[0-9a-f]{64}$/', $sigHeader);
        $sig = substr($sigHeader, (int) strpos($sigHeader, 'v1=') + 3);

        $this->assertTrue(WebhookSignature::verify(self::SECRET, $ts, $body, $sig), 'التوقيع يتحقّق على الجسم الخام');
        $this->assertNotEmpty($request->header(WebhookSignature::HEADER_ID)[0]);
        $this->assertNotEmpty($request->header(WebhookSignature::HEADER_DELIVERY)[0]);
        $this->assertSame('partner.created', $request->header(WebhookSignature::HEADER_EVENT)[0]);
        $this->assertSame('AWJ-Webhooks/1.0', $request->header('User-Agent')[0]);
        // المغلَّف يحمل معرّف الحدث و data، ولا يحمل السرّ.
        $this->assertStringContainsString('"type":"partner.created"', $body);
        $this->assertStringNotContainsString(self::SECRET, $body);
    }

    #[Test]
    public function a_5xx_response_schedules_a_retry_with_backoff(): void
    {
        Http::fake(['*' => Http::response('boom', 500)]);
        $delivery = $this->seedDelivery();

        $summary = $this->processor()->processDueBatch();

        $this->assertSame(1, $summary['retried']);
        $delivery->refresh();
        $this->assertSame(WebhookDelivery::STATUS_RETRY_SCHEDULED, $delivery->status);
        $this->assertSame(1, $delivery->attempts);
        $this->assertSame(500, $delivery->last_status_code);
        $this->assertTrue($delivery->next_attempt_at->isFuture());
        $this->assertNull($delivery->reserved_until);
    }

    #[Test]
    public function a_4xx_response_is_a_retryable_failure(): void
    {
        Http::fake(['*' => Http::response('nope', 400)]);
        $delivery = $this->seedDelivery();

        $this->processor()->processDueBatch();

        $this->assertSame(WebhookDelivery::STATUS_RETRY_SCHEDULED, $delivery->refresh()->status);
    }

    #[Test]
    public function a_connection_failure_schedules_a_retry(): void
    {
        Http::fake(fn () => throw new ConnectionException('timeout'));
        $delivery = $this->seedDelivery();

        $summary = $this->processor()->processDueBatch();

        $this->assertSame(1, $summary['retried']);
        $delivery->refresh();
        $this->assertSame(WebhookDelivery::STATUS_RETRY_SCHEDULED, $delivery->status);
        $this->assertNotNull($delivery->last_error);
    }

    #[Test]
    public function the_last_attempt_moves_to_a_terminal_failed_state(): void
    {
        Http::fake(['*' => Http::response('boom', 500)]);
        // عند المحاولة الأخيرة (max-1 محاولة سابقة) يصبح الفشل نهائيًّا.
        $max = (int) config('webhooks.delivery.max_attempts');
        $delivery = $this->seedDelivery(['attempts' => $max - 1]);

        $summary = $this->processor()->processDueBatch();

        $this->assertSame(1, $summary['failed']);
        $delivery->refresh();
        $this->assertSame(WebhookDelivery::STATUS_FAILED, $delivery->status);
        $this->assertSame($max, $delivery->attempts);
        $this->assertNull($delivery->next_attempt_at);
        $this->assertNotNull($delivery->failed_at);
    }

    #[Test]
    public function the_stored_response_snippet_is_bounded(): void
    {
        $limit = (int) config('webhooks.delivery.response_snippet_bytes');
        Http::fake(['*' => Http::response(str_repeat('A', $limit * 4), 500)]);
        $delivery = $this->seedDelivery();

        $this->processor()->processDueBatch();

        $this->assertLessThanOrEqual($limit, strlen((string) $delivery->refresh()->last_response_snippet));
    }

    #[Test]
    public function a_url_that_became_blocked_fails_terminally_without_sending(): void
    {
        Http::fake(['*' => Http::response('ok', 200)]);
        // اشتراك بعنوان داخليّ (تجاوز التحقّق بإنشائه مباشرةً)، فيُرفض وقت الإرسال.
        $delivery = $this->seedDelivery([], 'https://10.0.0.9/internal');

        $summary = $this->processor()->processDueBatch();

        $this->assertSame(1, $summary['failed']);
        $this->assertSame(WebhookDelivery::STATUS_FAILED, $delivery->refresh()->status);
        $this->assertStringStartsWith('blocked_url', (string) $delivery->last_error);
        Http::assertNothingSent();
    }

    #[Test]
    public function a_disabled_endpoint_is_not_delivered(): void
    {
        Http::fake(['*' => Http::response('ok', 200)]);
        $delivery = $this->seedDelivery();
        $delivery->endpoint()->withoutGlobalScopes()->first()->forceFill(['status' => WebhookEndpoint::STATUS_DISABLED])->save();

        $summary = $this->processor()->processDueBatch();

        $this->assertSame(1, $summary['failed']);
        Http::assertNothingSent();
    }

    #[Test]
    public function a_delivery_with_a_live_lease_is_not_reclaimed(): void
    {
        Http::fake(['*' => Http::response('ok', 200)]);
        // في المعالجة بإيجار حيّ (مستقبل) → لا يُطالَب ثانيةً.
        $delivery = $this->seedDelivery([
            'status' => WebhookDelivery::STATUS_PROCESSING,
            'reserved_until' => now()->addMinutes(5),
        ]);

        $summary = $this->processor()->processDueBatch();

        $this->assertSame(0, $summary['claimed']);
        Http::assertNothingSent();
        $this->assertSame(WebhookDelivery::STATUS_PROCESSING, $delivery->refresh()->status);
    }

    #[Test]
    public function a_stale_processing_lease_is_reclaimed_and_delivered(): void
    {
        Http::fake(['*' => Http::response('ok', 200)]);
        // إيجار منقضٍ (مُشغّل مات) → يُستعاد ويُسلَّم.
        $delivery = $this->seedDelivery([
            'status' => WebhookDelivery::STATUS_PROCESSING,
            'reserved_until' => now()->subMinutes(5),
        ]);

        $summary = $this->processor()->processDueBatch();

        $this->assertSame(1, $summary['claimed']);
        $this->assertSame(1, $summary['delivered']);
        $this->assertSame(WebhookDelivery::STATUS_DELIVERED, $delivery->refresh()->status);
    }

    #[Test]
    public function a_delivered_delivery_is_not_processed_again(): void
    {
        Http::fake(['*' => Http::response('ok', 200)]);
        $delivery = $this->seedDelivery();
        $this->processor()->processDueBatch();
        Http::fake(['*' => Http::response('ok', 200)]); // reset recorder

        $summary = $this->processor()->processDueBatch();

        $this->assertSame(0, $summary['claimed']);
        Http::assertNothingSent();
    }
}
