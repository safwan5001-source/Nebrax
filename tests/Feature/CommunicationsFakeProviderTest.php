<?php

namespace Tests\Feature;

use App\Contracts\CommunicationProvider;
use App\Contracts\DocumentExtractionProvider;
use App\Services\Commerce\Otp\FakeOtpProvider;
use App\Services\Commerce\Otp\OtpProvider;
use App\Support\Communications\CommunicationChannel;
use App\Support\Communications\DeliveryStatus;
use App\Support\Communications\DispatchOutcome;
use App\Support\Communications\DispatchResult;
use App\Support\Communications\MessageClassification;
use App\Support\Communications\MessageIntent;
use App\Support\Communications\MessageRecipient;
use App\Support\Communications\ProviderCapabilities;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  AWJ-COMMS-FOUNDATION-01 — العقد مُطبَّقاً بمزوّد اختبار
 * ═══════════════════════════════════════════════════════════════
 *  يثبت أن واجهة `CommunicationProvider` قابلة للتطبيق لأربع قنوات، وأن النجاح والفشل
 *  والحالات غير المدعومة مصنَّفة، وأن لا اتصال خارجياً، وأن عزل المستأجر ومنع تسريب
 *  الرموز محفوظان، وأن السلوك القائم (OTP) لم يتغيّر.
 *
 *  تشغيل: php artisan test --filter=CommunicationsFakeProviderTest
 */
class CommunicationsFakeProviderTest extends TestCase
{
    private const OTP_CODE = '731904';

    /** أنماط الحراسة البنيوية، مفصولة ليُثبَت بالفحص الذاتي أنها تلتقط المخالفة فعلاً. */
    private const NETWORK_PATTERN = '/\b(curl_(init|exec)|fsockopen|stream_socket_client|file_get_contents\s*\(\s*[\'"]https?:|GuzzleHttp|Illuminate\\\\Support\\\\Facades\\\\Http|Http::|api[_-]?key|secret|password|bearer)/i';

    private const COUPLING_PATTERN = '/(Illuminate\\\\|App\\\\Models\\\\|App\\\\Tenancy\\\\|\bDB::|\bSchema::|\bCache::|\bLog::|\bQueue::|\bMail::|\bRoute::|\bconfig\s*\(|\benv\s*\(|\bapp\s*\(|\bauth\s*\()/';

    private function provider(string $key, array $channels, array $classes, bool $idempotent = false): CommunicationsFakeProvider
    {
        return new CommunicationsFakeProvider($key, new ProviderCapabilities($channels, $classes, deliveryReceipts: true, providerIdempotency: $idempotent));
    }

    private function intent(
        string $tenant = 'tenant-a',
        CommunicationChannel $channel = CommunicationChannel::Sms,
        MessageClassification $class = MessageClassification::Otp,
        string $key = 'req-1',
    ): MessageIntent {
        $address = match ($channel) {
            CommunicationChannel::Sms, CommunicationChannel::WhatsApp => '+966501234567',
            CommunicationChannel::Email => 'customer@example.com',
            CommunicationChannel::Push => 'device-token-xyz',
        };

        return new MessageIntent($tenant, $class, new MessageRecipient($channel, $address), 'otp.login', $key, 'commerce.auth', ['code' => self::OTP_CODE]);
    }

    /** @test */
    public function one_contract_covers_all_four_channels(): void
    {
        $providers = [
            $this->provider('fake-sms', [CommunicationChannel::Sms], [MessageClassification::Otp, MessageClassification::Transactional]),
            $this->provider('fake-whatsapp', [CommunicationChannel::WhatsApp], [MessageClassification::Transactional, MessageClassification::Service, MessageClassification::Marketing]),
            $this->provider('fake-email', [CommunicationChannel::Email], [MessageClassification::Transactional, MessageClassification::Marketing]),
            $this->provider('fake-push', [CommunicationChannel::Push], [MessageClassification::Transactional, MessageClassification::Service]),
        ];

        foreach ($providers as $provider) {
            $this->assertInstanceOf(CommunicationProvider::class, $provider);
            $channel = $provider->capabilities()->channels[0];
            $class = $provider->capabilities()->classifications[0];

            $result = $provider->send($this->intent(channel: $channel, class: $class));

            $this->assertTrue($result->isAccepted(), $provider->key());
            $this->assertSame(DeliveryStatus::Accepted, $result->deliveryStatus());
            $this->assertNotNull($result->providerMessageId);
        }
    }

    /** @test */
    public function capabilities_decide_support_and_unsupported_requests_return_a_classified_result_without_throwing(): void
    {
        $sms = $this->provider('fake-sms', [CommunicationChannel::Sms], [MessageClassification::Otp]);

        // قناة خارج القدرات.
        $wrongChannel = $sms->send($this->intent(channel: CommunicationChannel::Email, class: MessageClassification::Otp));
        // تصنيف خارج القدرات (التسويق على مزوّد OTP).
        $wrongClass = $sms->send($this->intent(channel: CommunicationChannel::Sms, class: MessageClassification::Marketing));

        foreach ([$wrongChannel, $wrongClass] as $result) {
            $this->assertSame(DispatchOutcome::Unsupported, $result->outcome);
            $this->assertSame(DeliveryStatus::FailedPermanent, $result->deliveryStatus());
            $this->assertTrue($result->outcome->permitsFallback(), 'an unsupported request may be routed to another provider');
        }
        $this->assertSame([], $sms->attempts(), 'an unsupported request is never attempted');
        $this->assertSame(0, $sms->deliveries());
    }

    /** @test */
    public function failures_are_classified_so_the_pipeline_can_decide_retry_or_fallback(): void
    {
        $intent = $this->intent();
        $cases = [
            ['retryable', DispatchResult::retryableFailure('rate_limited', 'slow down'), DeliveryStatus::FailedRetryable, true],
            ['permanent', DispatchResult::permanentFailure('invalid_number'), DeliveryStatus::FailedPermanent, false],
            ['timeout', DispatchResult::unknown('timeout'), DeliveryStatus::Unknown, false],
        ];

        foreach ($cases as [$label, $scripted, $status, $fallbackSafe]) {
            $provider = $this->provider('fake-sms', [CommunicationChannel::Sms], [MessageClassification::Otp])->willReturn($scripted);
            $result = $provider->send($intent);

            $this->assertSame($status, $result->deliveryStatus(), $label);
            $this->assertSame($fallbackSafe, $result->outcome->permitsFallback(), $label);
            $this->assertSame(0, $provider->deliveries(), "{$label}: nothing was delivered");
            $this->assertFalse($result->isAccepted());
        }
    }

    /** @test */
    public function a_provider_that_declares_idempotency_does_not_double_send_and_never_across_tenants(): void
    {
        $provider = $this->provider('fake-sms', [CommunicationChannel::Sms], [MessageClassification::Otp], idempotent: true);

        $first = $provider->send($this->intent(tenant: 'tenant-a', key: 'same-key'));
        $replay = $provider->send($this->intent(tenant: 'tenant-a', key: 'same-key'));
        $otherTenant = $provider->send($this->intent(tenant: 'tenant-b', key: 'same-key'));

        $this->assertSame($first->providerMessageId, $replay->providerMessageId, 'the replay returns the original result');
        $this->assertNotSame($first->providerMessageId, $otherTenant->providerMessageId, 'another tenant with the same key is a different send');
        $this->assertSame(2, $provider->deliveries(), 'tenant-a once, tenant-b once');
        $this->assertCount(2, $provider->attempts());
    }

    /** @test */
    public function a_provider_without_idempotency_support_is_not_pretended_to_be_idempotent(): void
    {
        $provider = $this->provider('fake-sms', [CommunicationChannel::Sms], [MessageClassification::Otp]);

        $provider->send($this->intent(key: 'same-key'));
        $provider->send($this->intent(key: 'same-key'));

        $this->assertSame(2, $provider->deliveries(), 'dedupe then belongs to the outbox (ADR-COMMS-01), not to this provider');
    }

    /** @test */
    public function tenant_context_travels_inside_the_intent_and_each_attempt_is_attributed_to_its_tenant(): void
    {
        $provider = $this->provider('fake-sms', [CommunicationChannel::Sms], [MessageClassification::Otp]);

        $provider->send($this->intent(tenant: 'tenant-a', key: 'a'));
        $provider->send($this->intent(tenant: 'tenant-b', key: 'b'));

        $this->assertStringContainsString('tenant=tenant-a', $provider->attempts()[0]);
        $this->assertStringContainsString('tenant=tenant-b', $provider->attempts()[1]);
        $this->assertStringNotContainsString('tenant-b', $provider->attempts()[0]);
        $this->assertSame('tenant-a', $this->intent(tenant: 'tenant-a')->tenantId);
    }

    /** @test */
    public function diagnostics_recorded_by_a_provider_never_contain_the_otp_or_the_full_address(): void
    {
        $provider = $this->provider('fake-sms', [CommunicationChannel::Sms], [MessageClassification::Otp]);
        $provider->send($this->intent());

        $recorded = implode("\n", $provider->attempts());
        $this->assertStringNotContainsString(self::OTP_CODE, $recorded);
        $this->assertStringNotContainsString('+966501234567', $recorded);
        $this->assertStringNotContainsString('req-1', $recorded, 'the idempotency key is not logged');
        $this->assertStringContainsString('class=otp', $recorded);
    }

    /** @test */
    public function sending_through_the_contract_makes_no_external_connection(): void
    {
        Http::fake();

        $provider = $this->provider('fake-email', [CommunicationChannel::Email], [MessageClassification::Transactional]);
        $provider->send($this->intent(channel: CommunicationChannel::Email, class: MessageClassification::Transactional));

        Http::assertNothingSent();

        // وبنيوياً: لا HTTP ولا SDK ولا مقابس ولا بيانات اعتماد في العقود ولا في مزوّد الاختبار.
        foreach ($this->contractFiles() as $file) {
            $this->assertDoesNotMatchRegularExpression(self::NETWORK_PATTERN, preg_replace('~/\*.*?\*/|//[^\n]*~s', '', (string) file_get_contents($file)), basename($file));
        }
    }

    /** @test */
    public function the_contracts_are_decoupled_from_laravel_the_database_and_tenant_context(): void
    {
        foreach ($this->contractFiles() as $file) {
            if (basename($file) === 'CommunicationsFakeProvider.php') {
                continue; // مزوّد الاختبار يعيش في tests؛ العقود وحدها تُفحص هنا.
            }
            $code = preg_replace('~/\*.*?\*/|//[^\n]*~s', '', (string) file_get_contents($file));
            $this->assertDoesNotMatchRegularExpression(self::COUPLING_PATTERN, $code, basename($file).' must stay framework-free');
        }
    }

    /** @test */
    public function the_structural_guards_actually_detect_violations(): void
    {
        foreach (['Http::post("x")', 'curl_init()', "file_get_contents('https://x.io')", 'new \\GuzzleHttp\\Client', '$apiKey = 1; // api_key', "'secret' => 'x'", 'use Illuminate\\Support\\Facades\\Http;'] as $bad) {
            $this->assertMatchesRegularExpression(self::NETWORK_PATTERN, $bad, $bad);
        }
        foreach (['use Illuminate\\Support\\Str;', 'DB::table("x")', 'config("app.name")', 'app(Foo::class)', 'use App\\Models\\User;', 'use App\\Tenancy\\TenantContext;', 'Log::info("x")'] as $bad) {
            $this->assertMatchesRegularExpression(self::COUPLING_PATTERN, $bad, $bad);
        }
        foreach (['public function send(MessageIntent $intent): DispatchResult', 'hash("sha256", $this->tenantId)'] as $good) {
            $this->assertDoesNotMatchRegularExpression(self::NETWORK_PATTERN, $good);
            $this->assertDoesNotMatchRegularExpression(self::COUPLING_PATTERN, $good);
        }
    }

    /** @test */
    public function existing_otp_and_provider_behaviour_is_untouched(): void
    {
        // OTP: الربط الوحيد ما زال المزوّد التجريبي القائم، ولا يطبّق عقد الاتصالات الجديد.
        $this->assertInstanceOf(FakeOtpProvider::class, app(OtpProvider::class));
        $this->assertNotContains(CommunicationProvider::class, class_implements(FakeOtpProvider::class));
        $this->assertNotContains(CommunicationProvider::class, class_implements(OtpProvider::class));

        // لا ربط للعقد الجديد في الحاوية: لا مزوّد حقيقي ولا افتراضي.
        $this->assertFalse(app()->bound(CommunicationProvider::class));

        // واجهة مزوّد Document Center القائمة لم تُمسّ ولا تتداخل مع العقد الجديد.
        $this->assertNotContains(CommunicationProvider::class, class_implements(DocumentExtractionProvider::class));
        $this->assertSame(['key', 'validateConfiguration', 'testConnection', 'extract'], array_map(fn ($m) => $m->getName(), (new \ReflectionClass(DocumentExtractionProvider::class))->getMethods()));
    }

    /** @test */
    public function the_provider_contract_is_minimal(): void
    {
        $methods = array_map(fn ($m) => $m->getName(), (new \ReflectionClass(CommunicationProvider::class))->getMethods());
        sort($methods);

        $this->assertSame(['capabilities', 'key', 'send'], $methods, 'no speculative methods: credentials/testConnection belong to a later slice');
    }

    /** @return list<string> */
    private function contractFiles(): array
    {
        return array_merge(
            glob(base_path('app/Support/Communications/*.php')) ?: [],
            [base_path('app/Contracts/CommunicationProvider.php'), __DIR__.'/CommunicationsFakeProvider.php'],
        );
    }
}
