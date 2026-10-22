<?php

namespace App\Http\Controllers\Api;

use App\Services\PaymentWebhookInbox;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * مستقبِل webhook مزوّد الدفع (PAY-H1-04). عام بلا مصادقة مستخدم: الهوية = مفتاح الاتصال + توقيع المزوّد (يتحقق منه المحوّل). لا يمرّ بـ`SetTenant`؛
 * المستأجر يُحدَّد من الاتصال داخل `PaymentWebhookInbox`. الرد بلا تفاصيل (حالة ثابتة فقط) كي لا يكشف وجود اتصال أو محاولة.
 */
class PaymentWebhookController extends ApiController
{
    public function receive(Request $request, string $provider, string $webhookKey, PaymentWebhookInbox $inbox): JsonResponse
    {
        $headers = [];
        foreach ($request->headers->all() as $name => $values) {
            $headers[strtolower((string) $name)] = (string) ($values[0] ?? '');
        }

        $result = $inbox->receive($provider, $webhookKey, (string) $request->getContent(), $headers);

        return response()->json(['status' => $result->status], $result->httpStatus);
    }
}
