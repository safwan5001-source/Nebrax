<?php

namespace App\Http\Middleware;

use App\Models\InvoicePaymentRequest;
use App\Models\Tenant;
use App\Support\PaymentLinkToken;
use App\Tenancy\TenantContext;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * يحسم رابط الدفع العام (PAY-H2-02e): الرمز → SHA-256 → طلب الدفع، ويقيم سياق مستأجر الطلب لمدة الطلب فقط ثم ينسخه. رمز غير مطابق للصيغة/مجهول/مستأجر
 * معطَّل ⇒ 404 موحّد بلا تمييز (لا كشف لوجود رابط). لا مصادقة مستخدم: الرمز نفسه هو القدرة، ولا يمنح إلا الدفع لفاتورة واحدة. رؤوس no-store وno-referrer.
 */
class ResolvePaymentLink
{
    public function __construct(private readonly TenantContext $tenant) {}

    public function handle(Request $request, Closure $next): Response
    {
        $token = (string) $request->route('token');
        $paymentRequest = PaymentLinkToken::wellFormed($token)
            ? InvoicePaymentRequest::query()->withoutGlobalScopes()->where('token_hash', PaymentLinkToken::hash($token))->first()
            : null;
        $active = $paymentRequest !== null && Tenant::query()->whereKey($paymentRequest->tenant_id)->where('is_active', true)->exists();
        if (! $active) {
            return $this->harden(response()->json(['error' => ['code' => 'link_not_found', 'message' => 'رابط الدفع غير صالح.']], 404));
        }

        $this->tenant->set((string) $paymentRequest->tenant_id);
        try {
            $request->attributes->set('payment_link_request_id', (string) $paymentRequest->getKey());

            return $this->harden($next($request));
        } finally {
            $this->tenant->forget();
        }
    }

    private function harden(Response $response): Response
    {
        $response->headers->set('Cache-Control', 'no-store, private');
        $response->headers->set('Referrer-Policy', 'no-referrer');
        $response->headers->set('X-Robots-Tag', 'noindex, nofollow');

        return $response;
    }
}
