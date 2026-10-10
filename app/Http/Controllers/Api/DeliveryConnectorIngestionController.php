<?php

namespace App\Http\Controllers\Api;

use App\Services\DeliveryHub\DeliveryConnectorIngestionService;
use App\Support\WebhookSignature;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * إدخال موقَّع بلا جلسة مستخدم. لا يُسجَّل السر ولا ترويسة التوقيع.
 */
class DeliveryConnectorIngestionController extends ApiController
{
    public function __construct(private readonly DeliveryConnectorIngestionService $ingestion) {}

    public function store(Request $request, string $connector): JsonResponse
    {
        $result = $this->ingestion->ingest(
            $connector,
            $request->getContent(),
            $request->header(WebhookSignature::HEADER_SIGNATURE),
        );

        return response()->json($result['body'], $result['status']);
    }
}
