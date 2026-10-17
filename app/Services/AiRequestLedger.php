<?php

namespace App\Services;

use App\Models\AiRequest;
use App\Support\AiAssistantDenied;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;

/**
 * هوية طلب المزوّد ومحاولاته (AI-02A): فتح الطلب = (مطابقة مفتاح التكرار) + (حجز الميزانية) في معاملة
 * واحدة، ثم تسويته عبر `AiBudgetService::finalize`.
 *
 * مفتاح التكرار (`Idempotency-Key`) اختياري. لا يُخزَّن خاماً ولا الطلب نفسه: HMAC فقط.
 *   - طلب سابق مُسوّى بالمفتاح نفسه  → `duplicate_request` (لا تنفيذ ثانٍ ولا حجز؛ لا ردّ مخزَّن للإعادة)
 *   - قيد التنفيذ                     → `request_in_progress`
 *   - المفتاح نفسه ببصمة مختلفة       → `idempotency_key_reuse`
 *   - فشل سابق                        → إعادة محاولة صريحة: يُعاد الحجز وتزيد `attempt`، والاستهلاك تراكمي
 */
class AiRequestLedger
{
    public function __construct(private readonly AiBudgetService $budgets) {}

    /**
     * @param  array{billable:bool}  $profile
     * @throws AiAssistantDenied
     */
    public function open(
        string $tenantId,
        string $actorId,
        string $provider,
        string $model,
        array $profile,
        int $reserveTokens,
        int $reserveCostMicroUsd,
        ?string $idempotencyKey,
        string $fingerprint,
        string $feature = 'assistant',
    ): AiRequest {
        // تجاوز السقف قد يكون سببه حجز مهجور: يُسوّى **خارج** معاملة الحجز (كي لا يُتراجَع عنه عند
        // الرفض النهائي) ثم تُعاد المحاولة مرة واحدة فقط.
        try {
            return $this->openOnce($tenantId, $actorId, $provider, $model, $profile, $reserveTokens, $reserveCostMicroUsd, $idempotencyKey, $fingerprint, $feature);
        } catch (AiAssistantDenied $denied) {
            if (! AiBudgetService::isExceeded($denied) || $this->budgets->reapStale() === 0) {
                throw $denied;
            }

            return $this->openOnce($tenantId, $actorId, $provider, $model, $profile, $reserveTokens, $reserveCostMicroUsd, $idempotencyKey, $fingerprint, $feature);
        }
    }

    /** @param array{billable:bool} $profile */
    private function openOnce(
        string $tenantId,
        string $actorId,
        string $provider,
        string $model,
        array $profile,
        int $reserveTokens,
        int $reserveCostMicroUsd,
        ?string $idempotencyKey,
        string $fingerprint,
        string $feature,
    ): AiRequest {
        $hash = $idempotencyKey === null ? null : $this->hmac($tenantId . "\n" . $idempotencyKey);
        $period = $this->budgets->period();
        $billable = $profile['billable'];

        try {
            return DB::transaction(function () use ($tenantId, $actorId, $provider, $model, $billable, $hash, $fingerprint, $period, $reserveTokens, $reserveCostMicroUsd, $feature): AiRequest {
                $existing = $hash === null ? null : AiRequest::query()->where('idempotency_hash', $hash)->lockForUpdate()->first();

                if ($existing !== null) {
                    if (! hash_equals((string) $existing->request_fingerprint, $fingerprint)) {
                        throw AiAssistantDenied::for('idempotency_key_reuse');
                    }
                    if ($existing->status === AiRequest::STATUS_SETTLED) {
                        throw $this->duplicate('duplicate_request', $existing);
                    }
                    if ($existing->status === AiRequest::STATUS_RESERVED) {
                        throw $this->duplicate('request_in_progress', $existing);
                    }
                }

                if ($billable) {
                    $this->budgets->reserve($tenantId, $period, $reserveTokens, $reserveCostMicroUsd);
                }

                $attributes = [
                    'status' => AiRequest::STATUS_RESERVED,
                    'period' => $period,
                    'billable' => $billable,
                    'provider' => $provider,
                    'model' => $model,
                    'reserved_tokens' => $billable ? $reserveTokens : 0,
                    'reserved_cost_micro_usd' => $billable ? $reserveCostMicroUsd : 0,
                    'error_code' => null,
                    'started_at' => now(),
                ];

                if ($existing !== null) {
                    // إعادة محاولة بعد فشل: الصف نفسه، محاولة جديدة، استهلاك تراكمي.
                    $existing->forceFill($attributes + ['attempt' => $existing->attempt + 1])->save();

                    return $existing;
                }

                return AiRequest::query()->create($attributes + [
                    'tenant_id' => $tenantId,
                    'actor_id' => $actorId,
                    'feature' => $feature,
                    'idempotency_hash' => $hash,
                    'request_fingerprint' => $fingerprint,
                    'attempt' => 1,
                ]);
            });
        } catch (UniqueConstraintViolationException) {
            // سباق على المفتاح نفسه: الآخر سبقنا وهو قيد التنفيذ.
            throw AiAssistantDenied::for('request_in_progress');
        }
    }

    /** @param array{input_tokens:int, output_tokens:int, cost_micro_usd:int} $usage */
    public function complete(AiRequest $request, array $usage): bool
    {
        return $this->budgets->finalize($request->id, AiRequest::STATUS_SETTLED, $usage, null);
    }

    /** @param array{input_tokens:int, output_tokens:int, cost_micro_usd:int}|null $usage ما أبلغ به المزوّد إن وُجد. */
    public function fail(AiRequest $request, ?array $usage, string $errorCode): bool
    {
        return $this->budgets->finalize($request->id, AiRequest::STATUS_FAILED, $usage, $errorCode);
    }

    public function hmac(string $value): string
    {
        return hash_hmac('sha256', $value, (string) config('app.key'));
    }

    /** الرفض يحمل هوية الطلب الأصلي كي يعرف العميل أيّ طلب يقصد. */
    private function duplicate(string $reason, AiRequest $existing): AiAssistantDenied
    {
        $denied = AiAssistantDenied::for($reason);
        $denied->requestId = $existing->id;

        return $denied;
    }
}
