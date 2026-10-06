<?php

namespace App\Http\Controllers\Api;

use App\Models\StorefrontMedia;
use App\Services\Commerce\StorefrontMediaException;
use App\Services\Commerce\StorefrontMediaService;
use App\Services\Commerce\StorefrontMediaVariantGenerator;
use App\Tenancy\TenantContext;
use App\Tenancy\TenantScope;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * CUST-HV V2a — قراءة متغيّر وسيطٍ لمعاينة مساحة العمل عبر رابطٍ موقَّع
 * قصير الأجل (V0 §7.3). نفس نموذج الثقة المعتمد في
 * `CommerceWorkspaceMediaController` (CUST-H4-8b): المسار **بلا** `auth:sanctum`
 * لأن `<img src>` لا يحمل Bearer؛ التوقيع (`signed`) هو السلطة، ويُصدَر فقط
 * داخل سياقٍ مصادَقٍ بالكامل.
 *
 * **لا `TenantContext` هنا** (الطلب غير مصادَق) — فالاستعلام يتجاوز النطاق
 * صراحةً ويطابق `tenant_id` الموقَّع يدوياً، ويُعيد فحص `state = active`
 * والمتغيّر المسمّى في كل قراءة. أي إخفاق = 404 موحّد غير كاشف.
 *
 * يخدم **المتغيّرات فقط**، لا الأصل الأصلي أبداً (قد يحمل EXIF).
 * `Cache-Control: private` — لا ذاكرة مشتركة لمسار مساحة العمل.
 */
class CommerceWorkspaceStorefrontMediaFileController extends PublicApiController
{
    public function show(Request $request, StorefrontMediaService $service, string $media, string $file): StreamedResponse
    {
        $tenantId = (string) $request->query('tenant', '');

        if ($tenantId === '' || ! StorefrontMediaVariantGenerator::isValidFileName($file)) {
            abort(404, 'الوسيط غير موجود.');
        }

        $asset = StorefrontMedia::query()
            ->withoutGlobalScope(TenantScope::class)
            ->where('tenant_id', $tenantId)
            ->where('state', StorefrontMedia::STATE_ACTIVE)
            ->find($media);

        if ($asset === null || ! $asset->isReady() || $asset->variantByFile($file) === null) {
            abort(404, 'الوسيط غير موجود.');
        }

        // خدمة التخزين تقرأ المستأجر من TenantContext: نضبطه لقراءة هذا الطلب
        // وحده ثم نمسحه — لا يتسرّب إلى ما بعده (البايتات تُبثّ من مجرى مفتوح).
        $context = app(TenantContext::class);
        $context->set($asset->tenant_id);

        try {
            $body = $service->readVariant($asset, $file);
        } catch (StorefrontMediaException) {
            abort(404, 'الوسيط غير موجود.');
        } finally {
            $context->forget();
        }

        $format = str_ends_with($file, '.webp') ? StorefrontMediaVariantGenerator::FORMAT_WEBP : StorefrontMediaVariantGenerator::FORMAT_JPG;

        return response()->stream(function () use ($body): void {
            while (! $body->eof()) {
                echo $body->read(8192);
            }
        }, 200, [
            'Content-Type' => StorefrontMediaVariantGenerator::mimeForFormat($format),
            'Cache-Control' => 'private, max-age=600',
            'X-Content-Type-Options' => 'nosniff',
        ]);
    }
}
