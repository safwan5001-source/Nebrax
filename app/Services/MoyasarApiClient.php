<?php

namespace App\Services;

use App\Models\PaymentGateway;
use App\Support\MoyasarCredentialPolicy;
use App\Support\PaymentGatewayException;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Http;

/**
 * عميل Moyasar API (ADR-0005). طبقة نقل رقيقة فقط: Basic Auth بالمفتاح السري (اسم مستخدم وكلمة مرور فارغة)، مهل صارمة، وأخطاء نمطية.
 *
 *  • لا بيانات بطاقة هنا أبداً: لا مسار `payments` ولا `source`؛ الدفع يتم على صفحة Moyasar المستضافة.
 *  • POST (إنشاء الفاتورة) **بلا أي إعادة محاولة تلقائية** — لا مفتاح idempotency موثّق لإنشاء الفاتورة؛ التكرار يمنعه بحث الـmetadata في المحوّل.
 *    قراءات GET فقط تُعاد عند انقطاع الاتصال.
 *  • رسائل الاستثناء عامة بلا جسم استجابة ولا مفتاح ولا ترويسات، فلا تتسرب الأسرار عبر `report()`.
 *  • السياسة (`MoyasarCredentialPolicy`) تُفحص قبل كل استدعاء: مفتاح حي في Sandbox لا يغادر الخادم.
 */
final class MoyasarApiClient
{
    public function __construct(private readonly MoyasarCredentialPolicy $policy) {}

    /**
     * فواتير تحمل `metadata[awj_attempt_id]`. ترشيح المزوّد بالمفتاح فقط موثّق، لذا يصفّي المستدعي النتيجة محلياً بمطابقة القيمة.
     *
     * @return list<array<string, mixed>>
     */
    public function listInvoicesByAttempt(PaymentGateway $gateway, string $attemptId): array
    {
        $json = $this->send($gateway, 'GET', '/invoices', query: ['metadata[awj_attempt_id]' => $attemptId]);

        // شكل غلاف القائمة غير موثّق حرفياً في الصفحة العامة: يُقبل `invoices` أو `data` أو مصفوفة مباشرة (يُثبَّت في Sandbox).
        $items = $json['invoices'] ?? $json['data'] ?? (array_is_list($json) ? $json : []);

        return array_values(array_filter(is_array($items) ? $items : [], 'is_array'));
    }

    /**
     * @param  array<string, mixed>  $payload
     * @return array<string, mixed>
     */
    public function createInvoice(PaymentGateway $gateway, array $payload): array
    {
        return $this->send($gateway, 'POST', '/invoices', json: $payload);
    }

    /** @return array<string, mixed> */
    public function fetchInvoice(PaymentGateway $gateway, string $invoiceId): array
    {
        return $this->send($gateway, 'GET', '/invoices/'.rawurlencode($invoiceId));
    }

    /**
     * @param  array<string, string>  $query
     * @param  array<string, mixed>|null  $json
     * @return array<string, mixed>
     */
    private function send(PaymentGateway $gateway, string $method, string $path, array $query = [], ?array $json = null): array
    {
        $this->policy->assert((string) $gateway->environment, $gateway->publishable_key, $gateway->secret_key);
        $secret = (string) $gateway->secret_key;
        if (trim($secret) === '') {
            throw new PaymentGatewayException('moyasar.credentials_missing', 'المفتاح السري لـMoyasar غير مُدخل.');
        }

        $config = (array) config('payment_providers.moyasar');
        $request = Http::baseUrl((string) $config['base_url'])
            ->withBasicAuth($secret, '')
            ->acceptJson()
            ->asJson()
            ->timeout((int) $config['timeout_seconds'])
            ->connectTimeout((int) $config['connect_timeout_seconds']);

        if ($method === 'GET') {
            $request = $request->retry(
                (int) $config['read_retries'] + 1,
                (int) $config['retry_sleep_ms'],
                fn ($exception) => $exception instanceof ConnectionException,
                throw: false,
            );
        }

        try {
            $response = $method === 'GET' ? $request->get($path, $query) : $request->post($path, $json ?? []);
        } catch (ConnectionException) {
            throw new PaymentGatewayException('moyasar.unavailable', 'تعذّر الاتصال بـMoyasar.');
        }

        return $this->decode($response);
    }

    /** @return array<string, mixed> */
    private function decode(Response $response): array
    {
        $status = $response->status();

        if ($status === 401 || $status === 403) {
            throw new PaymentGatewayException('moyasar.unauthorized', 'رفض Moyasar بيانات الاعتماد.');
        }
        if ($status === 429) {
            throw new PaymentGatewayException('moyasar.rate_limited', 'تجاوز حد الطلبات لدى Moyasar.');
        }
        if ($status >= 500) {
            throw new PaymentGatewayException('moyasar.unavailable', 'خدمة Moyasar غير متاحة حالياً.');
        }
        if ($status === 404) {
            throw new PaymentGatewayException('moyasar.not_found', 'المورد غير موجود لدى Moyasar.');
        }
        if ($status < 200 || $status >= 300) {
            throw new PaymentGatewayException('moyasar.rejected', "رفض Moyasar الطلب (HTTP {$status}).");
        }

        $json = $response->json();
        if (! is_array($json)) {
            throw new PaymentGatewayException('moyasar.malformed_response', 'استجابة Moyasar غير مفهومة.');
        }

        return $json;
    }
}
