<?php

namespace App\Services;

use App\Models\FuelShift;
use App\Models\FuelShiftSettlementJob;
use App\Models\FuelStation;
use App\Models\User;
use App\Support\SettlementJobHandler;
use App\Support\SettlementJobOutcome;
use App\Support\SettlementPostingResult;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * معالج مهمة التسوية بالمحرك (P1-3b-2d): يحلّ محل المعالج الخامل **فقط** حين تتحقق شروط النشر الثلاثة (انظر `FuelShiftSettlementJobRunner`)، ويستدعي `FuelShiftSettlementPostingService::post`.
 *
 *  - **الفاعل = من أغلق الوردية** (`triggered_by_user_id` ثم `closed_by`) إن كان نشطاً من المؤسسة نفسها؛ وإلا حجب `FUEL_SETTLEMENT_ACTOR_UNAVAILABLE` (لا مستخدم نظامي مُخترَع، ولا يُرحَّل باسم غيره).
 *  - **إنهاء ذرّي (D-E1)**: الترحيل وتسجيل اكتمال المهمة في معاملة واحدة؛ حاجز الإيجار **آخر** خطوة قبل الالتزام (قفل صف المهمة أخيراً فلا يعاكس ترتيب أقفال الإغلاق/التسوية).
 *    مهمة فقدت إيجارها (زومبي) ⇒ استثناء ⇒ تراجع كامل لما كتبه، ولا يكتب شيئاً.
 *  - سقوط العامل بعد الالتزام وقبل علمه به: المهمة تُستردّ فيعيد المحرك النتيجة الأولى (`replayed`) بلا أثر ثم تنتهي — لا ازدواج.
 *  - حجب متوقع ⇒ `blocked` برموز المحرك ثابتة وتعود المهمة للطابور كما في المعالج الخامل.
 */
class FuelShiftSettlementEngineHandler implements SettlementJobHandler
{
    public function __construct(
        private FuelShiftSettlementReadiness $readiness,
        private FuelShiftSettlementPostingService $engine,
        private FuelShiftSettlementJobService $jobs,
    ) {}

    public function handle(FuelShiftSettlementJob $job): SettlementJobOutcome
    {
        $shift = FuelShift::findOrFail($job->fuel_shift_id);
        $station = FuelStation::findOrFail($shift->fuel_station_id);

        if (! FuelShiftSettlementReadiness::enabled() || $this->readiness->mode($station) !== FuelShiftSettlementReadiness::MODE_POST_ON_CLOSE) {
            return SettlementJobOutcome::disabled();
        }
        if (! $shift->isClosed() && ! $shift->isApproved()) {
            throw new RuntimeException('FUEL_SETTLEMENT_JOB_SHIFT_NOT_CLOSED: مهمة تسوية لوردية غير مغلقة.');
        }

        $actor = $this->actorFor($job, $shift);
        if ($actor === null) {
            return SettlementJobOutcome::blocked(['FUEL_SETTLEMENT_ACTOR_UNAVAILABLE']);
        }

        $token = (string) $job->getAttribute('locked_by');

        return DB::transaction(function () use ($job, $shift, $actor, $token) {
            $result = $this->engine->post($shift, $actor);
            if ($result->outcome === SettlementPostingResult::BLOCKED) {
                return SettlementJobOutcome::blocked($result->reasons);
            }

            // posted | replayed: الإنهاء في معاملة الترحيل نفسها، بحاجز الإيجار. فقد الإيجار ⇒ تراجع كل ما كُتب.
            $outcome = SettlementJobOutcome::posted();
            if (! $this->jobs->record($job, $token, $outcome)) {
                throw new RuntimeException('FUEL_SETTLEMENT_JOB_LEASE_LOST: فقد العامل إيجار المهمة قبل الإنهاء؛ تراجع الترحيل.');
            }

            return $outcome;
        });
    }

    private function actorFor(FuelShiftSettlementJob $job, FuelShift $shift): ?User
    {
        $userId = $job->triggered_by_user_id ?? $shift->closed_by;
        if ($userId === null) {
            return null;
        }
        $user = User::query()->where('tenant_id', $shift->tenant_id)->find($userId);

        return $user !== null && $user->is_active ? $user : null;
    }
}
