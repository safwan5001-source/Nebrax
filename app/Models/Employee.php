<?php

namespace App\Models;

use App\Support\GeneratesDocumentNumbers;
use App\Tenancy\BelongsToBranch;
use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;

/**
 * موظف. الرواتب بالـ minor units (هللات) كـ bigint — لا float إطلاقاً.
 * الإجمالي (gross) = الراتب الأساسي + البدلات.
 */
/**
 * @see design-system/foundations/multi-branch-architecture.md
 * موسوم بالفرع **وصفياً فقط** (مكان العمل) — شؤون الموظفين مركزية على مستوى
 * المؤسسة، فلا Global Scope هنا: كل الفروع ترى كل الموظفين.
 *
 * **`CompanyWide` إقرارٌ صريح بذلك، ومن ثمّ رقم الموظف مؤسسيٌّ لا فرعي:**
 * `PayrollRun` مؤسسيٌّ يضمّ كل الموظفين بلا تمييز فرع، فترقيمٌ بالفرع كان
 * يُدخل `EMP-00001` مرّتين في المسيّر الواحد. ورقم الموظف معرّف **إداري**
 * يُتداول في العقود والبنوك والتأمينات، لا رقم مستندٍ تشغيليّ يخصّ فرعاً.
 * والوسم بالفرع يبقى كما هو: مكان العمل، لا نطاق ترقيم.
 */
class Employee extends BaseModel implements CompanyWide
{
    use BelongsToBranch;
    use GeneratesDocumentNumbers;

    /** عمود الرقم هنا اسمه `employee_no` لا `number`. */
    public static function documentNumberColumn(): string
    {
        return 'employee_no';
    }

    protected $fillable = [
        'tenant_id', 'branch_id', 'employee_no', 'name', 'national_id', 'job_title',
        'basic_salary', 'allowances', 'gosi', 'other_deductions',
        'hire_date', 'is_active', 'notes',
    ];

    protected $casts = [
        'basic_salary'     => 'integer',
        'allowances'       => 'integer',
        'gosi'             => 'integer',
        'other_deductions' => 'integer',
        'hire_date'        => 'date',
        'is_active'        => 'boolean',
    ];

    protected $attributes = [
        'basic_salary'     => 0,
        'allowances'       => 0,
        'gosi'             => 0,
        'other_deductions' => 0,
        'is_active'        => true,
    ];

    public function items(): HasMany
    {
        return $this->hasMany(PayrollItem::class);
    }

    /**
     * حساب دخول هذا الموظف (إن مُنح). موظفٌ بلا `user` = سجلّ موارد بشرية
     * لا يدخل النظام — وهو الغالب. العلاقة واحدٌ-لواحد (`users.employee_id` فريد).
     */
    public function user(): HasOne
    {
        return $this->hasOne(User::class);
    }

    /** إجمالي استحقاق الموظف الشهري (الأساسي + البدلات) بالهللات. */
    public function gross(): int
    {
        return (int) $this->basic_salary + (int) $this->allowances;
    }

    /** إجمالي الاستقطاعات الشهرية (GOSI + استقطاعات أخرى) بالهللات. */
    public function deductions(): int
    {
        return (int) $this->gosi + (int) $this->other_deductions;
    }

    /** صافي استحقاق الموظف (الإجمالي − الاستقطاعات) بالهللات. */
    public function net(): int
    {
        return $this->gross() - $this->deductions();
    }
}
