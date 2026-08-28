<?php

namespace App\Services\Pos;

use App\Models\Shift;
use App\Models\User;
use Illuminate\Support\Carbon;

/**
 * يحلّ جدول عمل معتمَد (User → Employee → Shift) لأجل قاعدة `outside_operating_hours`
 * فقط (Phase 4). **لا يبني نظام جدولة جديداً** — `Employee.shift_id`/`Shift` قائمان
 * أصلاً (design-system/foundations/hr-users-architecture.md)؛ هذا غلافٌ رقيقٌ يحلّهما
 * دفعة واحدة (بلا N+1) ويحسب التغطية الزمنية بمنطق عبور منتصف الليل نفسه المعتمَد في
 * `Shift::netMinutes()`.
 *
 * مستخدمٌ بلا `employee_id`، أو موظف بلا `shift_id`، أو وردية معطّلة/محذوفة —
 * **لا وردية محلولة له إطلاقاً**، فلا إشارة له في قاعدة الكشف (لا تخمين نمط ٩–٥
 * افتراضي أبداً؛ راجع مصفوفة فجوات Phase 4، البند ٤/ب).
 */
final class PosEmployeeScheduleResolver
{
    /**
     * @param  list<string>  $userIds
     * @return array<string, Shift> مفهرسة بمعرّف المستخدم؛ الغياب = لا وردية محلولة.
     */
    public function resolveMany(array $userIds): array
    {
        if ($userIds === []) {
            return [];
        }

        return User::query()
            ->whereIn('id', array_values(array_unique($userIds)))
            ->whereNotNull('employee_id')
            ->with(['employee' => fn ($query) => $query->whereNotNull('shift_id')->with('shift')])
            ->get(['id', 'employee_id'])
            ->filter(fn (User $user) => $user->employee?->shift instanceof Shift && $user->employee->shift->is_active)
            ->mapWithKeys(fn (User $user) => [$user->id => $user->employee->shift])
            ->all();
    }

    /**
     * هل تقع لحظة `$at` (UTC) ضمن نافذة الوردية (أيام العمل + دقائق سماح) بتوقيت
     * `$timezone`؟ نفحص مرساتَي «اليوم» و«الأمس» بتواريخ تقويمية فعلية (لا modulo
     * يدوي) كي تُحسب الورديات الليلية العابرة لمنتصف الليل بلا أخطاء حدّية.
     */
    public function covers(Shift $shift, Carbon $at, string $timezone, int $graceMinutes): bool
    {
        $local = $at->copy()->setTimezone($timezone);
        $workDays = array_map('intval', (array) $shift->work_days);

        foreach ([0, -1] as $dayOffset) {
            $anchorDay = $local->copy()->startOfDay()->addDays($dayOffset);
            if (! in_array($anchorDay->dayOfWeek, $workDays, true)) {
                continue;
            }
            [$start, $end] = $this->shiftWindow($shift, $anchorDay);
            if ($local->between($start->copy()->subMinutes($graceMinutes), $end->copy()->addMinutes($graceMinutes))) {
                return true;
            }
        }

        return false;
    }

    /**
     * @return array{0: Carbon, 1: Carbon} بداية/نهاية الوردية مرساة بيوم تقويمي
     *         فعلي؛ النهاية تعبر لليوم التالي تلقائياً حين تكون الوردية ليلية،
     *         بالضبط كما يُحسب صافي دقائقها في `Shift::netMinutes()`.
     */
    private function shiftWindow(Shift $shift, Carbon $anchorDay): array
    {
        $toMinutes = static function (?string $time): int {
            [$h, $m] = array_pad(array_map('intval', explode(':', (string) $time)), 2, 0);

            return $h * 60 + $m;
        };
        $startMinutes = $toMinutes($shift->start_time);
        $endMinutes = $toMinutes($shift->end_time);

        $start = $anchorDay->copy()->addMinutes($startMinutes);
        $end = $anchorDay->copy()->addMinutes($endMinutes <= $startMinutes ? $endMinutes + 24 * 60 : $endMinutes);

        return [$start, $end];
    }
}
