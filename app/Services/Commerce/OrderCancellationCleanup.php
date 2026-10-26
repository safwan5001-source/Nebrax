<?php

namespace App\Services\Commerce;

use App\Models\CommercePaymentIntent;
use App\Models\PaymentAttempt;
use App\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;

/**
 * ADR-28 §4 / P-2…P-3 — تنظيف محاولات الدفع بعد إلغاء نية الدفع (أو طلب لاحقاً): إغلاق المحاولات الجارية لدى المزوّد.
 *
 * **يجري دائماً بعد الالتزام النهائي** للمعاملة التي ألغت النية (`DB::afterCommit`) وبلا أي قفل قاعدة بيانات معلَّق: يتصل بالمزوّد ويقفل
 * صفّ المحاولة (`PaymentOrchestrator::cancel`) — وهذان محظوران تحت أقفال النية/الطلب/الحجز (يعكسان ترتيب الترحيل ويحبسان أقفالاً على شبكة).
 * لا يرمي أبداً: فشله (مهلة/انهيار المزوّد) لا يمسّ الطلب ولا النية (حالتهما ملتزمة ومتسقة)؛ تعيد المحاولة `runPending()` المجدولة
 * (`commerce:close-cancelled-order-attempts`) بلا جدول جديد — العمل المتبقي مشتقّ من الحالة نفسها: نية إلكترونية `cancelled` ولها محاولة ما زالت نشطة.
 *
 * idempotent: محاولة لم تعد نشطة لا تُمسّ؛ لا أثر على الدفعات الملتقَطة ولا على المخزون ولا على الأستاذ (التقاط لاحق ⇒ `late_capture` D-15).
 */
final class OrderCancellationCleanup
{
    /** نافذة المطابِق: لا يلمس إلغاءً أحدث من هذا (التنظيف الفوري لم يُنتظر بعد) ولا أقدم من {@see self::WINDOW_DAYS}. */
    public const GRACE_MINUTES = 2;

    public const WINDOW_DAYS = 7;

    public function __construct(
        private readonly CommerceOnlinePaymentService $online,
        private readonly TenantContext $tenant,
    ) {}

    /**
     * ينظّف محاولات نية واحدة. للنوايا غير الإلكترونية لا شيء. لا يرمي.
     *
     * @return array{closed: int, skipped: int, failed: int, remaining: int}
     */
    public function run(CommercePaymentIntent $intent): array
    {
        if (! $intent->isOnline()) {
            return ['closed' => 0, 'skipped' => 0, 'failed' => 0, 'remaining' => 0];
        }

        return $this->online->closeActiveAttemptsIsolated($intent);
    }

    /**
     * شبكة الأمان: نوايا إلكترونية ملغاة (ضمن النافذة) ما زالت لها محاولات نشطة. كل نية معزولة وتحت سياق مستأجرها.
     *
     * @return array{processed: int, cleaned: int, still_pending: int, failed: int}
     */
    public function runPending(int $limit = 100): array
    {
        $summary = ['processed' => 0, 'cleaned' => 0, 'still_pending' => 0, 'failed' => 0];
        // فقط الحالات التي يستطيع `PaymentOrchestrator::cancel` إغلاقها: `authorized` يُرفض دوماً بـ`cannot_cancel` فبقاؤه في الدفعة كان
        // سيُبقي النية نفسها في كل تشغيلة ويجوّع الأحدث (مراجعة Codex P2). التقاط/استرداد المصرَّح به مسار آخر لا يخصّ هذا المطابِق.
        $active = "'".implode("','", PaymentAttempt::CLOSABLE_STATUSES)."'";
        $key = CommercePaymentIntent::PAYABLE_TYPE.':';

        $due = CommercePaymentIntent::query()->withoutGlobalScopes()
            ->where('status', CommercePaymentIntent::STATUS_CANCELLED)
            ->where('method', CommercePaymentIntent::METHOD_ONLINE)
            ->whereNotNull('cancelled_at')
            ->where('cancelled_at', '<=', now('UTC')->subMinutes(self::GRACE_MINUTES))
            ->where('cancelled_at', '>=', now('UTC')->subDays(self::WINDOW_DAYS))
            ->whereExists(function ($q) use ($active, $key): void {
                $q->select(DB::raw('1'))->from('payment_attempts as a')
                    ->whereColumn('a.tenant_id', 'commerce_payment_intents.tenant_id')
                    ->whereRaw("a.payable_key = ? || CAST(commerce_payment_intents.id AS TEXT)", [$key])
                    ->whereRaw("a.capture_status IN ({$active})");
            })
            // ترتيب عشوائي لا «الأقدم أولاً»: نية لا تُغلَق (مزوّد معطّل مثلاً) لا تحجز مقدّمة الدفعة فتجوّع غيرها؛ كل نية مؤهَّلة
            // تُبلَغ احتمالاً عبر التشغيلات المتكرّرة دون حالة محفوظة أو جدول جديد.
            ->inRandomOrder()
            ->limit($limit)
            ->get();

        $previous = $this->tenant->id();
        foreach ($due as $intent) {
            $summary['processed']++;
            $this->tenant->set((string) $intent->tenant_id);
            try {
                $result = $this->run($intent);
                $result['remaining'] > 0 || $result['failed'] > 0 ? $summary['still_pending']++ : $summary['cleaned']++;
            } catch (\Throwable $e) {
                $summary['failed']++;
                report($e);
            } finally {
                $previous === null ? $this->tenant->forget() : $this->tenant->set($previous);
            }
        }

        return $summary;
    }
}
