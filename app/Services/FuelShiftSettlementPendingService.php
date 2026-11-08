<?php

namespace App\Services;

use App\Models\FuelShift;
use App\Models\FuelShiftSettlementJob;
use App\Models\FuelStation;

/**
 * نموذج قراءة التسويات المعلقة (P1-3b-1، D-S3) — **قراءة فقط**، رموز ثابتة غير مالية وأعمار فقط. لا نقطة نهاية ولا واجهة بعد (P1-3b-4)؛ هذه الخدمة تثبّت منطق العمر ومستوى التنبيه بالاختبار.
 *
 * العمر = الآن − لحظة **إغلاق الوردية** (لا لحظة تسجيل المهمة): تأخر المهمة نفسه يُحسب على صاحب الوردية المعلقة. المستويات: `none` < `alert` (بعد عتبة التنبيه، افتراضي ساعتان)
 * < `escalated` (بعد عتبة التصعيد، افتراضي 24 ساعة). العتبتان من إعدادات المحطة (`shift_settlement_alert_after_hours` / `shift_settlement_escalation_after_hours`).
 */
class FuelShiftSettlementPendingService
{
    public const LEVEL_NONE = 'none';
    public const LEVEL_ALERT = 'alert';
    public const LEVEL_ESCALATED = 'escalated';

    public function __construct(private FuelStationSettingsService $settings) {}

    /**
     * مستوى التنبيه لعمر بالدقائق. التصعيد لا يسبق التنبيه أبداً: عتبة تصعيد ≤ عتبة التنبيه (تعارض إعدادات وراثية) تُعامَل مساويةً لها.
     */
    public static function levelFor(int $ageMinutes, int $alertHours, int $escalationHours): string
    {
        $alert = max(1, $alertHours) * 60;
        $escalation = max($alert, max(1, $escalationHours) * 60);

        return match (true) {
            $ageMinutes >= $escalation => self::LEVEL_ESCALATED,
            $ageMinutes >= $alert => self::LEVEL_ALERT,
            default => self::LEVEL_NONE,
        };
    }

    /**
     * التسويات غير المنتهية للمستأجر الحالي (قيد الطابور/قيد التنفيذ/فاشلة)، الأقدم أولاً.
     *
     * @return list<array<string,mixed>>
     */
    public function list(): array
    {
        $jobs = FuelShiftSettlementJob::query()
            ->whereIn('status', [FuelShiftSettlementJob::STATUS_QUEUED, FuelShiftSettlementJob::STATUS_RUNNING, FuelShiftSettlementJob::STATUS_FAILED])
            ->get();
        $shifts = FuelShift::query()->whereIn('id', $jobs->pluck('fuel_shift_id'))->get()->keyBy('id');
        $stations = FuelStation::query()->whereIn('id', $jobs->pluck('fuel_station_id'))->get()->keyBy('id');
        $now = now();

        $rows = [];
        foreach ($jobs as $job) {
            $shift = $shifts->get($job->fuel_shift_id);
            $station = $stations->get($job->fuel_station_id);
            if ($shift === null || $station === null || $shift->closed_at === null) {
                continue;
            }
            $policy = $this->settings->forStation($station);
            $age = max(0, (int) $shift->closed_at->diffInMinutes($now, false));
            $rows[] = [
                'job_id' => $job->id,
                'fuel_shift_id' => $job->fuel_shift_id,
                'fuel_station_id' => $job->fuel_station_id,
                'status' => $job->status,
                'outcome' => $job->last_outcome,
                'reasons' => $job->blocked_reasons ?? [],
                'attempts' => $job->attempts,
                'last_error_code' => $job->last_error_code,
                'closed_at' => $shift->closed_at->toIso8601String(),
                'age_minutes' => $age,
                'alert_level' => $job->status === FuelShiftSettlementJob::STATUS_FAILED
                    ? self::LEVEL_ESCALATED // فشل نهائي لا ينتظر العتبة
                    : self::levelFor($age, (int) $policy['shift_settlement_alert_after_hours'], (int) $policy['shift_settlement_escalation_after_hours']),
            ];
        }
        usort($rows, fn (array $a, array $b) => $b['age_minutes'] <=> $a['age_minutes']);

        return $rows;
    }
}
