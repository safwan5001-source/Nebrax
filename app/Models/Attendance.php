<?php

namespace App\Models;

use App\Tenancy\BranchScoped;
use App\Tenancy\ResolvesBranchReferences;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * @see design-system/foundations/hr-users-architecture.md — قسم ٥
 * سجلّ حضورٍ يومي لموظف. **`BranchScoped`** (عملٌ يوميٌّ في فرعٍ فعلي)، خلافاً
 * لسجلّ الموظف المركزي (`CompanyWide`). ساعات العمل مشتقّة لا مخزَّنة.
 */
class Attendance extends BaseModel
{
    use BranchScoped;
    use ResolvesBranchReferences;

    protected $fillable = [
        'tenant_id', 'branch_id', 'employee_id', 'shift_id',
        'attendance_date', 'check_in', 'check_out', 'status', 'notes',
    ];

    protected $casts = [
        'attendance_date' => 'date',
    ];

    protected $attributes = [
        'status' => 'present',
    ];

    /** سجلّ الموظف — مركزيّ (`CompanyWide`)، فلا عزل فرعٍ على العلاقة. */
    public function employee(): BelongsTo
    {
        return $this->belongsTo(Employee::class);
    }

    /**
     * الوردية المخزَّنة — مرجعٌ يُحلّ بلا عزل فرع: الوردية `BranchScoped`، وقد
     * تُقرأ خارج سياق فرعها فيعود `null` صامتاً؛ `referenceBelongsTo` يقفل ذلك.
     */
    public function shift(): BelongsTo
    {
        return $this->referenceBelongsTo(Shift::class);
    }

    /**
     * دقائق العمل الفعلية = (الخروج − الدخول)، مع معالجة الخروج بعد منتصف الليل.
     * غياب أحد الطرفين ⇒ صفر (لا وقت محتسَب).
     */
    public function workedMinutes(): int
    {
        if (! $this->check_in || ! $this->check_out) {
            return 0;
        }

        $toMinutes = static function (string $time): int {
            [$h, $m] = array_pad(array_map('intval', explode(':', $time)), 2, 0);
            return $h * 60 + $m;
        };

        $span = $toMinutes((string) $this->check_out) - $toMinutes((string) $this->check_in);
        if ($span < 0) {
            $span += 24 * 60; // خروجٌ بعد منتصف الليل
        }

        return $span;
    }
}
