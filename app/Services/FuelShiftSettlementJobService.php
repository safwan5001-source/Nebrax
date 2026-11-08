<?php

namespace App\Services;

use App\Models\FuelShift;
use App\Models\FuelShiftSettlementJob;
use App\Models\User;
use App\Support\SettlementJobOutcome;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * مهام تسوية الورديات المسجَّلة (P1-3b-1، D-S2) — **الكاتب الوحيد لجدول المهام**. بنية موثوقة بلا أي أثر محاسبي: لا فاتورة ولا سند ولا قيد ولا حركة مخزون.
 *
 * ═══ الضمانات ═══
 *  - **مهمة واحدة لكل وردية**: قيد فريد `(tenant_id, fuel_shift_id)` + التسجيل idempotent (التزامن يلتقط خطأ التفرّد داخل savepoint ويعيد الموجودة).
 *  - **لا ازدواج تنفيذ**: المطالبة بالمهمة مقارنة-وتبديل ذرّي (`UPDATE … WHERE` بنفس شرط الاستحقاق ثم فحص الصفوف المتأثرة) — تعمل على PostgreSQL وSQLite بلا `SKIP LOCKED`.
 *  - **استرداد بعد سقوط العامل/انقطاع الاتصال**: الإيجار `locked_until`؛ انتهاؤه يتيح لعاملٍ آخر استرداد المهمة، ويُحسب الاسترداد تنفيذاً فاشلاً (`attempts`+1) حتى سقف `max_attempts`
 *    ثم `failed` ظاهرة بسببها `worker_lost`. لا مهمة تعلق `running` إلى الأبد.
 *  - **الحاجز (fencing)**: كل إنهاء/إعادة مشروط برمز العامل الحامل للإيجار؛ عاملٌ متأخر (زومبي) استُرد منه الإيجار لا يستطيع كتابة نتيجته (يعيد `false`).
 *  - التقييم المحجوب/بانتظار المحرك **ليس فشلاً**: يعود إلى الطابور بعد `recheck_minutes` ولا يستهلك ميزانية الإعادة.
 *
 * الخدمة لا تفتح معاملات طويلة ولا تقفل أي صف مجمّع/مِرساة؛ كل عملياتها تحديثات صفّية قصيرة على جدول المهام نفسه.
 */
class FuelShiftSettlementJobService
{
    public function __construct(private FuelShiftSettlementReadiness $readiness) {}

    // ═══════════ التسجيل ═══════════

    /**
     * يسجّل مهمة لوردية **أُغلقت للتو** حين تكون البوابة مفتوحة وسياسة المحطة `post_on_close`. البوابة مغلقة ⇒ لا استعلام ولا كتابة (الإغلاق مطابق لما قبل).
     * يُستدعى داخل معاملة الإغلاق نفسها (ذرّياً معها)، لكنه **لا يُفشل الإغلاق أبداً**: أي استثناء يُسجَّل ويُبتلع داخل savepoint، وتبقى الوردية معلّمة «بلا مهمة» (تظهر في القائمة المشتقة).
     */
    public function enqueueIfEnabled(FuelShift $shift, ?User $actor = null): ?FuelShiftSettlementJob
    {
        if (! FuelShiftSettlementReadiness::enabled()) {
            return null;
        }
        try {
            return DB::transaction(function () use ($shift, $actor) {
                $station = \App\Models\FuelStation::findOrFail($shift->fuel_station_id);
                if ($this->readiness->mode($station) !== FuelShiftSettlementReadiness::MODE_POST_ON_CLOSE) {
                    return null;
                }

                return $this->enqueue($shift, $actor);
            });
        } catch (Throwable $e) {
            report($e);

            return null;
        }
    }

    /** idempotent: وردية مغلقة ⇒ مهمة واحدة (الموجودة تُعاد كما هي بلا أي تغيير). */
    public function enqueue(FuelShift $shift, ?User $actor = null): FuelShiftSettlementJob
    {
        if (! $shift->isClosed()) {
            throw new \RuntimeException('FUEL_SETTLEMENT_JOB_SHIFT_NOT_CLOSED: لا تُسجَّل مهمة تسوية إلا لوردية مغلقة.');
        }
        $existing = FuelShiftSettlementJob::query()->withoutGlobalScopes()
            ->where('tenant_id', $shift->tenant_id)->where('fuel_shift_id', $shift->id)->first();
        if ($existing !== null) {
            return $existing;
        }

        try {
            // savepoint: خطأ التفرّد داخل معاملة PostgreSQL يُفسدها إن لم يُحصَر.
            return DB::transaction(function () use ($shift, $actor) {
                $job = new FuelShiftSettlementJob();
                $job->forceFill([
                    'tenant_id' => $shift->tenant_id,
                    'branch_id' => $shift->branch_id,
                    'fuel_station_id' => $shift->fuel_station_id,
                    'fuel_shift_id' => $shift->id,
                    'status' => FuelShiftSettlementJob::STATUS_QUEUED,
                    'attempts' => 0,
                    'max_attempts' => (int) config('fuel_stations.settlement_job.max_attempts', 5),
                    'checks' => 0,
                    'next_attempt_at' => now(),
                    'triggered_by_user_id' => $actor?->id,
                ])->save();

                return $job;
            });
        } catch (QueryException $e) {
            $winner = FuelShiftSettlementJob::query()->withoutGlobalScopes()
                ->where('tenant_id', $shift->tenant_id)->where('fuel_shift_id', $shift->id)->first();
            if ($winner === null) {
                throw $e;
            }

            return $winner;
        }
    }

    // ═══════════ المطالبة (lease) ═══════════

    /**
     * يطالب بأقدم مهمة مستحقة (طابور جاهز، أو `running` انتهى إيجارها = عامل سقط). عبر المستأجرين (يُستدعى من المُجدوِل بلا سياق).
     * يعيد null إن لم توجد مهمة أو خسر كل المرشّحين سباق المطالبة لعامل آخر.
     */
    public function claimNext(string $workerToken, ?int $leaseSeconds = null): ?FuelShiftSettlementJob
    {
        $lease = $leaseSeconds ?? (int) config('fuel_stations.settlement_job.lease_seconds', 300);
        $candidates = $this->dueQuery(now())->orderBy('next_attempt_at')->orderBy('id')->limit(20)->pluck('id');

        foreach ($candidates as $id) {
            $job = $this->tryClaim((string) $id, $workerToken, $lease);
            if ($job !== null) {
                return $job;
            }
        }

        return null;
    }

    /** @return \Illuminate\Database\Eloquent\Builder<FuelShiftSettlementJob> */
    private function dueQuery(\Illuminate\Support\Carbon $now)
    {
        return FuelShiftSettlementJob::query()->withoutGlobalScopes()->where(function ($q) use ($now) {
            $q->where(fn ($w) => $w->where('status', FuelShiftSettlementJob::STATUS_QUEUED)->where('next_attempt_at', '<=', $now))
                ->orWhere(fn ($w) => $w->where('status', FuelShiftSettlementJob::STATUS_RUNNING)->where('locked_until', '<', $now));
        });
    }

    private function tryClaim(string $id, string $workerToken, int $leaseSeconds): ?FuelShiftSettlementJob
    {
        $now = now();
        // مقارنة-وتبديل: الصف يُطالَب به إن بقي مستحقاً لحظة التحديث؛ الخاسر يرى 0 صفوف. استرداد مهمة سقط عاملها يزيد `attempts` (تنفيذ فاشل).
        $claimed = $this->dueQuery($now)->where('id', $id)->update([
            'status' => FuelShiftSettlementJob::STATUS_RUNNING,
            'locked_by' => $workerToken,
            'locked_until' => $now->copy()->addSeconds($leaseSeconds),
            'attempts' => DB::raw("attempts + CASE WHEN status = 'running' THEN 1 ELSE 0 END"),
            'updated_at' => $now,
        ]);
        if ($claimed !== 1) {
            return null;
        }

        $job = $this->find($id);
        if ($job->attempts >= $job->max_attempts) {
            // ميزانية الإعادة استُنفدت باسترداد متكرر لمهمة تسقط عواملها: تصير فاشلة ظاهرة لا تُعاد تلقائياً.
            $this->fail($job, $workerToken, 'worker_lost');

            return null;
        }

        return $job;
    }

    public function find(string $id): FuelShiftSettlementJob
    {
        return FuelShiftSettlementJob::query()->withoutGlobalScopes()->findOrFail($id);
    }

    // ═══════════ الإنهاء (كلها مشروطة بحاجز الإيجار) ═══════════

    /** يسجّل نتيجة تقييم اكتمل. المحجوب/بانتظار المحرك يعود للطابور بعد التأخير؛ `disabled` ينهي المهمة. false = فقد العامل إيجاره (يتجاهل نتيجته). */
    public function record(FuelShiftSettlementJob $job, string $workerToken, SettlementJobOutcome $outcome): bool
    {
        $now = now();
        $base = [
            'last_outcome' => $outcome->outcome,
            'blocked_reasons' => $outcome->reasons === [] ? null : json_encode($outcome->reasons, JSON_UNESCAPED_UNICODE),
            'checks' => DB::raw('checks + 1'),
            'last_checked_at' => $now,
            'locked_by' => null,
            'locked_until' => null,
            'updated_at' => $now,
        ];
        $fields = $outcome->isFinal()
            ? $base + ['status' => FuelShiftSettlementJob::STATUS_COMPLETED, 'completed_at' => $now]
            : $base + ['status' => FuelShiftSettlementJob::STATUS_QUEUED, 'next_attempt_at' => $now->copy()->addMinutes((int) config('fuel_stations.settlement_job.recheck_minutes', 10))];

        return $this->fenced($job, $workerToken)->update($fields) === 1;
    }

    /**
     * يسجّل خطأ تنفيذ (انقطاع اتصال، جمود، مهلة قفل، استثناء غير متوقع): `attempts`+1 وتراجع أُسّي، فإن استُنفدت الميزانية صارت `failed`. false = فقد العامل إيجاره.
     * الرمز ثابت ولا يُخزَّن نص الاستثناء (قد يحمل قيماً).
     */
    public function recordError(FuelShiftSettlementJob $job, string $workerToken, string $errorCode): bool
    {
        $fresh = $this->find($job->id);
        if ($fresh->attempts + 1 >= $fresh->max_attempts) {
            return $this->fail($fresh, $workerToken, $errorCode, increment: true);
        }
        $now = now();
        $backoff = (array) config('fuel_stations.settlement_job.backoff_minutes', [1, 5, 15, 60, 360]);
        $minutes = (int) ($backoff[min($fresh->attempts, count($backoff) - 1)] ?? 1);

        return $this->fenced($fresh, $workerToken)->update([
            'status' => FuelShiftSettlementJob::STATUS_QUEUED,
            'attempts' => DB::raw('attempts + 1'),
            'last_error_code' => $errorCode,
            'last_error_at' => $now,
            'next_attempt_at' => $now->copy()->addMinutes(max(1, $minutes)),
            'locked_by' => null,
            'locked_until' => null,
            'updated_at' => $now,
        ]) === 1;
    }

    private function fail(FuelShiftSettlementJob $job, string $workerToken, string $errorCode, bool $increment = false): bool
    {
        $now = now();
        $fields = [
            'status' => FuelShiftSettlementJob::STATUS_FAILED,
            'last_error_code' => $errorCode,
            'last_error_at' => $now,
            'completed_at' => $now,
            'locked_by' => null,
            'locked_until' => null,
            'updated_at' => $now,
        ];
        if ($increment) {
            $fields['attempts'] = DB::raw('attempts + 1');
        }

        return $this->fenced($job, $workerToken)->update($fields) === 1;
    }

    /** الحاجز: التحديث لا يمرّ إلا لحامل الإيجار الحالي لمهمة ما زالت `running`. */
    private function fenced(FuelShiftSettlementJob $job, string $workerToken)
    {
        return FuelShiftSettlementJob::query()->withoutGlobalScopes()
            ->where('id', $job->id)->where('status', FuelShiftSettlementJob::STATUS_RUNNING)->where('locked_by', $workerToken);
    }
}
