<?php

namespace App\Console\Commands;

use App\Models\Payment;
use App\Models\PaymentAttempt;
use App\Models\PaymentAttemptPosting;
use App\Models\PaymentGateway;
use App\Models\PaymentProviderEvent;
use App\Models\PaymentRefund;
use App\Models\Tenant;
use App\Services\PaymentGatewayAdapterRegistry;
use App\Tenancy\TenantContext;
use Illuminate\Console\Command;
use Illuminate\Support\Str;
use Throwable;

/**
 * يجمع **دليل تحقق Sandbox** لمحاولة دفع واحدة (EXT-01 — «دفعة Sandbox حقيقية مسجّلة: معرّف، حدث موقّع، استعلام fetch»).
 *
 * قراءة فقط ولا يغيّر شيئاً: لا ترحيل ولا مطابقة ولا كتابة. يرفض كل اتصال **غير Sandbox** (لا Live إطلاقاً). الاستعلام الحي من المزوّد (`--fetch`)
 * اختياري صريح؛ ولا يطبع المخرج أي سر أو جسم حدث أو مفتاح — معرّفات وحالات ومبالغ وهللات فقط، ليُرفق كما هو في تقرير التحقق.
 */
class PaymentSandboxEvidenceCommand extends Command
{
    protected $signature = 'payments:sandbox-evidence {attempt : معرّف محاولة الدفع} {--tenant= : slug المستأجر (إلزامي)} {--fetch : استعلام حي من مزوّد Sandbox ومقارنته بالمحلي}';

    protected $description = 'دليل تحقق Sandbox لمحاولة دفع (قراءة فقط، بلا أسرار، يرفض Live)';

    public function handle(TenantContext $tenants, PaymentGatewayAdapterRegistry $adapters): int
    {
        $slug = (string) $this->option('tenant');
        $tenant = $slug === '' ? null : Tenant::query()->where('slug', $slug)->first();
        if ($tenant === null) {
            $this->error('tenant_required: مرّر --tenant بـslug مستأجر صحيح.');

            return self::INVALID;
        }
        $tenants->set($tenant->id);

        $attemptId = (string) $this->argument('attempt');
        $attempt = Str::isUuid($attemptId) ? PaymentAttempt::query()->find($attemptId) : null;
        if ($attempt === null) {
            $this->error('attempt_not_found');

            return self::FAILURE;
        }
        $gateway = PaymentGateway::query()->find($attempt->payment_gateway_id);
        if ($gateway === null || $gateway->environment !== PaymentGateway::ENVIRONMENT_SANDBOX || $attempt->environment !== PaymentGateway::ENVIRONMENT_SANDBOX) {
            $this->error('sandbox_only: هذا الأمر لا يعمل إلا على اتصال ومحاولة Sandbox.');

            return self::FAILURE;
        }

        $events = PaymentProviderEvent::query()
            ->where(fn ($q) => $q->where('payment_attempt_id', $attempt->id)->when($attempt->provider_payment_id, fn ($inner, $id) => $inner->orWhere('provider_payment_id', $id)))
            ->orderBy('received_at')->get()
            ->map(fn (PaymentProviderEvent $e) => [
                'provider_event_id' => $e->provider_event_id, 'event_type' => $e->event_type, 'status' => $e->status,
                'outcome' => $e->outcome, 'received_at' => $e->received_at?->toIso8601String(),
            ])->values()->all();   // الأحداث لا تُخزَّن إلا بعد التحقق من التوقيع (H1-04) ⇒ وجودها = حدث موقَّع مقبول

        $postings = PaymentAttemptPosting::query()->where('payment_attempt_id', $attempt->id)->orderBy('role')->get();
        $payments = Payment::query()->whereIn('id', $postings->pluck('payment_id'))->get()->keyBy('id');
        $paymentRows = $postings->map(fn (PaymentAttemptPosting $p) => [
            'role' => $p->role, 'amount_minor' => (int) $p->amount_minor, 'payment_id' => $p->payment_id,
            'number' => $payments[$p->payment_id]->number ?? null, 'status' => $payments[$p->payment_id]->status ?? null,
            'journal_entry_id' => $payments[$p->payment_id]->journal_entry_id ?? null,
        ])->values()->all();
        $refunds = PaymentRefund::query()->where('payment_attempt_id', $attempt->id)->orderBy('created_at')->get()
            ->map(fn (PaymentRefund $r) => ['number' => $r->number, 'status' => $r->status, 'amount_minor' => (int) $r->amount_minor, 'posting_status' => $r->posting_status, 'provider_refund_ref' => $r->provider_refund_ref])->values()->all();

        $fetch = null;
        if ($this->option('fetch')) {
            $fetch = $this->liveFetch($adapters, $gateway, $attempt);
        }

        $evidence = [
            'generated_at' => now('UTC')->toIso8601String(),
            'gateway' => [
                'id' => $gateway->id, 'provider' => $gateway->provider, 'environment' => $gateway->environment, 'status' => $gateway->status,
                'verified_at' => $gateway->verified_at?->toIso8601String(), 'credential_version' => (int) $gateway->credential_version,
            ],
            'attempt' => [
                'id' => $attempt->id, 'provider_payment_id' => $attempt->provider_payment_id, 'capture_status' => $attempt->capture_status,
                'posting_status' => $attempt->posting_status, 'amount_minor' => (int) $attempt->amount_minor, 'captured_minor' => (int) $attempt->captured_minor,
                'refunded_minor' => (int) $attempt->refunded_minor, 'currency' => $attempt->currency,
            ],
            'events' => $events,
            'payments' => $paymentRows,
            'refunds' => $refunds,
            'fetch' => $fetch,
            'checks' => [
                'payment_recorded' => $attempt->provider_payment_id !== null && $attempt->capture_status === PaymentAttempt::STATUS_CAPTURED,
                'signed_webhook_event_received' => $events !== [],
                'fetch_matches_local' => $fetch === null ? null : ($fetch['matches'] ?? false),
                'posted_to_ledger' => $paymentRows !== [] && collect($paymentRows)->every(fn (array $p) => $p['status'] === 'posted' && $p['journal_entry_id'] !== null),
            ],
        ];
        $this->line(json_encode($evidence, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));

        return self::SUCCESS;
    }

    /** @return array<string, mixed> */
    private function liveFetch(PaymentGatewayAdapterRegistry $adapters, PaymentGateway $gateway, PaymentAttempt $attempt): array
    {
        if ($attempt->provider_payment_id === null) {
            return ['performed' => false, 'reason' => 'no_provider_payment_id'];
        }
        try {
            $snapshot = $adapters->for($attempt->provider)->fetchPayment($gateway, $attempt->provider_payment_id);
        } catch (Throwable $e) {
            return ['performed' => true, 'error' => class_basename($e)];   // لا نص الخطأ (قد يحمل بيانات المزوّد)
        }

        return [
            'performed' => true,
            'provider_status' => $snapshot->status, 'amount_minor' => $snapshot->amountMinor, 'captured_minor' => $snapshot->capturedMinor,
            'refunded_minor' => $snapshot->refundedMinor, 'currency' => $snapshot->currency,
            'matches' => $snapshot->status === $attempt->capture_status && $snapshot->amountMinor === (int) $attempt->amount_minor
                && $snapshot->capturedMinor === (int) $attempt->captured_minor && $snapshot->currency === $attempt->currency,
        ];
    }
}
