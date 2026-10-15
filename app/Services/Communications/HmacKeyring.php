<?php

namespace App\Services\Communications;

use App\Support\Communications\CommunicationsConfigurationException;

/**
 * AWJ-COMMS-02-B — مفاتيح HMAC المخصّصة لبصمة الطلب، بإصدارات. **منفصلة عن `APP_KEY`** (لا اشتقاق ولا إعادة استعمال).
 *
 * فشل مغلق بنص ثابت (لا مادة مفتاح في أي استثناء): الإصدار النشط مفقود/غير صالح، المفتاح مفقود/غير base64/أقصر من
 * 32 بايت/ضعيف (بايتات متشابهة)، أو يساوي `APP_KEY`. لا توليد ولا تدوير آلي. المفتاح الرئيسي لا يُستعمل مباشرةً:
 * يُشتقّ مفتاح لكل (إصدار، مستأجر) بـHKDF-SHA256 بملح المستأجر فلا ارتباط بين بصمات المستأجرين.
 */
final class HmacKeyring
{
    public const MAX_VERSION = 32767;

    public const MIN_KEY_BYTES = 32;

    private const HKDF_INFO = 'awj-comms/request/v1';

    /**
     * @param  array<int|string, mixed>  $keys  إصدار ⇒ مفتاح base64
     */
    public function __construct(
        private readonly array $keys,
        private readonly mixed $activeVersion,
        private readonly string $appKey = '',
    ) {
    }

    public static function fromConfig(): self
    {
        return new self(
            (array) config('communications.hmac.keys', []),
            config('communications.hmac.active_version'),
            (string) config('app.key', ''),
        );
    }

    /** الإصدار النشط (يُستعمل للصفوف الجديدة) — يفشل مغلقاً إن لم يكن صالحاً ومعه مفتاح صالح. */
    public function activeVersion(): int
    {
        $version = $this->parseVersion($this->activeVersion);
        $this->master($version);

        return $version;
    }

    /** بصمة HMAC-SHA256 (hex صغير، 64) لنص قياسي بمفتاح الإصدار المحدد مشتقاً للمستأجر. */
    public function fingerprint(string $tenantId, int $version, string $canonical): string
    {
        if (trim($tenantId) === '') {
            throw new CommunicationsConfigurationException('A tenant id is required to derive a fingerprint key.');
        }

        $subkey = hash_hkdf('sha256', $this->master($version), 32, self::HKDF_INFO, $tenantId);

        return hash_hmac('sha256', $canonical, $subkey);
    }

    private function parseVersion(mixed $raw): int
    {
        if (is_string($raw) && preg_match('/^[1-9][0-9]{0,4}$/', $raw) === 1) {
            $raw = (int) $raw;
        }

        if (! is_int($raw) || $raw < 1 || $raw > self::MAX_VERSION) {
            throw new CommunicationsConfigurationException('The active communications HMAC key version is missing or invalid.');
        }

        return $raw;
    }

    private function master(int $version): string
    {
        $encoded = $this->keys[$version] ?? null;
        if (! is_string($encoded) || $encoded === '') {
            throw new CommunicationsConfigurationException('A communications HMAC key for the required version is not configured.');
        }

        $raw = base64_decode($encoded, true);
        if ($raw === false || strlen($raw) < self::MIN_KEY_BYTES || count(array_unique(str_split($raw))) < 8) {
            throw new CommunicationsConfigurationException('A configured communications HMAC key is invalid (base64, at least 32 random bytes).');
        }

        if ($this->appKey !== '' && ($encoded === $this->appKey || hash_equals($this->appKeyMaterial(), $raw))) {
            throw new CommunicationsConfigurationException('A communications HMAC key must be independent of APP_KEY.');
        }

        return $raw;
    }

    private function appKeyMaterial(): string
    {
        $key = $this->appKey;
        if (str_starts_with($key, 'base64:')) {
            $decoded = base64_decode(substr($key, 7), true);
            if ($decoded !== false) {
                return $decoded;
            }
        }

        return $key;
    }
}
