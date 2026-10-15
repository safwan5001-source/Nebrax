<?php

namespace Tests\Feature;

use App\Support\Communications\CommunicationChannel;
use App\Support\Communications\MessageClassification;
use App\Support\Communications\MessageIntent;
use App\Support\Communications\MessageRecipient;
use App\Support\Communications\RequestCanonicalizer;
use PHPUnit\Framework\Attributes\Test;
use PHPUnit\Framework\TestCase;

/** AWJ-COMMS-02-B — التمثيل القياسي v1: حتمي، بطول مسبق، يغطي كل ما يغيّر الرسالة، ويستثني متغيرات OTP. */
class CommunicationsCanonicalizerTest extends TestCase
{
    private function intent(array $o = []): MessageIntent
    {
        $channel = $o['channel'] ?? CommunicationChannel::Sms;

        return new MessageIntent(
            'tenant-1',
            $o['classification'] ?? MessageClassification::Transactional,
            new MessageRecipient($channel, $o['address'] ?? ($channel === CommunicationChannel::Email ? 'Customer@Example.com' : '+966500000001')),
            $o['template'] ?? 'invoice.issued',
            $o['key'] ?? 'k1',
            $o['source'] ?? 'src.a',
            $o['variables'] ?? ['b' => '2', 'a' => '1'],
        );
    }

    #[Test]
    public function the_representation_is_deterministic_versioned_and_length_prefixed(): void
    {
        $canonical = RequestCanonicalizer::canonicalize($this->intent());

        $this->assertSame($canonical, RequestCanonicalizer::canonicalize($this->intent()));
        $this->assertStringStartsWith('16:awj.comms.req.v1;', $canonical);
        $this->assertStringContainsString('13:+966500000001;', $canonical);
    }

    #[Test]
    public function variable_order_does_not_matter_but_their_content_does(): void
    {
        $base = RequestCanonicalizer::canonicalize($this->intent(['variables' => ['a' => '1', 'b' => '2']]));

        $this->assertSame($base, RequestCanonicalizer::canonicalize($this->intent(['variables' => ['b' => '2', 'a' => '1']])));
        $this->assertNotSame($base, RequestCanonicalizer::canonicalize($this->intent(['variables' => ['a' => '1', 'b' => '3']])));
        $this->assertNotSame($base, RequestCanonicalizer::canonicalize($this->intent(['variables' => ['a' => '1']])));
        $this->assertNotSame($base, RequestCanonicalizer::canonicalize($this->intent(['variables' => ['a' => '1', 'b' => '2', 'c' => '']])));
    }

    #[Test]
    public function every_field_that_changes_the_message_changes_the_representation(): void
    {
        $base = RequestCanonicalizer::canonicalize($this->intent());

        $variants = [
            'recipient' => $this->intent(['address' => '+966500000002']),
            'template' => $this->intent(['template' => 'invoice.reminder']),
            'source' => $this->intent(['source' => 'src.b']),
            'channel' => $this->intent(['channel' => CommunicationChannel::WhatsApp]),
            'classification' => $this->intent(['classification' => MessageClassification::Service]),
        ];

        foreach ($variants as $label => $variant) {
            $this->assertNotSame($base, RequestCanonicalizer::canonicalize($variant), $label);
        }
    }

    #[Test]
    public function length_prefixing_prevents_field_boundary_ambiguity(): void
    {
        $a = RequestCanonicalizer::canonicalize($this->intent(['template' => 'ab.c', 'source' => 'd']));
        $b = RequestCanonicalizer::canonicalize($this->intent(['template' => 'ab', 'source' => 'c.d']));
        $c = RequestCanonicalizer::canonicalize($this->intent(['variables' => ['a' => 'b;2:x1;1:c']]));
        $d = RequestCanonicalizer::canonicalize($this->intent(['variables' => ['a' => 'b', 'x1' => 'c']]));

        $this->assertNotSame($a, $b);
        $this->assertNotSame($c, $d);
    }

    #[Test]
    public function email_addresses_are_normalized_to_lowercase_but_phones_are_untouched(): void
    {
        $upper = RequestCanonicalizer::canonicalize($this->intent(['channel' => CommunicationChannel::Email, 'address' => 'Customer@Example.COM']));
        $lower = RequestCanonicalizer::canonicalize($this->intent(['channel' => CommunicationChannel::Email, 'address' => 'customer@example.com']));

        $this->assertSame($upper, $lower);
        $this->assertStringContainsString('customer@example.com', $upper);
    }

    #[Test]
    public function otp_excludes_its_variables_so_the_one_time_code_can_never_be_recovered_from_a_fingerprint(): void
    {
        $withCode = RequestCanonicalizer::canonicalize($this->intent(['classification' => MessageClassification::Otp, 'variables' => ['code' => '482913']]));
        $otherCode = RequestCanonicalizer::canonicalize($this->intent(['classification' => MessageClassification::Otp, 'variables' => ['code' => '000000']]));

        $this->assertSame($withCode, $otherCode);
        $this->assertStringNotContainsString('482913', $withCode);
        $this->assertStringContainsString('vars:excluded', $withCode);
        // غير OTP يضمّن المتغيرات.
        $this->assertStringContainsString('vars:included', RequestCanonicalizer::canonicalize($this->intent()));
    }

    #[Test]
    public function the_canonical_text_never_contains_the_tenant_or_the_idempotency_key(): void
    {
        $canonical = RequestCanonicalizer::canonicalize($this->intent(['key' => 'secret-looking-key']));

        $this->assertStringNotContainsString('tenant-1', $canonical);
        $this->assertStringNotContainsString('secret-looking-key', $canonical);
    }
}
