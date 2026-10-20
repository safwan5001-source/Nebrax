<?php

namespace App\Support;

final class AiActionCanonicalJson
{
    public static function encode(array $value): string
    {
        self::sort($value);

        return (string) json_encode($value, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION);
    }

    public static function hash(string $tenantId, string $actionId, int $version, array $proposal): string
    {
        return hash_hmac('sha256', implode('|', [$tenantId, $actionId, (string) $version, self::encode($proposal)]), self::key());
    }

    /**
     * Keyed fingerprint of a canonical preview. The label separates this domain
     * from version hashes so a preview can never be replayed as a proposal.
     */
    public static function previewHash(string $tenantId, string $actionId, string $type, int $version, array $preview): string
    {
        return hash_hmac('sha256', implode('|', ['ai_action_preview.v1', $tenantId, $actionId, $type, (string) $version, self::encode($preview)]), self::key());
    }

    /** Keyed digest of a small canonical structure (e.g. the authority an approver held). */
    public static function digest(string $label, array $value): string
    {
        return hash_hmac('sha256', $label.'|'.self::encode($value), self::key());
    }

    private static function key(): string
    {
        $key = (string) config('app.key');
        if (str_starts_with($key, 'base64:')) {
            $decoded = base64_decode(substr($key, 7), true);
            $key = $decoded === false ? $key : $decoded;
        }

        return $key;
    }

    private static function sort(array &$value): void
    {
        foreach ($value as &$item) {
            if (is_array($item)) {
                self::sort($item);
            }
        }
        unset($item);

        if (! array_is_list($value)) {
            ksort($value, SORT_STRING);
        }
    }
}
