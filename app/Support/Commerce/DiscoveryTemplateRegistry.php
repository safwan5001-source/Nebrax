<?php

namespace App\Support\Commerce;

/**
 * AWJ-VD-H1 / VD-4a — code-owned display templates for the `discovery` section (§3.7).
 *
 * A template is a **bundle of defaults**: any value the section sets explicitly wins over it. `shape` / `size` feed
 * the facet-visual resolver as its `template` context (below the value's own visual, D-08); the layout keys are read
 * by the section renderer. Append-only: an id, once shipped, is never removed or renamed (stored documents name it).
 *
 * Twins: `discovery-templates.ts` in web and storefront. All three are pinned to the shared fixture
 * `tests/Fixtures/presentation/discovery-templates.json` (same ids, same order, same values).
 */
final class DiscoveryTemplateRegistry
{
    /** @var array<string, array<string, mixed>> */
    public const TEMPLATES = [
        'gift-circles' => [
            'layout' => 'image-grid',
            'columns' => ['mobile' => 3, 'tablet' => 4, 'desktop' => 6],
            'textPosition' => 'below',
            'shape' => 'circle',
            'size' => 'md',
            'cardStyle' => 'plain',
        ],
        'boutique-arches' => [
            'layout' => 'image-cards',
            'columns' => ['mobile' => 2, 'tablet' => 3, 'desktop' => 4],
            'textPosition' => 'below',
            'shape' => 'arch',
            'size' => 'lg',
            'cardStyle' => 'plain',
        ],
        'editorial-portrait' => [
            'layout' => 'image-cards',
            'columns' => ['mobile' => 2, 'tablet' => 3, 'desktop' => 4],
            'textPosition' => 'overlay',
            'shape' => 'portrait',
            'size' => 'lg',
            'cardStyle' => 'plain',
        ],
        'market-icons' => [
            'layout' => 'icon-grid',
            'columns' => ['mobile' => 4, 'tablet' => 6, 'desktop' => 8],
            'textPosition' => 'below',
            'shape' => 'rounded',
            'size' => 'sm',
            'cardStyle' => 'filled',
        ],
        'swipe-rail' => [
            'layout' => 'carousel',
            'rows' => 2,
            'textPosition' => 'below',
            'shape' => 'circle',
            'size' => 'md',
            'cardStyle' => 'plain',
        ],
        'minimal-text' => [
            'layout' => 'text-list',
            'columns' => ['mobile' => 1, 'tablet' => 2, 'desktop' => 3],
            'textPosition' => 'beside',
            'cardStyle' => 'outlined',
        ],
        'catalog-rounded' => [
            'layout' => 'image-grid',
            'columns' => ['mobile' => 3, 'tablet' => 4, 'desktop' => 6],
            'textPosition' => 'below',
            'shape' => 'rounded',
            'size' => 'md',
            'cardStyle' => 'outlined',
        ],
    ];

    /** @return list<string> */
    public static function ids(): array
    {
        return array_keys(self::TEMPLATES);
    }
}
