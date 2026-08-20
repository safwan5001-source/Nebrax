<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * عقد العمل — مصدر الحقيقة الفعلي لراتب الموظف، لا حقول Employee الثابتة
 * (design-system/foundations/hr-users-architecture.md «الراتب يتبع العقد»).
 * لموظفٍ واحد عقودٌ متعددة عبر الزمن؛ العقد **النشط** بتاريخٍ مرجعي معيّن هو
 * ما يغذّي مسيّر الرواتب (`PayrollService::create`) — انظر `activeFor()`.
 */
class Contract extends BaseModel implements CompanyWide
{
    public const TYPES = ['permanent', 'fixed_term', 'probation'];

    public const STATUSES = ['active', 'ended', 'terminated'];

    protected $fillable = [
        'tenant_id', 'employee_id', 'type', 'status',
        'start_date', 'end_date', 'probation_end_date',
        'basic_salary', 'allowances', 'gosi', 'other_deductions',
        'notes', 'created_by',
    ];

    protected $casts = [
        'start_date'          => 'date',
        'end_date'            => 'date',
        'probation_end_date'  => 'date',
        'basic_salary'        => 'integer',
        'allowances'          => 'integer',
        'gosi'                => 'integer',
        'other_deductions'    => 'integer',
    ];

    protected $attributes = [
        'type'              => 'permanent',
        'status'            => 'active',
        'basic_salary'      => 0,
        'allowances'        => 0,
        'gosi'              => 0,
        'other_deductions'  => 0,
    ];

    public function employee(): BelongsTo
    {
        return $this->belongsTo(Employee::class);
    }

    /** إجمالي استحقاق العقد الشهري (الأساسي + البدلات) بالهللات. */
    public function gross(): int
    {
        return (int) $this->basic_salary + (int) $this->allowances;
    }

    /** إجمالي الاستقطاعات الشهرية (GOSI + استقطاعات أخرى) بالهللات. */
    public function deductions(): int
    {
        return (int) $this->gosi + (int) $this->other_deductions;
    }

    /** صافي استحقاق العقد (الإجمالي − الاستقطاعات) بالهللات. */
    public function net(): int
    {
        return $this->gross() - $this->deductions();
    }

    /**
     * العقد النشط لموظف بتاريخ مرجعي معيّن (افتراضياً اليوم): حالته `active`،
     * بدأ في هذا التاريخ أو قبله، ولم ينتهِ بعد (أو بلا تاريخ نهاية). عند تعدّد
     * العقود المتقاطعة (خطأ إدخال لا يفترضه `assertNoContractOverlap` عادةً) يفوز
     * الأحدث بدءاً (`start_date`).
     */
    public static function activeFor(string $employeeId, ?string $referenceDate = null): ?self
    {
        $date = $referenceDate ?? now()->toDateString();

        // `whereDate()` لا `where()` عمداً: عمود التاريخ يُخزَّن بمكوّن وقتٍ صفري
        // (سلوك Eloquent الافتراضي لعمود `date`)، فمقارنة نصّية مباشرة بتاريخٍ
        // مجرَّد («٢٠٢٦-٠١-٠١») تفشل معجمياً في SQLite (أطول نصاً = أكبر).
        return static::where('employee_id', $employeeId)
            ->where('status', 'active')
            ->whereDate('start_date', '<=', $date)
            ->where(function ($q) use ($date) {
                $q->whereNull('end_date')->orWhereDate('end_date', '>=', $date);
            })
            ->orderByDesc('start_date')
            ->first();
    }
}
