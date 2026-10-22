<?php

namespace App\Services;

use App\Models\PaymentAttempt;
use App\Support\PaymentOrchestrationException;
use App\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * مطابِق محاولات الدفع المجدول — PAY-H1-04 (ADR-0004 §5: استعادة المتعثّر). **لا ترحيل ولا قيد**: يستعلم المزوّد (الحقيقة) ويطبّق رتيباً
 * عبر `PaymentOrchestrator::reconcile`.
 *
 * المرشَّح: محاولة جارية (created/pending_customer/authorized) تأخرت مطابقتها، أو غير ملتقطة لها صفحة دفع قائمة (لرصد التقاط/تفويض متأخر D-15).
 * **إيجار ذرّي** لكل محاولة (`UPDATE … WHERE lease IS NULL OR lease <= now`): مطابِقان متزامنان لا يعالجان محاولة واحدة، والإيجار ينتهي تلقائياً بعد
 * انهيار العامل. الفشل ⇒ تراجع أسّي (حتى ساعة) و`last_reconcile_error` برمز ثابت، فلا حلقة ضغط على مزوّد معطّل. يعمل بلا سياق مستأجر ويُثبّت سياق
 * كل محاولة أثناء معالجتها ثم يمسحه. لا يشترط ضابط التفعيل (ما التقطه المزوّد فعلاً يجب أن يُرصد).
 */
final class PaymentAttemptReconciler
{
    public const LEASE_SECONDS = 120;

    public const MAX_BACKOFF_MINUTES = 60;

    public function __construct(
        private readonly PaymentOrchestrator $orchestrator,
        private readonly TenantContext $tenant,
    ) {}

    /** @return array{claimed: int, applied: int, unchanged: int, failed: int} */
    public function run(int $limit = 100, int $minAgeMinutes = 5): array
    {
        $summary = ['claimed' => 0, 'applied' => 0, 'unchanged' => 0, 'failed' => 0];
        $now = now('UTC');
        $stale = $now->copy()->subMinutes($minAgeMinutes);

        $ids = PaymentAttempt::query()->withoutGlobalScopes()
            ->where(function ($q) use ($now) {
                $q->whereIn('capture_status', PaymentAttempt::ACTIVE_STATUSES)
                    ->orWhere(fn ($closed) => $closed->where('capture_status', '!=', PaymentAttempt::STATUS_CAPTURED)
                        ->whereNotNull('provider_payment_id')
                        ->where(fn ($e) => $e->whereNull('expires_at')->orWhere('expires_at', '>', $now)));
            })
            ->where('created_at', '<=', $stale)
            ->where(fn ($q) => $q->whereNull('last_synced_at')->orWhere('last_synced_at', '<=', $stale))
            ->where(fn ($q) => $q->whereNull('next_reconcile_at')->orWhere('next_reconcile_at', '<=', $now))
            ->where(fn ($q) => $q->whereNull('reconcile_lease_until')->orWhere('reconcile_lease_until', '<=', $now))
            ->orderBy('created_at')->limit($limit)->pluck('id');

        foreach ($ids as $id) {
            $claimed = DB::table('payment_attempts')->where('id', $id)
                ->where(fn ($q) => $q->whereNull('reconcile_lease_until')->orWhere('reconcile_lease_until', '<=', now('UTC')))
                ->update(['reconcile_lease_until' => now('UTC')->addSeconds(self::LEASE_SECONDS)]);
            if ($claimed !== 1) {
                continue; // سبقه مطابِق آخر
            }
            $summary['claimed']++;
            $outcome = $this->reconcileOne((string) $id);
            $summary[$outcome]++;
        }

        return $summary;
    }

    /** @return 'applied'|'unchanged'|'failed' */
    private function reconcileOne(string $id): string
    {
        $attempt = PaymentAttempt::query()->withoutGlobalScopes()->find($id);
        if ($attempt === null) {
            return 'failed';
        }

        $this->tenant->set((string) $attempt->tenant_id);
        try {
            $result = $this->orchestrator->reconcile($attempt);
            DB::table('payment_attempts')->where('id', $id)->update([
                'reconcile_lease_until' => null, 'next_reconcile_at' => null, 'reconcile_failures' => 0, 'last_reconcile_error' => null,
            ]);

            return $result->applied ? 'applied' : 'unchanged';
        } catch (Throwable $e) {
            $failures = (int) $attempt->reconcile_failures + 1;
            DB::table('payment_attempts')->where('id', $id)->update([
                'reconcile_lease_until' => null,
                'reconcile_failures' => $failures,
                'next_reconcile_at' => now('UTC')->addMinutes(min(self::MAX_BACKOFF_MINUTES, 2 ** min($failures, 6))),
                'last_reconcile_error' => $e instanceof PaymentOrchestrationException ? substr($e->reason, 0, 48) : 'unexpected_error',
            ]);
            if (! $e instanceof PaymentOrchestrationException) {
                report($e);
            }

            return 'failed';
        } finally {
            $this->tenant->forget();
        }
    }
}
