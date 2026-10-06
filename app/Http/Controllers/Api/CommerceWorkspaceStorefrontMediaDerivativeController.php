<?php

namespace App\Http\Controllers\Api;

use App\Http\Resources\StorefrontMediaDerivativeResource;
use App\Models\StorefrontMedia;
use App\Services\Commerce\StorefrontMediaDerivativeService;
use App\Services\Commerce\StorefrontMediaException;
use App\Services\Commerce\StorefrontMediaTransform;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;
use InvalidArgumentException;

/**
 * CUST-HV V2b — مشتقّات تحويل الاستخدام (قصّ/تدوير/تركيز/ملاءمة/تكبير) لوسائط
 * المُخصِّص (مساحة العمل، `commerce.manage`). العقد: docs/plans/store/CUST-HV-V0-
 * DECISIONS-AND-ARCHITECTURE-CONTRACT.md §7.5/§7.6/§7.10.
 *
 * **السلطة:** المستأجر من `TenantContext` (نطاق `BaseModel` الآلي)؛ وسيطٌ
 * أجنبي/محذوف = 404 موحّد غير كاشف. لا `tenant_id` ولا مفتاح ولا مسار من العميل،
 * والتحويل قائمة سماح صارمة (`StorefrontMediaTransform`) — أي حقل غريب يُرفض 422
 * بمساره. **لا توليد عند أي قراءة**: `status` قراءةٌ بحتة.
 */
class CommerceWorkspaceStorefrontMediaDerivativeController extends ApiController
{
    public function ensure(Request $request, StorefrontMediaDerivativeService $derivatives, string $mediaId): JsonResponse
    {
        $this->denySelfService($request);
        $asset = $this->activeOr404($mediaId);
        $this->rejectUnknown($request, ['transform', 'retry']);

        $request->validate([
            'transform' => ['required', 'array'],
            'retry' => ['sometimes', 'boolean'],
        ]);

        $transform = $this->transform($request->input('transform'));

        try {
            $status = $derivatives->ensure($asset, $transform, $request->boolean('retry'));
        } catch (StorefrontMediaException $e) {
            return response()->json(['message' => $e->getMessage(), 'code' => $e->errorCode] + $e->context, $e->status);
        }

        return response()->json(['data' => StorefrontMediaDerivativeResource::usage($status, $derivatives)]);
    }

    public function status(Request $request, StorefrontMediaDerivativeService $derivatives, string $mediaId): JsonResponse
    {
        $this->denySelfService($request);
        $asset = $this->activeOr404($mediaId);
        $this->rejectUnknown($request, ['transforms']);

        $max = (int) config('storefront_media.max_status_transforms_per_request', 16);
        $request->validate([
            'transforms' => ['required', 'array', 'min:1', 'max:'.$max],
            'transforms.*' => ['array'],
        ]);

        $out = [];
        foreach ((array) $request->input('transforms') as $index => $raw) {
            $transform = $this->transform($raw, "transforms.{$index}");
            $out[] = StorefrontMediaDerivativeResource::usage($derivatives->status($asset, $transform), $derivatives);
        }

        return response()->json(['data' => $out]);
    }

    // ─────────────────────────────── helpers ───────────────────────────────

    private function transform(mixed $raw, string $prefix = 'transform'): StorefrontMediaTransform
    {
        try {
            return StorefrontMediaTransform::fromInput($raw);
        } catch (InvalidArgumentException $e) {
            // الرسالة تبدأ بمسار الحقل (`transform.crop.zoom: …`) فيُربط الخطأ به.
            [$path, $message] = array_pad(explode(': ', $e->getMessage(), 2), 2, 'قيمة غير صالحة.');
            $path = $prefix === 'transform' ? $path : $prefix.substr($path, strlen('transform'));

            throw ValidationException::withMessages([$path => [$message]]);
        }
    }

    private function activeOr404(string $id): StorefrontMedia
    {
        $asset = StorefrontMedia::query()->where('state', StorefrontMedia::STATE_ACTIVE)->find($id);
        abort_if($asset === null, 404, 'الوسيط غير موجود.');

        return $asset;
    }

    /** @param list<string> $allowed */
    private function rejectUnknown(Request $request, array $allowed): void
    {
        $unknown = array_diff(array_keys($request->all()), $allowed);
        if ($unknown === []) {
            return;
        }

        throw ValidationException::withMessages(array_fill_keys(array_values($unknown), ['حقل غير مسموح.']));
    }

    private function denySelfService(Request $request): void
    {
        if ($request->user()?->role === 'self_service') {
            abort(403, 'مساحة عمل التجارة غير متاحة لحساب الخدمة الذاتية.');
        }
    }
}
