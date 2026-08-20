<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Carbon;

/**
 * نوع إجازة — كيانٌ مُدار لكل مؤسسة (سنوية، مرضية، بلا راتب...)، نطاق البناء
 * الأول لهرم الإجازات الثلاثي في دفترة: نوعٌ فقط + رصيدٌ مباشر، بلا طبقة
 * «سياسة إجازة» منفصلة وبلا قوائم عطلات بعد (design-system/foundations/
 * hr-users-architecture.md «الإجازات»).
 */
class LeaveType extends BaseModel implements CompanyWide
{
    protected $fillable = ['tenant_id', 'name', 'is_paid', 'annual_days', 'requires_approval', 'is_active'];

    protected $casts = [
        'is_paid'           => 'boolean',
        'annual_days'       => 'integer',
        'requires_approval' => 'boolean',
        'is_active'         => 'boolean',
    ];

    protected $attributes = [
        'is_paid'           => true,
        'requires_approval' => true,
        'is_active'         => true,
    ];

    public function leaveRequests(): HasMany
    {
        return $this->hasMany(LeaveRequest::class);
    }

    /**
     * رصيدٌ مباشر لموظفٍ بهذا النوع عن سنةٍ ميلادية (افتراضياً السنة الحالية):
     * مستحقٌّ = `annual_days` ثابتاً (بلا تناسبٍ بحسب تاريخ التعيين ولا ترحيل
     * رصيدٍ بين السنوات في هذا التمرير)، مستخدَمٌ = مجموع أيام الطلبات
     * `approved` التي يبدأ فيها ضمن السنة، متبقٍّ = الفرق (لا يقلّ عن صفر).
     *
     * @return array{entitled:int, used:int, remaining:int}
     */
    public function balanceFor(string $employeeId, ?int $year = null): array
    {
        $year ??= (int) Carbon::now()->year;

        $used = (int) $this->leaveRequests()
            ->where('employee_id', $employeeId)
            ->where('status', 'approved')
            ->whereYear('start_date', $year)
            ->sum('days_count');

        $entitled = (int) $this->annual_days;

        return [
            'entitled'  => $entitled,
            'used'      => $used,
            'remaining' => max(0, $entitled - $used),
        ];
    }
}
