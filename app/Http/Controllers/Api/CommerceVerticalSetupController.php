<?php

namespace App\Http\Controllers\Api;

use App\Models\Storefront;
use App\Services\Commerce\StorefrontVerticalSetupService;
use App\Tenancy\TenantContext;
use DomainException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use RuntimeException;

/**
 * FLOWERS-H14 / ADR-25 — قائمة تهيئة ملف «الهدايا والورود» والقيم المبدئية. `{id}` محدِّد متجر فقط؛
 * الملكية عبر `TenantContext` (404 غير كاشف). القراءة والمعاينة بـ`commerce.manage`؛ التطبيق يكتب
 * أبعاد الكتالوج فيتطلب كذلك `products.manage` (نفس صلاحية كتابة الأبعاد — انظر المسارات).
 */
final class CommerceVerticalSetupController extends ApiController
{
    public function show(Request $request, StorefrontVerticalSetupService $setup, string $id): JsonResponse
    {
        $this->denySelfService($request);

        return response()->json(['data' => ['setup' => $setup->status($this->ownedStorefront($id))]]);
    }

    public function previewStarters(Request $request, StorefrontVerticalSetupService $setup, string $id): JsonResponse
    {
        $this->denySelfService($request);
        $storefront = $this->ownedStorefront($id);

        return response()->json(['data' => ['starters' => $this->guard(fn () => $setup->previewStarters($storefront))]]);
    }

    public function applyStarters(Request $request, StorefrontVerticalSetupService $setup, string $id): JsonResponse
    {
        $this->denySelfService($request);
        $storefront = $this->ownedStorefront($id);

        return response()->json(['data' => ['starters' => $this->guard(fn () => $setup->applyStarters($storefront))]]);
    }

    private function guard(callable $callback): mixed
    {
        try {
            return $callback();
        } catch (DomainException $e) {
            abort(422, $e->getMessage());
        }
    }

    private function ownedStorefront(string $id): Storefront
    {
        $tenantId = app(TenantContext::class)->id();
        if ($tenantId === null) {
            throw new RuntimeException('لا سياق مستأجر نشط.');
        }

        $storefront = Storefront::query()->find($id);
        abort_if($storefront === null || $storefront->tenant_id !== $tenantId, 404, 'المتجر غير موجود.');

        return $storefront;
    }

    private function denySelfService(Request $request): void
    {
        if ($request->user()?->role === 'self_service') {
            abort(403, 'مساحة عمل التجارة غير متاحة لحساب الخدمة الذاتية.');
        }
    }
}
