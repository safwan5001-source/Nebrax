<?php

namespace App\Support;

use App\Models\CommerceOrder;
use RuntimeException;

/**
 * ═══════════════════════════════════════════════════════════════
 *  Commerce API V1 — PR-5: signed guest-order reference
 * ═══════════════════════════════════════════════════════════════
 *
 *  Context: `docs/plans/commerce/PUBLIC_MOBILE_COMMERCE_API_V1_ARCHITECTURE.md`
 *  §3.2 ("CommerceOrder result/status"): guest orders are resolvable **only**
 *  via a signed order reference returned at checkout completion — never via
 *  a bare order id (UUID randomness is not a security boundary).
 *
 *  Construction: `{version}.{hex-hmac}` where the HMAC-SHA256 input binds
 *  `tenant_id | sales_channel_id | order_id` and the key is the application
 *  key (`config('app.key')`) — the same standard Laravel/AWJ key material
 *  `WebhookSignature`-style HMAC already relies on. No new crypto, no new
 *  dependency, no DB column (stateless by design — see PR-5 implementation
 *  report, "Schema / Migrations: NONE").
 *
 *  Properties:
 *   - server-generated only (issued inside the checkout-complete response);
 *   - tamper-resistant: any flipped bit fails HMAC comparison;
 *   - bound to exactly one CommerceOrder of one tenant of one channel —
 *     a reference for order A can never authorize order B, and an order
 *     outside the caller's tenant/channel context is rejected by the
 *     controller's scoped lookup before verification even runs;
 *   - deterministic: idempotent replay of checkout completion re-issues the
 *     byte-identical reference for the same order (no new ownership identity
 *     on replay);
 *   - fail-closed: missing / malformed / wrong-version / invalid-signature
 *     all fail verification identically.
 *
 *  Transport: the dedicated `X-Order-Reference` request header — mirroring
 *  the `X-Cart-Token` convention this API already established (PR-3/PR-4).
 *  It is never a query parameter, so `PublicApiRequestAudit` (which audits
 *  only its SAFE_QUERY_KEYS allow-list and no headers) can never log it.
 */
final class CommerceOrderReference
{
    public const HEADER = 'X-Order-Reference';

    private const VERSION = 'v1';

    /** يصدر مرجعاً موقَّعاً للطلب — يُستدعى من استجابة إتمام Checkout فقط. */
    public static function issue(CommerceOrder $order): string
    {
        return self::VERSION.'.'.self::signature($order);
    }

    /**
     * يتحقق أن المرجع يخص هذا الطلب تحديداً. أي خلل (غياب/تشوّه/توقيع لا
     * يطابق) يعيد false — لا تفاصيل عن سبب الرفض تتسرب للمستدعي.
     */
    public static function verify(CommerceOrder $order, ?string $reference): bool
    {
        if (! is_string($reference) || $reference === '') {
            return false;
        }

        $parts = explode('.', $reference, 2);
        if (count($parts) !== 2 || $parts[0] !== self::VERSION) {
            return false;
        }

        if (preg_match('/\A[0-9a-f]{64}\z/', $parts[1]) !== 1) {
            return false;
        }

        return hash_equals(self::signature($order), $parts[1]);
    }

    private static function signature(CommerceOrder $order): string
    {
        return hash_hmac(
            'sha256',
            implode('|', [self::VERSION, $order->tenant_id, $order->sales_channel_id, $order->id]),
            self::key(),
        );
    }

    private static function key(): string
    {
        $key = (string) config('app.key');
        if (str_starts_with($key, 'base64:')) {
            $key = (string) base64_decode(substr($key, 7), true);
        }
        if ($key === '') {
            throw new RuntimeException('APP_KEY غير مضبوط — لا يمكن توقيع مراجع الطلبات.');
        }

        return $key;
    }
}
