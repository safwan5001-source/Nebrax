<?php

namespace App\Support;

/**
 * V1 custom-domain hostname gate: allow only a real DNS subdomain of an
 * ICANN registrable domain. Apex / registrable hosts (including
 * multi-label suffixes such as shop.co.uk) are rejected.
 *
 * Uses a frozen Mozilla Public Suffix List ICANN snapshot
 * ({@see IcannPublicSuffixRules}) and the official matching algorithm
 * (https://publicsuffix.org/list/). Not a homemade label-count heuristic.
 *
 * Fail closed: unknown / unparsable / public-suffix-itself → not a subdomain.
 * No runtime HTTP. PRIVATE suffixes are out of this snapshot (CNAME-apex
 * is an ICANN-registrable concern).
 */
final class IcannRegistrableDomain
{
    /** @var array{exact: array<string, true>, wildcards: array<string, true>, exceptions: array<string, true>}|null */
    private static ?array $rules = null;

    public static function isSubdomain(string $hostname): bool
    {
        $hostname = self::normalize($hostname);
        if ($hostname === null) {
            return false;
        }

        $registrable = self::registrableDomain($hostname);

        return $registrable !== null && $hostname !== $registrable;
    }

    public static function registrableDomain(string $hostname): ?string
    {
        $hostname = self::normalize($hostname);
        if ($hostname === null) {
            return null;
        }

        $suffix = self::publicSuffix($hostname);
        if ($suffix === null || $suffix === '' || $hostname === $suffix) {
            return null;
        }

        $hostLabels = explode('.', $hostname);
        $suffixLabels = explode('.', $suffix);
        $need = count($suffixLabels) + 1;
        if (count($hostLabels) < $need) {
            return null;
        }

        return implode('.', array_slice($hostLabels, -$need));
    }

    private static function publicSuffix(string $hostname): ?string
    {
        $labels = explode('.', $hostname);
        $candidates = [];
        for ($i = 0, $n = count($labels); $i < $n; $i++) {
            $candidates[] = implode('.', array_slice($labels, $i));
        }

        $rules = self::rules();

        foreach ($candidates as $candidate) {
            if (isset($rules['exceptions'][$candidate])) {
                $parts = explode('.', $candidate);
                array_shift($parts);

                return $parts === [] ? '' : implode('.', $parts);
            }
        }

        $best = null;
        $bestLen = -1;
        foreach ($candidates as $candidate) {
            $parts = explode('.', $candidate);
            $n = count($parts);
            if (isset($rules['exact'][$candidate]) && $n > $bestLen) {
                $best = $candidate;
                $bestLen = $n;
            }
            if ($n >= 2) {
                $rest = implode('.', array_slice($parts, 1));
                if (isset($rules['wildcards'][$rest]) && $n > $bestLen) {
                    $best = $candidate;
                    $bestLen = $n;
                }
            }
        }

        if ($best !== null) {
            return $best;
        }

        return $labels[count($labels) - 1];
    }

    /**
     * @return array{exact: array<string, true>, wildcards: array<string, true>, exceptions: array<string, true>}
     */
    private static function rules(): array
    {
        if (self::$rules !== null) {
            return self::$rules;
        }

        $exact = [];
        $wildcards = [];
        $exceptions = [];
        foreach (explode("\n", IcannPublicSuffixRules::dat()) as $line) {
            $line = strtolower(trim($line));
            if ($line === '' || str_starts_with($line, '//')) {
                continue;
            }
            if (str_starts_with($line, '!')) {
                $exceptions[substr($line, 1)] = true;
            } elseif (str_starts_with($line, '*.')) {
                $wildcards[substr($line, 2)] = true;
            } else {
                $exact[$line] = true;
            }
        }

        return self::$rules = [
            'exact' => $exact,
            'wildcards' => $wildcards,
            'exceptions' => $exceptions,
        ];
    }

    private static function normalize(string $hostname): ?string
    {
        $hostname = strtolower(trim($hostname));
        $hostname = rtrim($hostname, '.');
        if ($hostname === '') {
            return null;
        }
        $labels = explode('.', $hostname);
        if ($labels === [] || in_array('', $labels, true)) {
            return null;
        }

        return $hostname;
    }
}
