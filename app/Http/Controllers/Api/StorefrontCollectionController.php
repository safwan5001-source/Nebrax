<?php

namespace App\Http\Controllers\Api;

use App\Support\Commerce\CatalogCollectionReader;
use App\Support\PublicApiResponse;
use App\Tenancy\StorefrontContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * FLOWERS-H2 / ADR-14 §2.3 — المجموعات التسويقية العامة (store/v1)، قراءة مجهولة
 * فقط. أعضاء المجموعة تُقرأ عبر `GET products?collection=<slug>` فتمرّ بالمسار
 * الوحيد للسعر والتوفر وبوابة النشر.
 */
class StorefrontCollectionController extends PublicApiController
{
    public function index(Request $request, CatalogCollectionReader $reader): JsonResponse
    {
        $channelId = app(StorefrontContext::class)->salesChannelId();

        return new JsonResponse([
            'data' => $reader->forChannel($channelId),
            'meta' => ['request_id' => PublicApiResponse::requestId($request)],
        ]);
    }
}
