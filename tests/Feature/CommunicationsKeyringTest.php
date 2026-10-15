<?php

namespace Tests\Feature;

use App\Services\Communications\HmacKeyring;
use App\Services\Communications\RequestFingerprinter;
use App\Support\Communications\CommunicationsConfigurationException;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/** AWJ-COMMS-02-B — مفاتيح HMAC: فشل مغلق، إصدارات، اشتقاق لكل مستأجر، واستقلال عن APP_KEY. */
class CommunicationsKeyringTest extends TestCase
{
    use InteractsWithCommunicationEnqueue;

    private function key(): string
    {
        return base64_encode(random_bytes(32));
    }

    #[Test]
    public function a_valid_keyring_yields_a_64_hex_fingerprint_and_the_active_version(): void
    {
        $ring = new HmacKeyring([1 => $this->key(), 2 => $this->key()], 2, 'base64:'.base64_encode(random_bytes(32)));

        $this->assertSame(2, $ring->activeVersion());
        $this->assertMatchesRegularExpression('/^[0-9a-f]{64}$/', $ring->fingerprint('tenant-a', 2, 'canonical'));
    }

    #[Test]
    public function the_fingerprint_is_deterministic_and_depends_on_tenant_version_and_text(): void
    {
        $ring = new HmacKeyring([1 => $this->key(), 2 => $this->key()], 1);
        $base = $ring->fingerprint('tenant-a', 1, 'text');

        $this->assertSame($base, $ring->fingerprint('tenant-a', 1, 'text'));
        $this->assertNotSame($base, $ring->fingerprint('tenant-b', 1, 'text'), 'per-tenant derived key');
        $this->assertNotSame($base, $ring->fingerprint('tenant-a', 2, 'text'), 'per-version key');
        $this->assertNotSame($base, $ring->fingerprint('tenant-a', 1, 'text2'));
    }

    /** @return array<string, array{0: array<int, mixed>, 1: mixed}> */
    public static function invalidConfigurations(): array
    {
        $good = base64_encode(random_bytes(32));

        return [
            'no active version' => [[1 => $good], null],
            'zero version' => [[1 => $good], 0],
            'negative version' => [[1 => $good], -1],
            'version above smallint' => [[1 => $good], 32768],
            'non numeric version' => [[1 => $good], 'abc'],
            'float version' => [[1 => $good], 1.5],
            'active version without a key' => [[1 => $good], 2],
            'empty key' => [[1 => ''], 1],
            'non string key' => [[1 => 12345], 1],
            'not base64' => [[1 => '***not-base64***'], 1],
            'too short (16 bytes)' => [[1 => base64_encode(random_bytes(16))], 1],
            'weak (repeated byte)' => [[1 => base64_encode(str_repeat('a', 32))], 1],
            'no keys at all' => [[], 1],
        ];
    }

    /** @param  array<int, mixed>  $keys */
    #[Test]
    #[DataProvider('invalidConfigurations')]
    public function invalid_or_missing_configuration_fails_closed(array $keys, mixed $active): void
    {
        $ring = new HmacKeyring($keys, $active);

        $this->expectException(CommunicationsConfigurationException::class);
        (new RequestFingerprinter($ring))->fingerprintForNewMessage($this->commIntent('tenant-a'));
    }

    #[Test]
    public function a_key_equal_to_app_key_is_rejected_in_both_encodings(): void
    {
        $raw = random_bytes(32);

        foreach (['base64:'.base64_encode($raw), base64_encode($raw)] as $appKey) {
            $ring = new HmacKeyring([1 => base64_encode($raw)], 1, $appKey);
            try {
                $ring->activeVersion();
                $this->fail('a key derived from APP_KEY must be rejected');
            } catch (CommunicationsConfigurationException $e) {
                $this->assertStringContainsString('independent of APP_KEY', $e->getMessage());
            }
        }
    }

    #[Test]
    public function exceptions_never_contain_key_material(): void
    {
        $secret = base64_encode(random_bytes(16)); // قصير ⇒ مرفوض

        try {
            (new HmacKeyring([1 => $secret], 1))->activeVersion();
            $this->fail('expected a configuration failure');
        } catch (CommunicationsConfigurationException $e) {
            $this->assertStringNotContainsString($secret, $e->getMessage());
            $this->assertNull($e->getPrevious());
        }
    }

    #[Test]
    public function from_config_reads_the_dedicated_settings_and_has_no_default_secret(): void
    {
        config(['communications.hmac' => ['active_version' => null, 'keys' => []]]);
        $this->expectException(CommunicationsConfigurationException::class);
        HmacKeyring::fromConfig()->activeVersion();
    }

    #[Test]
    public function the_shipped_config_defines_no_key_and_no_active_version(): void
    {
        $shipped = require base_path('config/communications.php');

        $this->assertSame([], $shipped['hmac']['keys']);
        $this->assertNull($shipped['hmac']['active_version']);
    }
}
