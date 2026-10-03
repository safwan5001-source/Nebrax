<?php

namespace App\Http\Controllers\Api;

use App\Support\Commerce\CatalogCollectionReader;
use App\Support\PublicApiResponse;
use App\Tenancy\StorefrontContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** FLOWERS-H2 / ADR-14 §2.3 — المجموعات العامة لقناة الجوال (commerce/v1)، قراءة فقط. */
class CommerceCatalogCollectionController extends PublicApiController
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
