<?php

namespace App\Services\Commerce;

use App\Models\CommerceOrder;
use App\Models\CommercePaymentIntent;
use App\Models\StorefrontDomain;

/**
 * عنوان عودة المتصفح بعد صفحة الدفع المستضافة (PAY-H4-04a). يُبنى **كله من الخادم**: مضيف نطاق المتجر الموثَّق والنشط للطلب نفسه + مسار ثابت من
 * الإعداد. لا مدخل عميل فيه (لا مضيف ولا مسار ولا استعلام) فلا إعادة توجيه مفتوحة. العودة لا تُعدّ إثباتاً للدفع؛ صفحة العودة تسأل الخادم عن النتيجة
 * (`payment-status`) والخادم يسأل المزوّد. طلب بلا متجر ويب (جوّال) أو متجر بلا نطاق موثَّق ⇒ null (المزوّد يعرض صفحته الافتراضية).
 */
final class CommerceReturnUrlResolver
{
    public function forPayableKey(string $payableKey): ?string
    {
        $prefix = CommercePaymentIntent::PAYABLE_TYPE.':';
        if (! str_starts_with($payableKey, $prefix)) {
            return null;
        }

        $intent = CommercePaymentIntent::query()->find(substr($payableKey, strlen($prefix)));
        $order = $intent === null ? null : CommerceOrder::query()->find($intent->commerce_order_id);
        if ($order === null || $order->storefront_id === null) {
            return null;
        }

        $domain = StorefrontDomain::query()
            ->where('storefront_id', $order->storefront_id)
            ->where('is_active', true)
            ->where('verification_status', StorefrontDomain::VERIFICATION_VERIFIED)
            ->orderByDesc('is_primary')
            ->orderBy('created_at')
            ->first();
        if ($domain === null) {
            return null;
        }

        $path = (string) config('payments.commerce_online_checkout.return_path', '/checkout/payment-return');

        return 'https://'.$domain->hostname.'/'.ltrim($path, '/');
    }
}
