<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\ProvisionStorefrontRequest;
use App\Services\Commerce\CommerceWorkspaceStorefrontsService;
use App\Services\Commerce\StorefrontHostnameConflictException;
use App\Services\Commerce\StorefrontProvisioningService;
use App\Support\StorefrontBaseDomainMisconfiguredException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use RuntimeException;

/**
 * COM-WS-2 — قراءة إدارية محدودة لمساحة عمل التجارة.
 * COM-STORE-PROVISION-1 — تزويد أول متجر إلكتروني صريح.
 *
 * يسرد/يزوّد متاجر الويب للمستأجر الحالي فقط. لا يستقبل معرّف مستأجر/متجر/نطاق
 * من العميل، ولا يستدعي الحسم العام بالنطاق. `index` لا يفرض
 * `commerce.storefront` (قراءة فقط — كانت مساحة العمل ستُغلق على الجميع
 * أيام `coming_soon`؛ سلوكها الحالي محفوظ بلا تغيير بعد ترقية النضج). `store`
 * فعلٌ كتابي حقيقي يُنشئ بنية تحتية تجارية حقيقية، فيُحرَس بصلاحية RBAC
 * مخصَّصة (`commerce.manage`) بدل الاكتفاء باستثناء الخدمة الذاتية وحده.
 */
class CommerceWorkspaceStorefrontsController extends ApiController
{
    public function index(Request $request, CommerceWorkspaceStorefrontsService $storefronts): JsonResponse
    {
        if ($request->user()?->role === 'self_service') {
            abort(403, 'مساحة عمل التجارة غير متاحة لحساب الخدمة الذاتية.');
        }

        return response()->json([
            'data' => [
                'stores' => $storefronts->listForCurrentTenant(),
            ],
        ]);
    }

    public function store(
        ProvisionStorefrontRequest $request,
        StorefrontProvisioningService $provisioning,
    ): JsonResponse {
        if ($request->user()?->role === 'self_service') {
            abort(403, 'مساحة عمل التجارة غير متاحة لحساب الخدمة الذاتية.');
        }

        try {
            $result = $provisioning->provisionFirstStorefrontForCurrentTenant($request->validated('name'));
        } catch (StorefrontBaseDomainMisconfiguredException $e) {
            abort(500, $e->getMessage());
        } catch (StorefrontHostnameConflictException $e) {
            abort(409, $e->getMessage());
        } catch (RuntimeException $e) {
            abort(422, $e->getMessage());
        }

        $created = $result['created'];
        unset($result['created']);

        return response()->json([
            'data' => ['store' => $result],
            'meta' => ['created' => $created],
        ], $created ? 201 : 200);
    }
}
