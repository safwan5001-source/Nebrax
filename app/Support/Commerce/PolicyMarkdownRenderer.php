<?php

namespace App\Support\Commerce;

use DOMDocument;
use DOMElement;
use DOMNode;
use League\CommonMark\Environment\Environment;
use League\CommonMark\Extension\CommonMark\CommonMarkCoreExtension;
use League\CommonMark\MarkdownConverter;

/**
 * B8-2 — Markdown مقيَّد → HTML منقّى لنصوص السياسات العامة (دفاع على طبقتين).
 *
 * 1. `league/commonmark` (تبعية انتقالية أصلاً لـlaravel/framework) بخيارات:
 *    `html_input=strip` (لا HTML خام) و`allow_unsafe_links=false`.
 * 2. مرشّح DOM بقائمة سماح صارمة على **الناتج**: عناصر
 *    `h2–h4, p, ul, ol, li, strong, em, a, br, blockquote` فقط؛ `script/style/iframe/svg/form/…`
 *    تُحذف مع محتواها، وأي عنصر آخر يُفكّ غلافه (يبقى نصه). الوسوم الوحيدة ذات السمات: `a[href]`
 *    بمخطط `https|mailto|tel` بعد إزالة المحارف التحكمية والمسافات، ويُفرض `rel` ثابت.
 *    كل سمة أخرى (on*, style, srcdoc, class…) تسقط.
 *
 * دالة نقيّة بلا حالة وبلا وصول لقاعدة البيانات.
 */
final class PolicyMarkdownRenderer
{
    private const ALLOWED = ['h2', 'h3', 'h4', 'p', 'ul', 'ol', 'li', 'strong', 'em', 'a', 'br', 'blockquote'];

    /** تُحذف مع محتواها (لا يبقى نصها). */
    private const DROP = [
        'script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'svg', 'math',
        'form', 'input', 'button', 'select', 'textarea', 'link', 'meta', 'base', 'template', 'noscript',
        'audio', 'video', 'source', 'track', 'canvas', 'img', 'head', 'title',
    ];

    private const HEADING_MAP = ['h1' => 'h2', 'h2' => 'h2', 'h3' => 'h3', 'h4' => 'h4', 'h5' => 'h4', 'h6' => 'h4'];

    private const SAFE_SCHEMES = ['https', 'mailto', 'tel'];

    private const MAX_INPUT_CHARS = 20000;

    public static function render(string $markdown): string
    {
        $markdown = mb_substr($markdown, 0, self::MAX_INPUT_CHARS);
        if (trim($markdown) === '') {
            return '';
        }

        $environment = new Environment([
            'html_input' => 'strip',
            'allow_unsafe_links' => false,
            'max_nesting_level' => 20,
            'renderer' => ['soft_break' => "\n"],
        ]);
        $environment->addExtension(new CommonMarkCoreExtension);
        $html = (string) (new MarkdownConverter($environment))->convert($markdown);

        return self::sanitize($html);
    }

    /** مرشّح قائمة السماح وحده (يُختبر مستقلاً على HTML عدائي مباشر). */
    public static function sanitize(string $html): string
    {
        if (trim($html) === '') {
            return '';
        }

        $previous = libxml_use_internal_errors(true);
        $doc = new DOMDocument('1.0', 'UTF-8');
        $doc->loadHTML('<?xml encoding="utf-8"?><body><div id="__root">'.$html.'</div></body>', LIBXML_NONET | LIBXML_NOERROR | LIBXML_NOWARNING);
        libxml_clear_errors();
        libxml_use_internal_errors($previous);

        $root = $doc->getElementById('__root');
        if (! $root instanceof DOMElement) {
            return '';
        }

        self::clean($root, $doc);

        $out = '';
        foreach (iterator_to_array($root->childNodes) as $child) {
            $out .= $doc->saveHTML($child);
        }

        return trim($out);
    }

    private static function clean(DOMNode $parent, DOMDocument $doc): void
    {
        foreach (iterator_to_array($parent->childNodes) as $node) {
            if ($node->nodeType === XML_TEXT_NODE) {
                continue;
            }
            if (! $node instanceof DOMElement) {
                // تعليقات، تعليمات معالجة، CDATA، كيانات…
                $parent->removeChild($node);

                continue;
            }

            $tag = strtolower($node->tagName);

            if (in_array($tag, self::DROP, true)) {
                $parent->removeChild($node);

                continue;
            }

            self::clean($node, $doc);

            if (isset(self::HEADING_MAP[$tag])) {
                $node = self::rename($node, self::HEADING_MAP[$tag], $doc);
                $tag = self::HEADING_MAP[$tag];
            }

            if (! in_array($tag, self::ALLOWED, true)) {
                self::unwrap($node);

                continue;
            }

            self::filterAttributes($node, $tag);
            if ($tag === 'a' && ! $node->hasAttribute('href')) {
                self::unwrap($node);
            }
        }
    }

    private static function filterAttributes(DOMElement $el, string $tag): void
    {
        $href = $tag === 'a' ? $el->getAttribute('href') : null;
        foreach (iterator_to_array($el->attributes) as $attr) {
            $el->removeAttribute($attr->nodeName);
        }
        if ($tag !== 'a') {
            return;
        }
        $safe = self::safeHref((string) $href);
        if ($safe !== null) {
            $el->setAttribute('href', $safe);
            $el->setAttribute('rel', 'noopener nofollow ugc');
        }
    }

    /** https|mailto|tel فقط؛ لا نسبي ولا بلا مخطط ولا مخطط مموَّه. */
    private static function safeHref(string $href): ?string
    {
        // إزالة المحارف التحكمية والمسافات (java\tscript: ونحوها) قبل أي حكم.
        $clean = preg_replace('/[\x00-\x20\x7F\x{00A0}\x{200B}-\x{200D}\x{2028}\x{2029}\x{FEFF}]+/u', '', $href);
        if (! is_string($clean) || $clean === '' || mb_strlen($clean) > 2048) {
            return null;
        }
        if (preg_match('/^([a-z][a-z0-9+.\-]*):/i', $clean, $m) !== 1) {
            return null;
        }
        if (! in_array(strtolower($m[1]), self::SAFE_SCHEMES, true)) {
            return null;
        }
        if (preg_match('/[<>"\'`\\\\]/', $clean) === 1) {
            return null;
        }

        return $clean;
    }

    private static function rename(DOMElement $el, string $newTag, DOMDocument $doc): DOMElement
    {
        if (strtolower($el->tagName) === $newTag) {
            return $el;
        }
        $new = $doc->createElement($newTag);
        while ($el->firstChild !== null) {
            $new->appendChild($el->firstChild);
        }
        $el->parentNode?->replaceChild($new, $el);

        return $new;
    }

    private static function unwrap(DOMElement $el): void
    {
        $parent = $el->parentNode;
        if ($parent === null) {
            return;
        }
        while ($el->firstChild !== null) {
            $parent->insertBefore($el->firstChild, $el);
        }
        $parent->removeChild($el);
    }
}
