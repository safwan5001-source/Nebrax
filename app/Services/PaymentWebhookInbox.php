<?php

namespace App\Services;

use App\Models\PaymentAttempt;
use App\Models\PaymentGateway;
use App\Models\PaymentProviderEvent;
use App\Models\Tenant;
use App\Support\InvalidPaymentWebhookException;
use App\Support\PaymentOrchestrationException;
use App\Support\PaymentRawWebhook;
use App\Support\PaymentWebhookResult;
use App\Tenancy\TenantContext;
use App\Tenancy\TenantScope;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;

/**
 * ═══════════════════════════════════════════════════════════════
 *  صندوق أحداث المزوّد — PAY-H1-04 (استقبال متحقَّق + استعلام موثوق؛ لا ترحيل ولا قيد)
 * ═══════════════════════════════════════════════════════════════
 *  المسار `POST /api/payment-webhooks/{provider}/{webhookKey}` عام بلا مصادقة مستخدم: الهوية = مفتاح الاتصال (غير سرّي) + **توقيع المزوّد**.
 *  1) الحجم ≤ 64KB (413) قبل أي عمل.  2) الاتصال من (المزوّد، المفتاح) مفعّلاً أو موقوفاً لمستأجر نشط وإلا 404 دون كشف السبب.
 *  3) المحوّل يتحقق من التوقيع (أسرار الاتصال الحالية ثم السابقة في نافذة السماح): خاطئ ⇒ 401 **بلا تخزين**؛ جسم غير مفهوم ⇒ 400.
 *  4) dedupe: `UNIQUE(gateway, provider_event_id)`؛ المكرر بالبصمة نفسها = replay (200 ويُعاد الإنجاز إن لم يكتمل)، وبجسم مختلف ⇒ 409.
 *  5) **لا تُطبَّق حالة من الجسم**: الحدث يطلق `PaymentOrchestrator::sync` (استعلام المزوّد = الحقيقة)، فتستوي الأحداث المتأخرة/خارج الترتيب
 *     (التطبيق رتيب). دفعة مجهولة ⇒ `unmatched`. تعذّر المزوّد ⇒ 503 فيعيد المزوّد المحاولة والحدث محفوظ `received`.
 *  ضابط التفعيل لا يحجب الاستقبال (ما التقطه المزوّد فعلاً يجب أن يُرصد). المستأجر يُحدَّد من الاتصال ويُعاد السياق بعد المعالجة.
 */
final class PaymentWebhookInbox
{
    public function __construct(
        private readonly PaymentGatewayAdapterRegistry $adapters,
        private readonly PaymentOrchestrator $orchestrator,
        private readonly TenantContext $tenant,
    ) {}

    /** @param array<string, string> $headers */
    public function receive(string $provider, string $webhookKey, string $body, array $headers): PaymentWebhookResult
    {
        if (strlen($body) > PaymentProviderEvent::MAX_BODY_BYTES) {
            return new PaymentWebhookResult(413, 'payload_too_large');
        }

        // مدخل عام: الاتصال يُحلّ بمفتاحه (فريد عالمياً) خارج نطاق المستأجر، ثم يُثبَّت سياق مستأجره لكل ما بعده.
        $gateway = PaymentGateway::query()->withoutGlobalScope(TenantScope::class)
            ->where('webhook_key', $webhookKey)->where('provider', $provider)->first();
        if ($gateway === null
            || ! in_array($gateway->status, [PaymentGateway::STATUS_ACTIVE, PaymentGateway::STATUS_SUSPENDED], true)
            || ! Tenant::query()->whereKey($gateway->tenant_id)->where('is_active', true)->exists()
            || ! $this->adapters->has($gateway->provider)) {
            return new PaymentWebhookResult(404, 'not_found');
        }

        $previous = $this->tenant->has() ? (string) $this->tenant->id() : null;
        $this->tenant->set((string) $gateway->tenant_id);
        try {
            return $this->handle($gateway, $body, $headers);
        } finally {
            $previous === null ? $this->tenant->forget() : $this->tenant->set($previous);
        }
    }

    /** @param array<string, string> $headers */
    private function handle(PaymentGateway $gateway, string $body, array $headers): PaymentWebhookResult
    {
        $gateway = PaymentGateway::query()->findOrFail($gateway->getKey());

        try {
            $verified = $this->adapters->for($gateway->provider)->verifyWebhook($gateway, new PaymentRawWebhook($body, $headers));
        } catch (InvalidPaymentWebhookException $e) {
            return $e->reason === 'malformed' ? new PaymentWebhookResult(400, 'malformed') : new PaymentWebhookResult(401, 'invalid_signature');
        }

        $hash = hash('sha256', $body);
        try {
            $event = DB::transaction(fn (): PaymentProviderEvent => PaymentProviderEvent::query()->create([
                'payment_gateway_id' => $gateway->getKey(),
                'provider' => $gateway->provider,
                'provider_event_id' => $verified->eventId,
                'event_type' => $verified->eventType !== null ? substr($verified->eventType, 0, 96) : null,
                'provider_payment_id' => $verified->providerPaymentId !== null ? substr($verified->providerPaymentId, 0, 191) : null,
                'body_hash' => $hash,
                'body' => $body,
            ]));
        } catch (QueryException $e) {
            if (! $this->isUniqueViolation($e)) {
                throw $e;
            }
            $existing = PaymentProviderEvent::query()->where('payment_gateway_id', $gateway->getKey())
                ->where('provider_event_id', $verified->eventId)->first();
            if ($existing === null) {
                throw $e;
            }
            if (! hash_equals($existing->body_hash, $hash)) {
                // نفس معرّف الحدث بجسم مختلف: لا يُستبدل المحفوظ ولا يُعالَج؛ يُرفض صراحةً (يُراجَع).
                return new PaymentWebhookResult(409, 'event_body_conflict');
            }
            if ($existing->status !== PaymentProviderEvent::STATUS_RECEIVED) {
                return new PaymentWebhookResult(200, 'duplicate');
            }
            $event = $existing; // لم يكتمل معالجته سابقاً (تعذّر المزوّد): إعادة المزوّد للمحاولة تُكمله
        }

        return $this->process($event);
    }

    private function process(PaymentProviderEvent $event): PaymentWebhookResult
    {
        $attempt = $event->provider_payment_id === null ? null : PaymentAttempt::query()
            ->where('payment_gateway_id', $event->payment_gateway_id)
            ->where('provider_payment_id', $event->provider_payment_id)->first();

        if ($attempt === null) {
            $this->finish($event, PaymentProviderEvent::STATUS_UNMATCHED, 'attempt_not_found', null);

            return new PaymentWebhookResult(200, 'unmatched');
        }

        try {
            $result = $this->orchestrator->sync($attempt);
        } catch (PaymentOrchestrationException $e) {
            // الحدث محفوظ `received`؛ المزوّد يعيد الإرسال والمطابِق يلتقط المحاولة.
            return new PaymentWebhookResult($e->reason === 'provider_unavailable' ? 503 : 200, $e->reason === 'provider_unavailable' ? 'provider_unavailable' : 'not_actionable');
        }

        $this->finish($event, PaymentProviderEvent::STATUS_PROCESSED, $result->applied ? 'applied' : (string) $result->ignoredReason, $attempt->getKey());

        return new PaymentWebhookResult(200, 'ok');
    }

    private function finish(PaymentProviderEvent $event, string $status, string $outcome, ?string $attemptId): void
    {
        $event->forceFill([
            'status' => $status,
            'outcome' => $outcome,
            'payment_attempt_id' => $attemptId,
            'processed_at' => now('UTC'),
        ])->save();
    }

    private function isUniqueViolation(QueryException $e): bool
    {
        $state = (string) $e->getCode();

        return $state === '23505' || ($state === '23000' && str_contains($e->getMessage(), 'UNIQUE'));
    }
}
