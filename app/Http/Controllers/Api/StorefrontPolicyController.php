<?php

namespace App\Http\Controllers\Api;

use App\Support\PublicApiErrorCode;
use App\Services\Commerce\StorefrontPresentationService;
use App\Support\Commerce\PolicyMarkdownRenderer;
use App\Support\Commerce\StorefrontPresentationNormalizer;
use App\Support\PublicApiResponse;
use App\Tenancy\StorefrontContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * B8-2 — `GET store/v1/policies/{slug}` (قراءة عامة فقط).
 *
 * الهوية من `Host` وحده عبر `ResolveStorefrontDomain` (`StorefrontContext`)؛ لا tenant/storefront من
 * الاستعلام أو من ترويسات أخرى. المصدر: **اللقطة المنشورة** حصراً (لا مسودة). يُرجع فقط سياسةً
 * مفعَّلةً ومنشورةً ذات متن غير فارغ؛ وإلا 404 موحَّد غير كاشف (slug مجهول/معطَّل/غير منشور/فارغ).
 *
 * اللغة (D-4b): `?locale=ar|en` (غيرها يُتجاهل) ثم لغة المتجر الافتراضية ثم ar ثم en؛ أول لغة بمتن
 * غير فارغ تُخدَم، و`fallback=true` إن اختلفت عن المطلوبة. `Cache-Control: no-store` (D-4i).
 */
class StorefrontPolicyController extends PublicApiController
{
    public function show(Request $request, StorefrontPresentationService $presentations, string $slug): JsonResponse
    {
        $context = app(StorefrontContext::class);

        if (! in_array($slug, StorefrontPresentationNormalizer::POLICY_PAGE_SLUGS, true) || ! $context->hasStorefront()) {
            return $this->notFound($request);
        }

        $snapshot = $presentations->publishedSnapshotForStorefront($context->storefrontId());
        $pages = is_array($snapshot) && is_array($snapshot['pages'] ?? null) ? $snapshot['pages'] : [];

        $content = null;
        $pageTitle = '';
        foreach ($pages as $page) {
            if (! is_array($page) || ($page['slug'] ?? null) !== $slug || ($page['enabled'] ?? false) !== true) {
                continue;
            }
            if (is_array($page['content'] ?? null) && $page['content'] !== []) {
                $content = $page['content'];
                $pageTitle = is_string($page['title'] ?? null) ? $page['title'] : '';
                break;
            }
        }
        if ($content === null) {
            return $this->notFound($request);
        }

        $requested = $this->requestedLocale($request);
        $candidates = array_values(array_unique(array_filter([
            $requested,
            $this->storefrontDefaultLocale($context->storefrontId()),
            'ar',
            'en',
        ])));

        foreach ($candidates as $locale) {
            $entry = $content[$locale] ?? null;
            if (! is_array($entry) || ! is_string($entry['body'] ?? null) || trim($entry['body']) === '') {
                continue;
            }
            $html = PolicyMarkdownRenderer::render($entry['body']);
            // لا متن مرئي بعد التنقية (مثل صورة وحدها أو وسوم فارغة) ⇒ كأنها فارغة: جرّب اللغة التالية ثم 404.
            if ($html === '' || trim(html_entity_decode(strip_tags($html), ENT_QUOTES | ENT_HTML5, 'UTF-8'), " \t\n\r\0\x0B\xC2\xA0\u{200B}") === '') {
                continue;
            }
            $title = is_string($entry['title'] ?? null) && trim($entry['title']) !== '' ? $entry['title'] : $pageTitle;

            return $this->withHeaders(PublicApiResponse::success($request, [
                'slug' => $slug,
                'locale' => $locale,
                'fallback' => $requested !== null && $locale !== $requested,
                'title' => $title,
                'html' => $html,
            ]));
        }

        return $this->notFound($request);
    }

    private function requestedLocale(Request $request): ?string
    {
        $value = $request->query('locale');

        return is_string($value) && in_array($value, StorefrontPresentationNormalizer::POLICY_CONTENT_LOCALES, true) ? $value : null;
    }

    private function storefrontDefaultLocale(string $storefrontId): ?string
    {
        $locale = \App\Models\Storefront::query()->whereKey($storefrontId)->value('default_locale');

        return is_string($locale) && in_array($locale, StorefrontPresentationNormalizer::POLICY_CONTENT_LOCALES, true) ? $locale : null;
    }

    private function notFound(Request $request): JsonResponse
    {
        return $this->withHeaders(PublicApiResponse::error($request, PublicApiErrorCode::NOT_FOUND, 'الصفحة غير موجودة.', 404));
    }

    private function withHeaders(JsonResponse $response): JsonResponse
    {
        $response->headers->set('Cache-Control', 'no-store');
        $response->headers->set('X-Content-Type-Options', 'nosniff');

        return $response;
    }
}
