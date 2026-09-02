<?php

namespace Tests\Feature;

use App\Support\WebhookSignature;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * PR-7: عقد توقيع الـ Webhooks (HMAC-SHA256 على «{ts}.{rawBody}»). يثبت الحتميّة،
 * وتأثّر التوقيع بالجسم والطابع الزمني، وصيغة الترويسة، والتحقّق بزمن ثابت.
 */
class WebhookSignatureTest extends TestCase
{
    #[Test]
    public function the_signature_is_deterministic_for_fixed_inputs(): void
    {
        $a = WebhookSignature::sign('secret', 1_700_000_000, '{"a":1}');
        $b = WebhookSignature::sign('secret', 1_700_000_000, '{"a":1}');

        $this->assertSame($a, $b);
        $this->assertSame(64, strlen($a)); // sha256 hex
        // قيمة hex معروفة تثبت العقد (لا انحراف صامت في مدخل التوقيع).
        $this->assertSame(hash_hmac('sha256', '1700000000.{"a":1}', 'secret'), $a);
    }

    #[Test]
    public function a_changed_body_changes_the_signature(): void
    {
        $this->assertNotSame(
            WebhookSignature::sign('secret', 1_700_000_000, '{"a":1}'),
            WebhookSignature::sign('secret', 1_700_000_000, '{"a":2}'),
        );
    }

    #[Test]
    public function a_changed_timestamp_changes_the_signature(): void
    {
        $this->assertNotSame(
            WebhookSignature::sign('secret', 1_700_000_000, '{"a":1}'),
            WebhookSignature::sign('secret', 1_700_000_001, '{"a":1}'),
        );
    }

    #[Test]
    public function a_changed_secret_changes_the_signature(): void
    {
        $this->assertNotSame(
            WebhookSignature::sign('secret-a', 1_700_000_000, '{"a":1}'),
            WebhookSignature::sign('secret-b', 1_700_000_000, '{"a":1}'),
        );
    }

    #[Test]
    public function the_signature_header_carries_timestamp_and_versioned_signature(): void
    {
        $sig = WebhookSignature::sign('secret', 1_700_000_000, '{"a":1}');
        $header = WebhookSignature::signatureHeader(1_700_000_000, $sig);

        $this->assertSame("t=1700000000,v1={$sig}", $header);
    }

    #[Test]
    public function verify_accepts_the_matching_signature_and_rejects_tampering(): void
    {
        $sig = WebhookSignature::sign('secret', 1_700_000_000, '{"a":1}');

        $this->assertTrue(WebhookSignature::verify('secret', 1_700_000_000, '{"a":1}', $sig));
        $this->assertFalse(WebhookSignature::verify('secret', 1_700_000_000, '{"a":2}', $sig));
        $this->assertFalse(WebhookSignature::verify('wrong', 1_700_000_000, '{"a":1}', $sig));
    }
}
