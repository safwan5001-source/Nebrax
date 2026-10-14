<?php

namespace Tests\Feature;

use App\Support\Communications\CommunicationChannel;
use App\Support\Communications\DeliveryStatus;
use App\Support\Communications\DispatchOutcome;
use App\Support\Communications\DispatchResult;
use App\Support\Communications\MessageClassification;
use App\Support\Communications\MessageIntent;
use App\Support\Communications\MessageRecipient;
use App\Support\Communications\ProviderCapabilities;
use InvalidArgumentException;
use PHPUnit\Framework\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  AWJ-COMMS-FOUNDATION-01 — عقود منصة الاتصالات (ADR-COMMS-01)
 * ═══════════════════════════════════════════════════════════════
 *  عقود نقيّة بلا Laravel ولا قاعدة بيانات: قنوات، تصنيف الرسالة، نيّة الرسالة،
 *  القدرات، نتيجة الإرسال، وحالات التسليم. لا يوجد إرسال ولا محوّل حقيقي.
 *
 *  تشغيل: php artisan test --filter=CommunicationsContractsTest
 */
class CommunicationsContractsTest extends TestCase
{
    private const OTP_CODE = '482913';

    private function intent(
        string $tenant = 'tenant-a',
        CommunicationChannel $channel = CommunicationChannel::Sms,
        MessageClassification $class = MessageClassification::Otp,
        string $address = '+966501234567',
        string $key = 'login:req-1',
        array $variables = ['code' => self::OTP_CODE],
    ): MessageIntent {
        return new MessageIntent($tenant, $class, new MessageRecipient($channel, $address), 'otp.login', $key, 'commerce.auth', $variables);
    }

    /** @test */
    public function the_four_channels_are_a_closed_list(): void
    {
        $this->assertSame(['sms', 'whatsapp', 'email', 'push'], array_map(fn ($c) => $c->value, CommunicationChannel::cases()));
        $this->assertTrue(CommunicationChannel::Sms->usesPhoneAddress());
        $this->assertTrue(CommunicationChannel::WhatsApp->usesPhoneAddress());
        $this->assertFalse(CommunicationChannel::Email->usesPhoneAddress());
        $this->assertFalse(CommunicationChannel::Push->usesPhoneAddress());
    }

    /** @test */
    public function classification_facts_separate_otp_transactional_service_and_marketing(): void
    {
        $this->assertSame(['otp', 'transactional', 'service', 'marketing'], array_map(fn ($c) => $c->value, MessageClassification::cases()));

        // الموافقة الصريحة: التسويق وحده.
        foreach (MessageClassification::cases() as $class) {
            $this->assertSame($class === MessageClassification::Marketing, $class->requiresExplicitConsent(), $class->value);
        }
        // محتوى OTP لا يُخزَّن أبداً؛ غيره قابل للتخزين (ضمن حدود شرائح لاحقة).
        $this->assertFalse(MessageClassification::Otp->mayStoreBody());
        $this->assertTrue(MessageClassification::Transactional->mayStoreBody());
        $this->assertTrue(MessageClassification::Marketing->mayStoreBody());
        // التسويق لا يُبدَّل مزوّده تلقائياً.
        $this->assertFalse(MessageClassification::Marketing->allowsProviderFallback());
        $this->assertTrue(MessageClassification::Otp->allowsProviderFallback());
    }

    /** @test */
    public function recipient_addresses_are_validated_per_channel(): void
    {
        foreach ([
            [CommunicationChannel::Sms, '+966501234567'],
            [CommunicationChannel::WhatsApp, '+14155550123'],
            [CommunicationChannel::Email, 'ops@example.com'],
            [CommunicationChannel::Push, 'device-token-abc123'],
        ] as [$channel, $address]) {
            $this->assertSame($address, (new MessageRecipient($channel, $address))->address);
        }

        foreach ([
            [CommunicationChannel::Sms, '0501234567'],        // بلا +
            [CommunicationChannel::Sms, '+0501234567'],       // يبدأ بصفر
            [CommunicationChannel::WhatsApp, '+96650'],       // قصير
            [CommunicationChannel::Email, 'not-an-email'],
            [CommunicationChannel::Push, ''],
            [CommunicationChannel::Push, "tok\nen"],          // محرف تحكّم
            [CommunicationChannel::Email, str_repeat('a', 321).'@x.io'],
        ] as [$channel, $address]) {
            try {
                new MessageRecipient($channel, $address);
                $this->fail("Accepted invalid {$channel->value} address");
            } catch (InvalidArgumentException $e) {
                if (strlen($address) > 3) {
                    $this->assertStringNotContainsString($address, $e->getMessage(), 'validation errors must not echo the address');
                }
            }
        }
    }

    /** @test */
    public function masked_recipients_never_expose_the_full_address(): void
    {
        $phone = new MessageRecipient(CommunicationChannel::Sms, '+966501234567');
        $email = new MessageRecipient(CommunicationChannel::Email, 'ahmed@example.com');
        $push = new MessageRecipient(CommunicationChannel::Push, 'secret-device-token');

        $this->assertSame('+•••67', $phone->masked());
        $this->assertSame('a•••@example.com', $email->masked());
        $this->assertSame('••••', $push->masked());
        $this->assertStringNotContainsString('50123', $phone->masked());
        $this->assertStringNotContainsString('hmed', $email->masked());
        $this->assertStringNotContainsString('token', $push->masked());
    }

    /** @test */
    public function an_intent_requires_a_tenant_and_safe_keys_and_string_variables(): void
    {
        $recipient = new MessageRecipient(CommunicationChannel::Sms, '+966501234567');
        $make = fn (string $tenant = 't', string $template = 'otp.login', string $key = 'k1', string $source = 'src', array $vars = []) => new MessageIntent($tenant, MessageClassification::Otp, $recipient, $template, $key, $source, $vars);

        $this->assertSame('t', $make()->tenantId);

        foreach ([
            fn () => $make(tenant: ''),
            fn () => $make(tenant: '   '),
            fn () => $make(template: 'bad template'),
            fn () => $make(key: ''),
            fn () => $make(key: str_repeat('k', 129)),
            fn () => $make(source: "src\n"),
            fn () => $make(vars: ['code' => 123456]),
            fn () => $make(vars: ['bad name' => 'x']),
            fn () => $make(vars: [0 => 'x']),
        ] as $i => $factory) {
            try {
                $factory();
                $this->fail("Case {$i} should have been rejected");
            } catch (InvalidArgumentException $e) {
                $this->assertStringNotContainsString('123456', $e->getMessage());
            }
        }
    }

    /** @test */
    public function the_idempotency_hash_is_scoped_by_tenant(): void
    {
        $a1 = $this->intent(tenant: 'tenant-a', key: 'same-key');
        $a2 = $this->intent(tenant: 'tenant-a', key: 'same-key', variables: ['code' => '000000']);
        $b = $this->intent(tenant: 'tenant-b', key: 'same-key');
        $a3 = $this->intent(tenant: 'tenant-a', key: 'other-key');

        $this->assertSame($a1->idempotencyHash(), $a2->idempotencyHash(), 'same tenant + key is the same send');
        $this->assertNotSame($a1->idempotencyHash(), $b->idempotencyHash(), 'the same key in another tenant must not collide');
        $this->assertNotSame($a1->idempotencyHash(), $a3->idempotencyHash());
        $this->assertMatchesRegularExpression('/^[a-f0-9]{64}$/', $a1->idempotencyHash());
    }

    /** @test */
    public function diagnostic_output_never_contains_the_otp_the_address_or_the_idempotency_key(): void
    {
        $intent = $this->intent(key: 'login:very-secret-key');

        $outputs = [
            'describe' => $intent->describe(),
            'print_r' => print_r($intent, true),
        ];
        ob_start();
        var_dump($intent);
        $outputs['var_dump'] = (string) ob_get_clean();

        foreach ($outputs as $name => $text) {
            $this->assertStringNotContainsString(self::OTP_CODE, $text, "{$name} leaks the OTP");
            $this->assertStringNotContainsString('+966501234567', $text, "{$name} leaks the phone");
            $this->assertStringNotContainsString('very-secret-key', $text, "{$name} leaks the idempotency key");
        }
        $this->assertStringContainsString('tenant=tenant-a', $intent->describe());
        $this->assertStringContainsString('class=otp', $intent->describe());
        $this->assertStringContainsString('recipient=+•••67', $intent->describe());
    }

    /** @test */
    public function delivery_status_transitions_are_monotonic_and_only_the_retry_loop_is_cyclic(): void
    {
        $cases = DeliveryStatus::cases();
        $this->assertCount(13, $cases);

        // لا انتقال إلى الذات؛ والحالات الواقعة على دورة هي حلقة إعادة المحاولة فقط (يحدّها الـoutbox لا الجدول).
        $onCycle = [];
        foreach ($cases as $start) {
            $this->assertFalse($start->canTransitionTo($start), "{$start->value} -> itself");
            $seen = [];
            $stack = [$start];
            while ($stack) {
                $current = array_pop($stack);
                foreach ($cases as $next) {
                    if ($current->canTransitionTo($next) && ! isset($seen[$next->value])) {
                        $seen[$next->value] = true;
                        $stack[] = $next;
                    }
                }
            }
            if (isset($seen[$start->value])) {
                $onCycle[] = $start->value;
            }
        }
        sort($onCycle);
        $this->assertSame(['failed_retryable', 'retry_scheduled', 'sending'], $onCycle, 'only the retry loop may cycle; nothing after acceptance can return');

        // أمثلة الاتجاه الواحد من ADR §6.
        $this->assertTrue(DeliveryStatus::Accepted->canTransitionTo(DeliveryStatus::Delivered));
        $this->assertTrue(DeliveryStatus::Delivered->canTransitionTo(DeliveryStatus::Read));
        $this->assertFalse(DeliveryStatus::Read->canTransitionTo(DeliveryStatus::Delivered), 'a late receipt must not downgrade read');
        $this->assertFalse(DeliveryStatus::Delivered->canTransitionTo(DeliveryStatus::Accepted));
        $this->assertTrue(DeliveryStatus::Unknown->canTransitionTo(DeliveryStatus::Delivered), 'unknown is settled by a receipt');
        $this->assertFalse(DeliveryStatus::Unknown->canTransitionTo(DeliveryStatus::Sending), 'unknown is never blindly resent');
        $this->assertFalse(DeliveryStatus::FailedPermanent->canTransitionTo(DeliveryStatus::Sending));
        $this->assertTrue(DeliveryStatus::FailedRetryable->canTransitionTo(DeliveryStatus::RetryScheduled));
        $this->assertTrue(DeliveryStatus::Queued->canTransitionTo(DeliveryStatus::BlockedPolicy));
    }

    /** @test */
    public function terminal_statuses_are_exactly_the_ones_with_no_exit(): void
    {
        $terminal = array_values(array_map(fn ($s) => $s->value, array_filter(DeliveryStatus::cases(), fn ($s) => $s->isTerminal())));
        sort($terminal);

        $this->assertSame(['blocked_policy', 'cancelled', 'expired', 'failed_permanent', 'read', 'undeliverable'], $terminal);
        $this->assertFalse(DeliveryStatus::Delivered->isTerminal(), 'delivered can still become read');
        $this->assertFalse(DeliveryStatus::Unknown->isTerminal());
    }

    /** @test */
    public function dispatch_outcomes_map_to_statuses_and_decide_fallback_safety(): void
    {
        $this->assertSame(DeliveryStatus::Accepted, DispatchOutcome::Accepted->deliveryStatus());
        $this->assertSame(DeliveryStatus::FailedRetryable, DispatchOutcome::RetryableFailure->deliveryStatus());
        $this->assertSame(DeliveryStatus::FailedPermanent, DispatchOutcome::PermanentFailure->deliveryStatus());
        $this->assertSame(DeliveryStatus::FailedPermanent, DispatchOutcome::Unsupported->deliveryStatus());
        $this->assertSame(DeliveryStatus::Unknown, DispatchOutcome::Unknown->deliveryStatus());

        // التبديل إلى مزود احتياطي: فقط عند فشل قابل لإعادة المحاولة أو عدم الدعم؛ لا بعد قبول ولا عند مهلة غير محسومة.
        $this->assertTrue(DispatchOutcome::RetryableFailure->permitsFallback());
        $this->assertTrue(DispatchOutcome::Unsupported->permitsFallback());
        $this->assertFalse(DispatchOutcome::Accepted->permitsFallback());
        $this->assertFalse(DispatchOutcome::Unknown->permitsFallback());
        $this->assertFalse(DispatchOutcome::PermanentFailure->permitsFallback());
    }

    /** @test */
    public function dispatch_results_are_classified_and_sanitise_their_diagnostic_text(): void
    {
        $ok = DispatchResult::accepted('prov-1');
        $this->assertTrue($ok->isAccepted());
        $this->assertSame('prov-1', $ok->providerMessageId);
        $this->assertSame(DeliveryStatus::Accepted, $ok->deliveryStatus());

        $retry = DispatchResult::retryableFailure('rate_limited', "slow\ndown\x00now");
        $this->assertFalse($retry->isAccepted());
        $this->assertSame('rate_limited', $retry->errorCode);
        $this->assertSame('slow down now', $retry->safeMessage);

        $long = DispatchResult::permanentFailure('invalid_number', str_repeat('é', 500));
        $this->assertSame(DispatchResult::MAX_MESSAGE, mb_strlen((string) $long->safeMessage));
        $this->assertNull(DispatchResult::permanentFailure('x', "\n\t ")->safeMessage);

        $this->assertSame(DispatchOutcome::Unsupported, DispatchResult::unsupported()->outcome);
        $this->assertSame(DispatchOutcome::Unknown, DispatchResult::unknown()->outcome);
        $this->assertSame(DeliveryStatus::Unknown, DispatchResult::unknown()->deliveryStatus());

        $this->expectException(InvalidArgumentException::class);
        DispatchResult::permanentFailure('Bad Code With Spaces');
    }

    /** @test */
    public function provider_capabilities_are_declared_not_assumed(): void
    {
        $caps = new ProviderCapabilities(
            [CommunicationChannel::Sms],
            [MessageClassification::Otp, MessageClassification::Transactional],
            deliveryReceipts: true,
        );

        $this->assertTrue($caps->supports(CommunicationChannel::Sms, MessageClassification::Otp));
        $this->assertFalse($caps->supports(CommunicationChannel::Sms, MessageClassification::Marketing));
        $this->assertFalse($caps->supports(CommunicationChannel::Email, MessageClassification::Otp));
        $this->assertTrue($caps->deliveryReceipts);
        $this->assertFalse($caps->providerIdempotency, 'defaults are conservative');

        foreach ([
            fn () => new ProviderCapabilities([], [MessageClassification::Otp]),
            fn () => new ProviderCapabilities([CommunicationChannel::Sms], []),
        ] as $factory) {
            try {
                $factory();
                $this->fail('A provider with no channel or no classification must be rejected');
            } catch (InvalidArgumentException) {
                $this->addToAssertionCount(1);
            }
        }
    }
}
