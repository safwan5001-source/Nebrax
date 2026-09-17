<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\ProvisionStorefrontRequest;
use App\Http\Requests\UpdateStorefrontIdentityRequest;
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
 * STORE-ADMIN-ADOPT-1B-1 — تصحيح/تعريب هوية متجر قائم (`name`/`default_locale`).
 * STORE-ADMIN-ADOPT-1B-2 — رؤية نطاقات متجر قائم (قراءة فقط).
 *
 * يسرد/يزوّد/يحدّث متاجر الويب للمستأجر الحالي فقط. لا يستقبل معرّف مستأجر/متجر/نطاق
 * من العميل، ولا يستدعي الحسم العام بالنطاق. `index` لا يفرض
 * `commerce.storefront` (قراءة فقط — كانت مساحة العمل ستُغلق على الجميع
 * أيام `coming_soon`؛ سلوكها الحالي محفوظ بلا تغيير بعد ترقية النضج). `store`
 * و`update` فعلان كتابيان حقيقيان، فيُحرَسان بصلاحية RBAC مخصَّصة
 * (`commerce.manage`) بدل الاكتفاء باستثناء الخدمة الذاتية وحده.
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

    /**
     * STORE-ADMIN-ADOPT-1B-1 — تحديث `name`/`default_locale` لمتجر قائم.
     * `{id}` يحدّد أي صفّ فقط — الملكية تُحسَم حصراً عبر `TenantContext` في
     * الخدمة. متجرٌ غير موجود أو يخصّ مستأجراً آخر يُرجع 404 دائماً، لا 403،
     * فلا يتسرّب وجوده.
     */
    public function update(
        UpdateStorefrontIdentityRequest $request,
        CommerceWorkspaceStorefrontsService $storefronts,
        string $id,
    ): JsonResponse {
        if ($request->user()?->role === 'self_service') {
            abort(403, 'مساحة عمل التجارة غير متاحة لحساب الخدمة الذاتية.');
        }

        $result = $storefronts->updateIdentityForCurrentTenant($id, $request->normalizedAttributes());

        if ($result === null) {
            abort(404, 'المتجر غير موجود.');
        }

        return response()->json([
            'data' => ['store' => $result],
        ]);
    }

    /**
     * STORE-ADMIN-ADOPT-1B-2 — قائمة نطاقات متجر قائم (قراءة فقط). `{id}`
     * يحدّد أي صفّ فقط — الملكية تُحسَم حصراً عبر `TenantContext` في
     * الخدمة. متجرٌ غير موجود أو يخصّ مستأجراً آخر يُرجع 404 دائماً، لا 403،
     * فلا يتسرّب وجوده. لا فعل كتابي هنا على الإطلاق.
     */
    public function domains(
        Request $request,
        CommerceWorkspaceStorefrontsService $storefronts,
        string $id,
    ): JsonResponse {
        if ($request->user()?->role === 'self_service') {
            abort(403, 'مساحة عمل التجارة غير متاحة لحساب الخدمة الذاتية.');
        }

        $domains = $storefronts->listDomainsForCurrentTenant($id);

        if ($domains === null) {
            abort(404, 'المتجر غير موجود.');
        }

        return response()->json([
            'data' => ['domains' => $domains],
        ]);
    }
}
