<?php

namespace App\Support;

/**
 * COM-MOBILE-I18N-1 (ADR-12) — the single source of truth for which locales
 * the public Commerce API surfaces (`/commerce/v1`, `/store/v1`, future App
 * Builder consumers) support, and the pure `Accept-Language` (RFC 9110
 * §12.5.4) resolution logic `ResolveCommerceLocale` applies.
 *
 * Kept as a pure static resolver (no request/app dependency) so it is
 * trivially unit-testable and reusable outside the middleware — the
 * middleware's only job is to call `resolve()` and hand the result to
 * `app()->setLocale()`.
 */
final class CommerceLocale
{
    public const SUPPORTED = ['ar', 'en'];

    /** ADR-12: Arabic is AWJ's default Commerce API locale. */
    public const DEFAULT = 'ar';

    /**
     * Resolves the best-match locale from a raw `Accept-Language` header
     * value against `SUPPORTED`, honoring `q` quality values (highest
     * first); the primary language subtag is matched (`en-US` → `en`), a
     * wildcard (`*`) is never itself treated as a match. Falls back to
     * `DEFAULT` when the header is absent, empty, or matches no supported
     * locale at any quality.
     */
    public static function resolve(?string $acceptLanguageHeader): string
    {
        if ($acceptLanguageHeader === null || trim($acceptLanguageHeader) === '') {
            return self::DEFAULT;
        }

        $candidates = [];
        foreach (explode(',', $acceptLanguageHeader) as $range) {
            $range = trim($range);
            if ($range === '') {
                continue;
            }

            $segments = explode(';', $range);
            $tag = strtolower(trim($segments[0]));
            if ($tag === '' || $tag === '*') {
                continue;
            }

            $quality = 1.0;
            foreach (array_slice($segments, 1) as $param) {
                $param = trim($param);
                if (str_starts_with($param, 'q=')) {
                    $quality = (float) substr($param, 2);
                }
            }

            $primary = explode('-', $tag)[0];
            $candidates[] = ['locale' => $primary, 'quality' => $quality];
        }

        usort($candidates, static fn (array $a, array $b): int => $b['quality'] <=> $a['quality']);

        foreach ($candidates as $candidate) {
            if (in_array($candidate['locale'], self::SUPPORTED, true)) {
                return $candidate['locale'];
            }
        }

        return self::DEFAULT;
    }
}
