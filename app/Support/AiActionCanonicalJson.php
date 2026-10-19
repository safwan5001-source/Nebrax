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
        $key = (string) config('app.key');
        if (str_starts_with($key, 'base64:')) {
            $decoded = base64_decode(substr($key, 7), true);
            $key = $decoded === false ? $key : $decoded;
        }

        return hash_hmac('sha256', implode('|', [$tenantId, $actionId, (string) $version, self::encode($proposal)]), $key);
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
