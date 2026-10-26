<?php

namespace App\Support\Commerce;

/**
 * X4-FIX — the single definition of "this storefront serves a policy", shared by the public policy endpoint
 * (`GET store/v1/policies/{slug}`, B8-2) and the availability signal in `GET store/v1/storefront`. Sharing it is
 * what keeps a footer link and the page behind it from ever disagreeing.
 *
 * Reads the PUBLISHED snapshot only (callers pass `publishedSnapshotForStorefront()`); never drafts. Pure: no
 * database, no tenant input, and it never returns a policy body — only the HTML the endpoint serves, or booleans.
 */
final class PublishedPolicyContent
{
    /**
     * The enabled page for `$slug` that carries content (first match wins, exactly as the endpoint picks it).
     *
     * @param  array<int, mixed>  $pages
     * @return array{content: array<string, mixed>, title: string}|null
     */
    public static function page(array $pages, string $slug): ?array
    {
        foreach ($pages as $page) {
            if (! is_array($page) || ($page['slug'] ?? null) !== $slug || ($page['enabled'] ?? false) !== true) {
                continue;
            }
            if (is_array($page['content'] ?? null) && $page['content'] !== []) {
                return [
                    'content' => $page['content'],
                    'title' => is_string($page['title'] ?? null) ? $page['title'] : '',
                ];
            }
        }

        return null;
    }

    /**
     * Sanitized HTML for one locale's entry, or null when it has no VISIBLE text after safe rendering
     * (an image alone, stripped HTML, empty markers…) — the endpoint treats that as empty.
     */
    public static function visibleHtml(mixed $entry): ?string
    {
        if (! is_array($entry) || ! is_string($entry['body'] ?? null) || trim($entry['body']) === '') {
            return null;
        }
        $html = PolicyMarkdownRenderer::render($entry['body']);
        if ($html === '' || trim(html_entity_decode(strip_tags($html), ENT_QUOTES | ENT_HTML5, 'UTF-8'), " \t\n\r\0\x0B\xC2\xA0\u{200B}") === '') {
            return null;
        }

        return $html;
    }

    /**
     * Slug ⇒ whether a request in ANY language is served (some language has visible text; the endpoint falls
     * back across languages, so availability does not depend on the visitor's locale).
     *
     * @param  array<string, mixed>|null  $snapshot  the published presentation snapshot, or null
     * @return array<string, bool>
     */
    public static function availability(?array $snapshot): array
    {
        $pages = is_array($snapshot) && is_array($snapshot['pages'] ?? null) ? $snapshot['pages'] : [];
        $out = [];
        foreach (StorefrontPresentationNormalizer::POLICY_PAGE_SLUGS as $slug) {
            $found = self::page($pages, $slug);
            $available = false;
            if ($found !== null) {
                foreach (StorefrontPresentationNormalizer::POLICY_CONTENT_LOCALES as $locale) {
                    if (self::visibleHtml($found['content'][$locale] ?? null) !== null) {
                        $available = true;
                        break;
                    }
                }
            }
            $out[$slug] = $available;
        }

        return $out;
    }
}
