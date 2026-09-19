<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\AddStorefrontCustomDomainRequest;
use App\Http\Requests\ProvisionStorefrontRequest;
use App\Http\Requests\UpdateStorefrontIdentityRequest;
use App\Services\Commerce\CommerceWorkspaceStorefrontsService;
use App\Services\Commerce\CustomDomainNotReadyForPrimaryException;
use App\Services\Commerce\DomainNotActivatedForEdgeException;
use App\Services\Commerce\DomainNotDisconnectableException;
use App\Services\Commerce\DomainNotEligibleForEdgeException;
use App\Services\Commerce\DomainNotEligibleForPrimaryException;
use App\Services\Commerce\DomainNotEligibleForVerificationException;
use App\Services\Commerce\ManagedNamespaceHostnameException;
use App\Services\Commerce\StorefrontDomainVerificationService;
use App\Services\Commerce\StorefrontEdgeConflictException;
use App\Services\Commerce\StorefrontEdgeMisconfiguredException;
use App\Services\Commerce\StorefrontEdgeUnavailableException;
use App\Services\Commerce\StorefrontHostnameConflictException;
use App\Services\Commerce\StorefrontProvisioningService;
use App\Support\Dns\DnsOperationalException;
use App\Support\InvalidHostnameException;
use App\Support\StorefrontBaseDomainMisconfiguredException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use RuntimeException;

/**
 * COM-WS-2 — قراءة إدارية محدودة لمساحة عمل التجارة.
 * COM-STORE-PROVISION-1 — تزويد أول متجر إلكتروني صريح.
 * STORE-ADMIN-ADOPT-1B-1 — تصحيح/تعريب هوية متجر قائم (`name`/`default_locale`).
 * STORE-ADMIN-ADOPT-1B-2 — رؤية نطاقات متجر قائم (قراءة فقط).
 * STORE-ADMIN-ADOPT-1B-3A — إضافة نطاق مخصَّص + تحقّق DNS TXT.
 * STORE-ADMIN-ADOPT-1B-3B — Make Primary الآمن + فصل نطاق مخصَّص.
 * CUSTOM-DOMAIN-EDGE-1 — Activate/Refresh Edge (Railway) بلا فتح Make Primary.
 * STORE-ADMIN-LIFECYCLE-1 — تفعيل/إيقاف خدمة المتجر المستضاف (`Storefront.is_active`).
 *
 * يسرد/يزوّد/يحدّث متاجر الويب للمستأجر الحالي فقط. لا يستقبل معرّف مستأجر/متجر/نطاق
 * من العميل، ولا يستدعي الحسم العام بالنطاق. `index` لا يفرض
 * `commerce.storefront` (قراءة فقط — كانت مساحة العمل ستُغلق على الجميع
 * أيام `coming_soon`؛ سلوكها الحالي محفوظ بلا تغيير بعد ترقية النضج). `store`
 * و`update` و`activate`/`deactivate` أفعال كتابية حقيقية، فيُحرَسان بصلاحية RBAC مخصَّصة
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
     * STORE-ADMIN-LIFECYCLE-1 — تفعيل متجر قائم. يكتب `Storefront.is_active`
     * فقط. `{id}` محدِّد صفّ — الملكية عبر `TenantContext`. 404 غير كاشف.
     */
    public function activate(
        Request $request,
        CommerceWorkspaceStorefrontsService $storefronts,
        string $id,
    ): JsonResponse {
        if ($request->user()?->role === 'self_service') {
            abort(403, 'مساحة عمل التجارة غير متاحة لحساب الخدمة الذاتية.');
        }

        $result = $storefronts->activateForCurrentTenant($id);

        if ($result === null) {
            abort(404, 'المتجر غير موجود.');
        }

        return response()->json([
            'data' => ['store' => $result],
        ]);
    }

    /**
     * STORE-ADMIN-LIFECYCLE-1 — إيقاف متجر قائم. يكتب `Storefront.is_active`
     * فقط. لا يمسّ القناة ولا النطاق ولا الحافة. 404 غير كاشف.
     */
    public function deactivate(
        Request $request,
        CommerceWorkspaceStorefrontsService $storefronts,
        string $id,
    ): JsonResponse {
        if ($request->user()?->role === 'self_service') {
            abort(403, 'مساحة عمل التجارة غير متاحة لحساب الخدمة الذاتية.');
        }

        $result = $storefronts->deactivateForCurrentTenant($id);

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

    /**
     * STORE-ADMIN-ADOPT-1B-3A — إضافة نطاق مخصَّص (`hostname` فقط) لمتجر
     * قائم يخصّ المستأجر الحالي، وبدء تحقّق DNS TXT (`pending` دوماً — لا
     * `verified` عند الإنشاء). نفس صلاحية 1B-1/1B-2 (`commerce.manage`):
     * فعلٌ كتابي حقيقي على بنية تحتية تجارية حسّاسة (سلطة Host عامة).
     */
    public function storeDomain(
        AddStorefrontCustomDomainRequest $request,
        CommerceWorkspaceStorefrontsService $storefronts,
        string $id,
    ): JsonResponse {
        if ($request->user()?->role === 'self_service') {
            abort(403, 'مساحة عمل التجارة غير متاحة لحساب الخدمة الذاتية.');
        }

        try {
            $domain = $storefronts->addCustomDomainForCurrentTenant($id, $request->validated('hostname'));
        } catch (InvalidHostnameException|ManagedNamespaceHostnameException $e) {
            abort(422, $e->getMessage());
        } catch (StorefrontHostnameConflictException $e) {
            abort(409, $e->getMessage());
        } catch (StorefrontBaseDomainMisconfiguredException $e) {
            abort(500, $e->getMessage());
        }

        if ($domain === null) {
            abort(404, 'المتجر غير موجود.');
        }

        return response()->json([
            'data' => ['domain' => $domain],
        ], 201);
    }

    /**
     * STORE-ADMIN-ADOPT-1B-3A — تشغيل تحقّق DNS TXT فعلي لنطاق مخصَّص قائم.
     * لا تُقبل نتيجة تحقّق من العميل مهما كانت — الخادم وحده يستعلم DNS
     * ويقرّر. نفس صلاحية `storeDomain` (`commerce.manage`).
     */
    public function verifyDomain(
        Request $request,
        CommerceWorkspaceStorefrontsService $storefronts,
        StorefrontDomainVerificationService $verifier,
        string $id,
        string $domainId,
    ): JsonResponse {
        if ($request->user()?->role === 'self_service') {
            abort(403, 'مساحة عمل التجارة غير متاحة لحساب الخدمة الذاتية.');
        }

        try {
            $domain = $storefronts->verifyCustomDomainForCurrentTenant($id, $domainId, $verifier);
        } catch (DomainNotEligibleForVerificationException $e) {
            abort(422, $e->getMessage());
        } catch (DnsOperationalException $e) {
            abort(503, $e->getMessage());
        }

        if ($domain === null) {
            abort(404, 'النطاق غير موجود.');
        }

        return response()->json([
            'data' => ['domain' => $domain],
        ]);
    }

    /**
     * STORE-ADMIN-ADOPT-1B-3B / CUSTOM-DOMAIN-EDGE-3 — جعل نطاق مؤهل هو الأساسي.
     * لا يقبل أي حقل سلطة من العميل. نطاق مخصَّص يُعاد سؤال جاهزية المزوّد الحيّة.
     */
    public function makePrimaryDomain(
        Request $request,
        CommerceWorkspaceStorefrontsService $storefronts,
        string $id,
        string $domainId,
    ): JsonResponse {
        if ($request->user()?->role === 'self_service') {
            abort(403, 'مساحة عمل التجارة غير متاحة لحساب الخدمة الذاتية.');
        }

        try {
            $domain = $storefronts->makePrimaryForCurrentTenant($id, $domainId);
        } catch (CustomDomainNotReadyForPrimaryException|DomainNotEligibleForPrimaryException $e) {
            abort(422, $e->getMessage());
        } catch (StorefrontEdgeMisconfiguredException|StorefrontEdgeUnavailableException $e) {
            abort(503, $e->getMessage());
        }

        if ($domain === null) {
            abort(404, 'النطاق غير موجود.');
        }

        return response()->json([
            'data' => ['domain' => $domain],
        ]);
    }

    /**
     * STORE-ADMIN-ADOPT-1B-3B / CUSTOM-DOMAIN-EDGE-3 — فصل نطاق مخصَّص غير أساسي.
     * إطلاق المزوّد أولاً. نطاق AWJ مُدار أو أساسي حالي يُرفض قبل أي استدعاء مزوّد.
     */
    public function destroyDomain(
        Request $request,
        CommerceWorkspaceStorefrontsService $storefronts,
        string $id,
        string $domainId,
    ): JsonResponse {
        if ($request->user()?->role === 'self_service') {
            abort(403, 'مساحة عمل التجارة غير متاحة لحساب الخدمة الذاتية.');
        }

        try {
            $disconnected = $storefronts->disconnectCustomDomainForCurrentTenant($id, $domainId);
        } catch (DomainNotDisconnectableException $e) {
            abort(422, $e->getMessage());
        } catch (StorefrontEdgeMisconfiguredException|StorefrontEdgeUnavailableException $e) {
            abort(503, $e->getMessage());
        }

        if ($disconnected === null) {
            abort(404, 'النطاق غير موجود.');
        }

        return response()->json([
            'data' => ['disconnected' => true],
        ]);
    }

    /**
     * CUSTOM-DOMAIN-EDGE-1 — تسجيل نطاق مخصَّص موثَّق لدى Railway.
     * الجسم فارغ. العميل لا يمرّر معرّف مزوّد ولا حالة Edge ولا تعليمات DNS.
     */
    public function activateEdge(
        Request $request,
        CommerceWorkspaceStorefrontsService $storefronts,
        string $id,
        string $domainId,
    ): JsonResponse {
        if ($request->user()?->role === 'self_service') {
            abort(403, 'مساحة عمل التجارة غير متاحة لحساب الخدمة الذاتية.');
        }

        try {
            $domain = $storefronts->activateEdgeForCurrentTenant($id, $domainId);
        } catch (DomainNotEligibleForEdgeException $e) {
            abort(422, $e->getMessage());
        } catch (StorefrontEdgeConflictException $e) {
            abort(409, $e->getMessage());
        } catch (StorefrontEdgeMisconfiguredException|StorefrontEdgeUnavailableException $e) {
            abort(503, $e->getMessage());
        }

        if ($domain === null) {
            abort(404, 'النطاق غير موجود.');
        }

        return response()->json([
            'data' => ['domain' => $domain],
        ]);
    }

    /**
     * CUSTOM-DOMAIN-EDGE-1 — مزامنة حالة Railway إلى الصف.
     * الجسم فارغ. لا يُعلَن جاهزاً إلا بشهادة Railway السلطوية.
     */
    public function refreshEdge(
        Request $request,
        CommerceWorkspaceStorefrontsService $storefronts,
        string $id,
        string $domainId,
    ): JsonResponse {
        if ($request->user()?->role === 'self_service') {
            abort(403, 'مساحة عمل التجارة غير متاحة لحساب الخدمة الذاتية.');
        }

        try {
            $domain = $storefronts->refreshEdgeForCurrentTenant($id, $domainId);
        } catch (DomainNotEligibleForEdgeException|DomainNotActivatedForEdgeException $e) {
            abort(422, $e->getMessage());
        } catch (StorefrontEdgeConflictException $e) {
            abort(409, $e->getMessage());
        } catch (StorefrontEdgeMisconfiguredException|StorefrontEdgeUnavailableException $e) {
            abort(503, $e->getMessage());
        }

        if ($domain === null) {
            abort(404, 'النطاق غير موجود.');
        }

        return response()->json([
            'data' => ['domain' => $domain],
        ]);
    }
}
