<?php

namespace App\Http\Controllers\Api;

use App\Services\Commerce\CommerceWorkspaceStorefrontsService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * COM-WS-2 — قراءة إدارية محدودة لمساحة عمل التجارة.
 *
 * يسرد متاجر الويب للمستأجر الحالي فقط. لا يستقبل معرّف مستأجر/متجر/نطاق
 * من العميل، ولا يستدعي الحسم العام بالنطاق، ولا يفرض
 * `commerce.storefront` (coming_soon كان سيُغلق المساحة على الجميع).
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
}
