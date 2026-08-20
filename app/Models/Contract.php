<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * عقد العمل — مصدر الحقيقة الفعلي لراتب الموظف، لا حقول Employee الثابتة
 * (design-system/foundations/hr-users-architecture.md «الراتب يتبع العقد»).
 * لموظفٍ واحد عقودٌ متعددة عبر الزمن؛ العقد **النشط** بتاريخٍ مرجعي معيّن هو
 * ما يغذّي مسيّر الرواتب (`PayrollService::create`) — انظر `activeFor()`.
 *
 * الراتب نفسه بنودٌ على `items()` لا أعمدةً ثابتة (نطاق البناء الأول لقوالب/
 * بنود الراتب — بنودٌ على العقد مباشرة، إدخالٌ يدوي، لا قالبٌ مستقلٌّ بعد).
 * كل بندٍ يحمل تصنيفاً من `CATEGORIES` يحدِّد مساره المحاسبي في
 * `PayrollService::post()` (5120 استحقاقاً، 2140/2150 خصماً حسب التصنيف).
 */
class Contract extends BaseModel implements CompanyWide
{
    public const TYPES = ['permanent', 'fixed_term', 'probation'];

    public const STATUSES = ['active', 'ended', 'terminated'];

    /** basic: الأساسي (استحقاق، إلزامي واحد فقط) · allowance: بدل (استحقاق)
     *  gosi: تأمينات اجتماعية (خصم) · other: استقطاعٌ آخر (خصم). */
    public const CATEGORIES = ['basic', 'allowance', 'gosi', 'other'];

    public const EARNING_CATEGORIES = ['basic', 'allowance'];

    public const DEDUCTION_CATEGORIES = ['gosi', 'other'];

    protected $fillable = [
        'tenant_id', 'employee_id', 'type', 'status',
        'start_date', 'end_date', 'probation_end_date',
        'notes', 'created_by',
    ];

    protected $casts = [
        'start_date'          => 'date',
        'end_date'            => 'date',
        'probation_end_date'  => 'date',
    ];

    protected $attributes = [
        'type'   => 'permanent',
        'status' => 'active',
    ];

    public function employee(): BelongsTo
    {
        return $this->belongsTo(Employee::class);
    }

    public function items(): HasMany
    {
        return $this->hasMany(ContractItem::class)->orderBy('sort_order');
    }

    /** قيمة بند الراتب الأساسي (بندٌ واحدٌ إلزامي بتصنيف `basic`). */
    public function basicSalary(): int
    {
        return (int) $this->items->firstWhere('category', 'basic')?->amount;
    }

    /** إجمالي بنود التأمينات الاجتماعية (تصنيف `gosi`) — يغذّي 2140. */
    public function gosiTotal(): int
    {
        return (int) $this->items->where('category', 'gosi')->sum('amount');
    }

    /** إجمالي بنود الاستقطاعات الأخرى (تصنيف `other`) — يغذّي 2150. */
    public function otherDeductionsTotal(): int
    {
        return (int) $this->items->where('category', 'other')->sum('amount');
    }

    /** إجمالي استحقاق العقد الشهري (بنود `basic`/`allowance`) بالهللات. */
    public function gross(): int
    {
        return (int) $this->items->whereIn('category', self::EARNING_CATEGORIES)->sum('amount');
    }

    /** إجمالي الاستقطاعات الشهرية (بنود `gosi`/`other`) بالهللات. */
    public function deductions(): int
    {
        return $this->gosiTotal() + $this->otherDeductionsTotal();
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
        return static::with('items')
            ->where('employee_id', $employeeId)
            ->where('status', 'active')
            ->whereDate('start_date', '<=', $date)
            ->where(function ($q) use ($date) {
                $q->whereNull('end_date')->orWhereDate('end_date', '>=', $date);
            })
            ->orderByDesc('start_date')
            ->first();
    }
}
