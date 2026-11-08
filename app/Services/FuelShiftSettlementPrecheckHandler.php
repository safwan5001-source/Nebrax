<?php

namespace App\Services;

use App\Models\FuelShift;
use App\Models\FuelShiftSettlementJob;
use App\Models\FuelStation;
use App\Support\SettlementJobHandler;
use App\Support\SettlementJobOutcome;
use RuntimeException;

/**
 * معالج مهمة التسوية الخامل (P1-3b-1): **قراءة فقط** — يقيّم الفحوص المسبقة لوردية مغلقة ويعيد سبب بقائها معلقة، ولا يكتب أي مستند.
 *
 *  - البوابة أو السياسة أُغلقت بعد التسجيل ⇒ `disabled` (تنتهي المهمة بلا أثر).
 *  - فحص مسبق فاشل ⇒ `blocked` برموز ثابتة (فترة مقفلة، عبور شهر، إقرار مفقود، قبوض غير موسومة، شروط جاهزية).
 *  - اجتاز كل المتاح ⇒ `awaiting_engine`: لا محرك ترحيل بعد، فتبقى معلقة (صادقة) بدل أن تبدو منتهية.
 *
 * لا يستدعي أي خدمة فواتير أو سندات أو قيود أو مخزون أو مبيعات وقود (يحرسه اختبار ساكن بأسماء الخدمات).
 */
class FuelShiftSettlementPrecheckHandler implements SettlementJobHandler
{
    public function __construct(
        private FuelShiftSettlementReadiness $readiness,
        private FuelShiftSettlementPreviewService $preview,
    ) {}

    public function handle(FuelShiftSettlementJob $job): SettlementJobOutcome
    {
        $shift = FuelShift::findOrFail($job->fuel_shift_id);
        $station = FuelStation::findOrFail($shift->fuel_station_id);

        if (! FuelShiftSettlementReadiness::enabled() || $this->readiness->mode($station) !== FuelShiftSettlementReadiness::MODE_POST_ON_CLOSE) {
            return SettlementJobOutcome::disabled();
        }
        // الوردية المعتمدة (closed → approved بقرار المشرف) تبقى وردية مغلقة تشغيلياً: اعتمادها قبل تشغيل المهمة لا يجوز أن يُفشلها.
        if (! $shift->isClosed() && ! $shift->isApproved()) {
            throw new RuntimeException('FUEL_SETTLEMENT_JOB_SHIFT_NOT_CLOSED: مهمة تسوية لوردية غير مغلقة.');
        }

        $reasons = $this->preview->closedShiftPrechecks($shift);

        return $reasons === [] ? SettlementJobOutcome::awaitingEngine() : SettlementJobOutcome::blocked($reasons);
    }
}
