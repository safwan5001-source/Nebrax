<?php

namespace App\Models;

use App\Tenancy\BranchScoped;

/**
 * @see design-system/foundations/hr-users-architecture.md
 * وردية عمل — تعريف جدولٍ زمني تُسنَد إليه الموظفون لاحقاً.
 *
 * **معزولة بالفرع (`BranchScoped`)** — وفق مرجع دفترة المعتمَد: خلافاً لسجلّ
 * الموظف المركزي (`CompanyWide`)، وردية العمل **مرتبطة بفرعٍ تشغيلي فعلي**،
 * فكل فرع يرى ويدير ورديّاته. `BranchScoped` يسم الفرع النشط عند الإنشاء
 * ويعزل القراءة تلقائياً؛ ووردية `branch_id = null` مشترَكة تُرى من كل الفروع.
 */
class Shift extends BaseModel
{
    use BranchScoped;

    protected $fillable = [
        'tenant_id', 'branch_id', 'name',
        'start_time', 'end_time', 'break_minutes', 'work_days', 'is_active',
    ];

    protected $casts = [
        'break_minutes' => 'integer',
        'work_days'     => 'array',
        'is_active'     => 'boolean',
    ];

    protected $attributes = [
        'break_minutes' => 0,
        'is_active'     => true,
    ];

    /**
     * صافي دقائق العمل = (النهاية − البداية) − الاستراحة.
     * الوردية العابرة لمنتصف الليل (نهايةٌ ≤ بداية) تُحسب على مدار ٢٤ ساعة.
     */
    public function netMinutes(): int
    {
        $toMinutes = static function (?string $time): int {
            [$h, $m] = array_pad(array_map('intval', explode(':', (string) $time)), 2, 0);
            return $h * 60 + $m;
        };

        $span = $toMinutes($this->end_time) - $toMinutes($this->start_time);
        if ($span <= 0) {
            $span += 24 * 60; // وردية ليلية تعبر منتصف الليل
        }

        return max(0, $span - (int) $this->break_minutes);
    }
}
