<?php

namespace App\Services;

use App\Models\FuelShift;
use App\Models\FuelShiftSettlementJob;
use App\Models\FuelStation;

/**
 * نموذج قراءة التسويات المعلقة (P1-3b-1، D-S3) — **قراءة فقط**، رموز ثابتة غير مالية وأعمار فقط. لا نقطة نهاية ولا واجهة بعد (P1-3b-4)؛ هذه الخدمة تثبّت منطق العمر ومستوى التنبيه بالاختبار.
 *
 * يشمل أيضاً **الورديات المغلقة بلا مهمة** (فشل تسجيلها عند الإغلاق) ضمن نافذة رجوع محدودة (`fuel_stations.settlement_job.unregistered_lookback_days`، 14 يوماً) والبوابة مفتوحة والسياسة `post_on_close`،
 * بحالة `unregistered`؛ فلا تختفي وردية بسبب فشل تسجيل صامت، وتبلغ عتبتي التنبيه/التصعيد كغيرها. (إعادة التسجيل اليدوية = P1-3b-3.)
 *
 * العمر = الآن − لحظة **إغلاق الوردية** (لا لحظة تسجيل المهمة): تأخر المهمة نفسه يُحسب على صاحب الوردية المعلقة. المستويات: `none` < `alert` (بعد عتبة التنبيه، افتراضي ساعتان)
 * < `escalated` (بعد عتبة التصعيد، افتراضي 24 ساعة). العتبتان من إعدادات المحطة (`shift_settlement_alert_after_hours` / `shift_settlement_escalation_after_hours`).
 */
class FuelShiftSettlementPendingService
{
    public const LEVEL_NONE = 'none';
    public const LEVEL_ALERT = 'alert';
    public const LEVEL_ESCALATED = 'escalated';

    /** وردية مغلقة لا مهمة لها (فشل التسجيل عند الإغلاق فابتُلع الاستثناء كي لا يفشل الإغلاق): تبقى ظاهرة هنا ولا تُنسى. */
    public const STATUS_UNREGISTERED = 'unregistered';
    public const REASON_NOT_REGISTERED = 'FUEL_SETTLEMENT_JOB_NOT_REGISTERED';

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
        $rows = array_merge($rows, $this->unregistered($now));
        usort($rows, fn (array $a, array $b) => $b['age_minutes'] <=> $a['age_minutes']);

        return $rows;
    }

    /**
     * ورديات مغلقة/معتمدة بلا أي مهمة (لا مهمة منتهية ولا غير منتهية) ضمن نافذة الرجوع. البوابة مغلقة ⇒ لا استعلام ولا صفوف.
     *
     * @return list<array<string,mixed>>
     */
    private function unregistered(\Illuminate\Support\Carbon $now): array
    {
        if (! FuelShiftSettlementReadiness::enabled()) {
            return [];
        }
        $days = max(1, (int) config('fuel_stations.settlement_job.unregistered_lookback_days', 14));
        $shifts = FuelShift::query()
            ->whereIn('status', [FuelShift::STATUS_CLOSED, FuelShift::STATUS_APPROVED])
            ->whereNotNull('closed_at')->where('closed_at', '>=', $now->copy()->subDays($days))
            ->whereNotIn('id', FuelShiftSettlementJob::query()->select('fuel_shift_id'))
            ->get();
        if ($shifts->isEmpty()) {
            return [];
        }
        $stations = FuelStation::query()->whereIn('id', $shifts->pluck('fuel_station_id'))->get()->keyBy('id');

        $rows = [];
        foreach ($shifts as $shift) {
            $station = $stations->get($shift->fuel_station_id);
            if ($station === null) {
                continue;
            }
            $policy = $this->settings->forStation($station);
            if (($policy['shift_settlement_mode'] ?? null) !== FuelShiftSettlementReadiness::MODE_POST_ON_CLOSE) {
                continue;
            }
            $age = max(0, (int) $shift->closed_at->diffInMinutes($now, false));
            $rows[] = [
                'job_id' => null,
                'fuel_shift_id' => $shift->id,
                'fuel_station_id' => $shift->fuel_station_id,
                'status' => self::STATUS_UNREGISTERED,
                'outcome' => null,
                'reasons' => [self::REASON_NOT_REGISTERED],
                'attempts' => 0,
                'last_error_code' => null,
                'closed_at' => $shift->closed_at->toIso8601String(),
                'age_minutes' => $age,
                'alert_level' => self::levelFor($age, (int) $policy['shift_settlement_alert_after_hours'], (int) $policy['shift_settlement_escalation_after_hours']),
            ];
        }

        return $rows;
    }
}
