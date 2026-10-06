<?php

namespace App\Http\Controllers\Api;

use App\Models\StorefrontMedia;
use App\Models\StorefrontMediaDerivative;
use App\Services\Commerce\StorefrontMediaDerivativeService;
use App\Services\Commerce\StorefrontMediaException;
use App\Services\Commerce\StorefrontMediaVariantGenerator;
use App\Services\Commerce\StorefrontPublishedMediaIndex;
use App\Tenancy\StorefrontContext;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * CUST-HV V2c — تسليم وسائط المُخصِّص للعموم (V0 §7.8، AMEND-1/4/12/16).
 * `GET /store/v1/media/customizer/{id}/{file}` — مسار المضيف الموثوق (Host →
 * `ResolveStorefrontDomain`)؛ لا `{tenantSlug}` ولا يُسجَّل في الفرع المتوارَث.
 *
 *  - `{id}` معرّف الوسيط (UUID → متغيّر السلّم الأساسي) أو `transformKey` (32
 *    hex → مشتقّ تحويل؛ يحمل مصدره، فيُحَلّ الوسيط من صفّ المشتقّ).
 *  - `{file}` = `{width}w.{webp|jpg}` أو `thumb-{160|320}.{webp|jpg}` (الصيغة
 *    مقطعٌ صريح لا تفاوض محتوى). المصغّرات للأساسي فقط.
 *
 * **بوابة المرجع المنشور:** لا يُخدَّم وسيطٌ إلا إن أشارت إليه الوثيقة *المنشورة*
 * للمتجر المحلول من المضيف (مجموعةٌ مُطبَّعة بفهرس — لا مسح JSON لكل طلب).
 * أي إخفاق — وسيطٌ مجهول/محذوف/غير جاهز/غير منشور/ملفٌ خارج السلّم/وسيطٌ لمستأجرٍ
 * آخر — **404 موحّد** بلا فرقٍ يُستدَلّ منه.
 *
 * **الذاكرة المؤقتة (AMEND-16):** هذا الأصل `private, no-store` دائماً؛ المتجر
 * الوحيد الذي قد يضع `public` هو بروكسي Next.js. يُرسَل `ETag` (مشتقٌّ من المحتوى
 * لا من الزمن) ويُجاب `If-None-Match` بـ304 **بعد** إعادة تشغيل البوابة كاملةً —
 * فإلغاء النشر يُنهي الخدمة عند أول إعادة تحقق.
 */
class StorefrontCustomizerMediaController extends PublicApiController
{
    public function show(
        Request $request,
        StorefrontPublishedMediaIndex $published,
        StorefrontMediaDerivativeService $derivatives,
    ): Response|StreamedResponse {
        $id = (string) $request->route('id');
        $file = (string) $request->route('file');

        $context = app(StorefrontContext::class);
        if (! $context->hasStorefront() || ! StorefrontMediaVariantGenerator::isValidFileName($file)) {
            $this->notFound();
        }

        $format = str_ends_with($file, '.webp')
            ? StorefrontMediaVariantGenerator::FORMAT_WEBP
            : StorefrontMediaVariantGenerator::FORMAT_JPG;

        if (preg_match('/\A[a-f0-9]{32}\z/', $id) === 1) {
            [$media, $etag, $read] = $this->derivative($id, $file, $format, $derivatives);
        } else {
            [$media, $etag, $read] = $this->base($id, $file);
        }

        // البوابة: الوثيقة المنشورة لهذا المتجر تشير إلى هذا الوسيط.
        if (! $published->isPublished($context->storefrontId(), $media->id)) {
            $this->notFound();
        }

        $headers = [
            'Cache-Control' => 'private, no-store',
            'ETag' => '"'.$etag.'"',
            'X-Content-Type-Options' => 'nosniff',
        ];

        if ($this->matches($request, $etag)) {
            return response('', 304, $headers);
        }

        try {
            $body = $read();
        } catch (StorefrontMediaException) {
            $this->notFound();
        }

        return response()->stream(function () use ($body): void {
            while (! $body->eof()) {
                echo $body->read(8192);
            }
        }, 200, $headers + ['Content-Type' => StorefrontMediaVariantGenerator::mimeForFormat($format)]);
    }

    /** @return array{0:StorefrontMedia,1:string,2:\Closure} */
    private function base(string $id, string $file): array
    {
        if (preg_match('/\A[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\z/', $id) !== 1) {
            $this->notFound();
        }

        $media = StorefrontMedia::query()->where('state', StorefrontMedia::STATE_ACTIVE)->find($id);
        if ($media === null || ! $media->isReady() || $media->variantByFile($file) === null) {
            $this->notFound();
        }

        $service = app(\App\Services\Commerce\StorefrontMediaService::class);

        // المحتوى مشتقٌّ من بصمة الأصل واسم الملف: تتغيّر إن تغيّر الأصل (لا يحدث —
        // الأصل ثابت)، وتبقى مستقرةً عبر إعادة توليد السلّم بالإعدادات نفسها.
        return [$media, substr(hash('sha256', $media->sha256.':'.$file), 0, 32), fn () => $service->readVariant($media, $file)];
    }

    /** @return array{0:StorefrontMedia,1:string,2:\Closure} */
    private function derivative(string $key, string $file, string $format, StorefrontMediaDerivativeService $service): array
    {
        $derivative = StorefrontMediaDerivative::query()
            ->where('transform_key', $key)
            ->where('format', $format)
            ->where('state', StorefrontMediaDerivative::STATE_READY)
            ->first();

        // المقطع `{file}` يجب أن يطابق صفّ المشتقّ نفسه (العرض الاسمي + الصيغة)،
        // وإلا 404 — لا قراءة مفتاحٍ بعرضٍ آخر.
        if ($derivative === null || $file !== StorefrontMediaVariantGenerator::fileName(StorefrontMediaVariantGenerator::KIND_WIDTH, $derivative->width, $format)) {
            $this->notFound();
        }

        $media = StorefrontMedia::query()->where('state', StorefrontMedia::STATE_ACTIVE)->find($derivative->media_id);
        if ($media === null || ! $media->isReady()) {
            $this->notFound();
        }

        // المفتاح نفسه مشتقٌّ من المحتوى (V0 §7.5): ثابتٌ ما دام المشتقّ جاهزاً.
        return [$media, $derivative->transform_key, fn () => $service->read($derivative)];
    }

    private function matches(Request $request, string $etag): bool
    {
        $header = (string) $request->header('If-None-Match', '');
        if ($header === '') {
            return false;
        }
        foreach (explode(',', $header) as $candidate) {
            if (trim(trim($candidate), '"') === $etag || trim($candidate) === '*') {
                return true;
            }
        }

        return false;
    }

    private function notFound(): never
    {
        abort(404, 'الوسائط غير موجودة.');
    }
}
