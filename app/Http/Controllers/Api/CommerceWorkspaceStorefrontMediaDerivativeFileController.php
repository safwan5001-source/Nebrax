<?php

namespace App\Http\Controllers\Api;

use App\Models\StorefrontMedia;
use App\Models\StorefrontMediaDerivative;
use App\Services\Commerce\StorefrontMediaDerivativeService;
use App\Services\Commerce\StorefrontMediaException;
use App\Services\Commerce\StorefrontMediaVariantGenerator;
use App\Tenancy\TenantContext;
use App\Tenancy\TenantScope;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * CUST-HV V2b — قراءة ملفٍ مُشتقٍّ لمعاينة مساحة العمل عبر رابطٍ موقَّع قصير
 * الأجل. نفس نموذج ثقة `CommerceWorkspaceStorefrontMediaFileController` (V2a):
 * بلا `auth:sanctum` (`<img src>` لا يحمل Bearer) والتوقيع هو السلطة؛ يطابق
 * `tenant_id` الموقَّع يدوياً ويعيد فحص حالة الوسيط والمشتقّ في كل قراءة، وأي
 * إخفاقٍ = 404 موحّد غير كاشف. `Cache-Control: private` — لا ذاكرة مشتركة.
 * الخدمة العامة (V2c) مختلفة تماماً ولا تمرّ من هنا.
 */
class CommerceWorkspaceStorefrontMediaDerivativeFileController extends PublicApiController
{
    public function show(Request $request, StorefrontMediaDerivativeService $service, string $media, string $file): StreamedResponse
    {
        $tenantId = (string) $request->query('tenant', '');

        if ($tenantId === '' || preg_match('/\A([a-f0-9]{32})\.(webp|jpg)\z/', $file, $m) !== 1) {
            abort(404, 'الوسيط غير موجود.');
        }
        [, $key, $format] = $m;

        $asset = StorefrontMedia::query()
            ->withoutGlobalScope(TenantScope::class)
            ->where('tenant_id', $tenantId)
            ->where('state', StorefrontMedia::STATE_ACTIVE)
            ->find($media);
        if ($asset === null) {
            abort(404, 'الوسيط غير موجود.');
        }

        $derivative = StorefrontMediaDerivative::query()
            ->withoutGlobalScope(TenantScope::class)
            ->where('tenant_id', $tenantId)
            ->where('media_id', $asset->id)
            ->where('transform_key', $key)
            ->where('format', $format)
            ->where('state', StorefrontMediaDerivative::STATE_READY)
            ->first();
        if ($derivative === null) {
            abort(404, 'الوسيط غير موجود.');
        }

        $context = app(TenantContext::class);
        $context->set($tenantId);

        try {
            $body = $service->read($derivative);
        } catch (StorefrontMediaException) {
            abort(404, 'الوسيط غير موجود.');
        } finally {
            $context->forget();
        }

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
