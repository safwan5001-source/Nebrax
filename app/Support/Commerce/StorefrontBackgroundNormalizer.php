<?php

namespace App\Support\Commerce;

/**
 * P3-A-02 — document-level StorefrontBackground contract.
 *
 * This is deliberately separate from StorefrontSectionDesignNormalizer:
 * SectionBackground is an existing, independent contract and is not changed here.
 */
final class StorefrontBackgroundNormalizer
{
    public const DIRECTIONS = [
        'to-end', 'to-start', 'to-bottom', 'to-top',
        'to-bottom-end', 'to-bottom-start', 'to-top-end', 'to-top-start',
    ];

    private const ROLES = [
        'brand', 'accent', 'surface', 'surfaceAlt', 'text', 'heading', 'link', 'border', 'overlay',
    ];

    private const ALPHAS = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90];

    /** @return array<string,mixed>|null */
    public static function normalize(mixed $raw): ?array
    {
        if ($raw === null) {
            return null;
        }
        if (! is_array($raw) || array_is_list($raw)) {
            return null;
        }

        return match ($raw['kind'] ?? null) {
            'solid' => self::solid($raw),
            'gradient' => self::gradient($raw),
            'media' => self::media($raw),
            default => null,
        };
    }

    /**
     * Strictly validates an authored new background before save/publish.
     * A null value is the explicit editor action to clear the new field.
     *
     * @return list<string>
     */
    public static function errors(mixed $raw): array
    {
        if ($raw === null) {
            return [];
        }
        if (! is_array($raw) || array_is_list($raw)) {
            return ['presentation.background.invalid'];
        }

        $kind = $raw['kind'] ?? null;
        if (! is_string($kind) || ! in_array($kind, ['solid', 'gradient', 'media'], true)) {
            return ['presentation.background.kind'];
        }

        if ($kind === 'solid') {
            return self::colorErrors($raw['color'] ?? null, 'presentation.background.color');
        }
        if ($kind === 'gradient') {
            $errors = self::colorErrors($raw['from'] ?? null, 'presentation.background.from');
            $errors = array_merge($errors, self::colorErrors($raw['to'] ?? null, 'presentation.background.to'));
            if (! in_array($raw['direction'] ?? null, self::DIRECTIONS, true)) {
                $errors[] = 'presentation.background.direction';
            }
            return $errors;
        }

        $errors = self::mediaErrors($raw['media'] ?? null, 'presentation.background.media');
        if (array_key_exists('mobile', $raw)) {
            $errors = array_merge($errors, self::mediaErrors($raw['mobile'], 'presentation.background.mobile'));
        }
        if (array_key_exists('overlay', $raw)) {
            $overlay = $raw['overlay'];
            if (! is_array($overlay) || array_is_list($overlay)) {
                $errors[] = 'presentation.background.overlay';
            } else {
                if (array_key_exists('color', $overlay)) {
                    $errors = array_merge($errors, self::colorErrors($overlay['color'], 'presentation.background.overlay.color'));
                }
                if (! in_array($overlay['alpha'] ?? null, self::ALPHAS, true)) {
                    $errors[] = 'presentation.background.overlay.alpha';
                }
            }
        }
        return $errors;
    }

    /** @return array<string,mixed>|null */
    private static function solid(array $raw): ?array
    {
        $color = self::color($raw['color'] ?? null);
        return $color === null ? null : ['kind' => 'solid', 'color' => $color];
    }

    /** @return array<string,mixed>|null */
    private static function gradient(array $raw): ?array
    {
        $from = self::color($raw['from'] ?? null);
        $to = self::color($raw['to'] ?? null);
        $direction = $raw['direction'] ?? null;
        if ($from === null || $to === null || ! in_array($direction, self::DIRECTIONS, true)) {
            return null;
        }
        return ['kind' => 'gradient', 'from' => $from, 'to' => $to, 'direction' => $direction];
    }

    /** @return array<string,mixed>|null */
    private static function media(array $raw): ?array
    {
        $media = StorefrontMediaRefNormalizer::normalize($raw['media'] ?? null);
        if ($media === null) {
            return null;
        }
        $media['decorative'] = true;
        $out = ['kind' => 'media', 'media' => $media];

        if (array_key_exists('mobile', $raw)) {
            $mobile = StorefrontMediaRefNormalizer::normalize($raw['mobile']);
            if ($mobile !== null) {
                $mobile['decorative'] = true;
                $out['mobile'] = $mobile;
            }
        }
        $overlay = self::overlay($raw['overlay'] ?? null);
        if ($overlay !== null) {
            $out['overlay'] = $overlay;
        }
        return $out;
    }

    /** @return array<string,mixed>|null */
    private static function overlay(mixed $raw): ?array
    {
        if (! is_array($raw) || array_is_list($raw) || ! in_array($raw['alpha'] ?? null, self::ALPHAS, true)) {
            return null;
        }
        return [
            'color' => self::color($raw['color'] ?? null) ?? ['role' => 'overlay'],
            'alpha' => $raw['alpha'],
        ];
    }

    /** @return array<string,mixed>|null */
    private static function color(mixed $raw): ?array
    {
        if (! is_array($raw) || array_is_list($raw)) {
            return null;
        }
        if (is_string($raw['role'] ?? null) && in_array($raw['role'], self::ROLES, true)) {
            return ['role' => $raw['role']];
        }
        if (is_string($raw['hex'] ?? null) && self::isSafeHexColor($raw['hex'])) {
            return ['hex' => strtolower(trim($raw['hex']))];
        }
        return null;
    }

    /** @return list<string> */
    private static function colorErrors(mixed $raw, string $path): array
    {
        return self::color($raw) === null ? [$path] : [];
    }

    /** @return list<string> */
    private static function mediaErrors(mixed $raw, string $path): array
    {
        return StorefrontMediaRefNormalizer::normalize($raw) === null ? [$path] : [];
    }

    private static function isSafeHexColor(mixed $value): bool
    {
        return is_string($value) && preg_match('/^#([0-9a-fA-F]{6})$/', trim($value)) === 1;
    }
}
