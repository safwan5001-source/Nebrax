<?php

namespace Tests\Feature;

use App\Support\WebhookUrlException;
use App\Support\WebhookUrlValidator;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * PR-7 (حرِج للدمج): دفاع SSRF لعناوين الـ Webhooks. يثبت رفض loopback/private/
 * link-local/reserved لـ IPv4 وIPv6 (مع فكّ IPv4-mapped)، ورفض الاعتمادات المضمَّنة
 * وhttp في الإنتاج، وقبول HTTPS العموميّ. مُحلِّل حتميّ فلا اعتماد على DNS العام.
 */
class WebhookUrlValidatorTest extends TestCase
{
    use InteractsWithWebhooks;

    private function validator(bool $allowInsecure = false): WebhookUrlValidator
    {
        // مُحلِّل يعيد الحرفيّ كما هو، والمضيف «public.example» إلى IP عموميّ.
        return new WebhookUrlValidator(
            $this->fakeWebhookResolver(['public.example' => ['93.184.216.34']]),
            $allowInsecure,
        );
    }

    private function assertRejected(string $url, string $expectedReason = ''): void
    {
        try {
            $this->validator()->validate($url);
            $this->fail("توقّعت رفض: {$url}");
        } catch (WebhookUrlException $e) {
            if ($expectedReason !== '') {
                $this->assertSame($expectedReason, $e->reason, $url);
            } else {
                $this->assertNotEmpty($e->reason);
            }
        }
    }

    #[Test]
    public function it_accepts_a_public_https_url(): void
    {
        $this->validator()->validate('https://public.example/webhooks');
        $this->validator()->validate('https://93.184.216.34/hook');
        $this->addToAssertionCount(1);
    }

    #[Test]
    public function it_rejects_non_https_in_production_policy(): void
    {
        $this->assertRejected('http://public.example/x', 'scheme_not_allowed');
    }

    #[Test]
    public function it_allows_http_only_under_an_explicit_insecure_exception(): void
    {
        $this->validator(allowInsecure: true)->validate('http://public.example/x');
        $this->addToAssertionCount(1);
    }

    #[Test]
    public function it_rejects_embedded_credentials(): void
    {
        $this->assertRejected('https://user:pass@public.example/x', 'embedded_credentials');
    }

    #[Test]
    public function it_rejects_ipv4_loopback_private_linklocal_and_cgnat(): void
    {
        $this->assertRejected('https://127.0.0.1/x', 'blocked_ip');
        $this->assertRejected('https://10.0.0.5/x', 'blocked_ip');
        $this->assertRejected('https://172.16.9.9/x', 'blocked_ip');
        $this->assertRejected('https://192.168.1.10/x', 'blocked_ip');
        $this->assertRejected('https://169.254.1.1/x', 'blocked_ip');   // link-local
        $this->assertRejected('https://100.64.0.1/x', 'blocked_ip');    // CGNAT
        $this->assertRejected('https://0.0.0.0/x', 'blocked_ip');
    }

    #[Test]
    public function it_rejects_ipv6_loopback_ula_linklocal_and_mapped(): void
    {
        $this->assertRejected('https://[::1]/x', 'blocked_ip');          // loopback
        $this->assertRejected('https://[fe80::1]/x', 'blocked_ip');      // link-local
        $this->assertRejected('https://[fc00::1]/x', 'blocked_ip');      // ULA
        $this->assertRejected('https://[fd12:3456::1]/x', 'blocked_ip'); // ULA
        $this->assertRejected('https://[::ffff:127.0.0.1]/x', 'blocked_ip'); // IPv4-mapped loopback
        $this->assertRejected('https://[::ffff:10.0.0.1]/x', 'blocked_ip');  // IPv4-mapped private
    }

    #[Test]
    public function it_rejects_a_hostname_that_resolves_to_a_private_ip(): void
    {
        // إعادة ربط DNS: اسمٌ عموميّ الظاهر يُحلّ إلى عنوانٍ داخليّ ⇒ رفض.
        $validator = new WebhookUrlValidator(
            $this->fakeWebhookResolver(['sneaky.example' => ['10.1.2.3']]),
            false,
        );

        try {
            $validator->validate('https://sneaky.example/x');
            $this->fail('توقّعت رفض المضيف المُحلَّل إلى IP خاصّ.');
        } catch (WebhookUrlException $e) {
            $this->assertSame('blocked_ip', $e->reason);
        }
    }

    #[Test]
    public function it_rejects_unsupported_schemes_and_malformed_urls(): void
    {
        $this->assertRejected('ftp://public.example/x', 'scheme_not_allowed');
        $this->assertRejected('not-a-url', 'invalid_url');
        $this->assertRejected('https:///nohost', 'invalid_url');
    }
}
