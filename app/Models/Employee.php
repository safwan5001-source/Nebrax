<?php

namespace App\Models;

use App\Support\GeneratesDocumentNumbers;
use App\Tenancy\BelongsToBranch;
use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
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
        'tenant_id', 'branch_id', 'employee_no', 'name',
        'first_name', 'middle_name', 'last_name',
        'national_id', 'nationality', 'residency_expiry_date',
        'phone', 'personal_email',
        'job_title_id', 'department_id', 'job_level_id', 'employment_type_id', 'manager_id', 'shift_id',
        'current_address', 'current_city', 'current_building_no', 'current_street',
        'current_district', 'current_postal_code', 'current_country',
        'permanent_address', 'permanent_city', 'permanent_building_no', 'permanent_street',
        'permanent_district', 'permanent_postal_code', 'permanent_country',
        'basic_salary', 'allowances', 'gosi', 'other_deductions',
        'hire_date', 'is_active', 'notes',
    ];

    // photo_path عمداً خارج $fillable — يُدار حصراً عبر EmployeeController::uploadPhoto/removePhoto
    // (تعيين مباشر على الخاصية)، فلا يقبل مساراً حرّاً يصل عبر تحديث الموظف العادي.

    protected $casts = [
        'basic_salary'           => 'integer',
        'allowances'             => 'integer',
        'gosi'                   => 'integer',
        'other_deductions'       => 'integer',
        'hire_date'              => 'date',
        'residency_expiry_date'  => 'date',
        'is_active'              => 'boolean',
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

    /** المدير المباشر — علاقة ذاتية اختيارية داخل نفس الجدول. */
    public function manager(): BelongsTo
    {
        return $this->belongsTo(self::class, 'manager_id');
    }

    /** مرؤوسو هذا الموظف (إن كان مديراً مباشراً لآخرين). */
    public function subordinates(): HasMany
    {
        return $this->hasMany(self::class, 'manager_id');
    }

    /** مسوّغات التعيين — مرفقات الموظف (هوية، شهادات، عقود ممسوحة…). */
    public function attachments(): HasMany
    {
        return $this->hasMany(EmployeeAttachment::class);
    }

    /** عقود العمل عبر الزمن — مصدر الحقيقة الفعلي للراتب، انظر Contract::activeFor(). */
    public function contracts(): HasMany
    {
        return $this->hasMany(Contract::class);
    }

    /** العقد النشط لهذا الموظف بتاريخ مرجعي معيّن (افتراضياً اليوم). */
    public function activeContract(?string $referenceDate = null): ?Contract
    {
        return Contract::activeFor($this->id, $referenceDate);
    }

    /** طلبات الإجازة عبر الزمن — انظر LeaveType::balanceFor(). */
    public function leaveRequests(): HasMany
    {
        return $this->hasMany(LeaveRequest::class);
    }

    /** طلبات عامة (سلفة/استئذان/شكوى...) — وحدةٌ منفصلة عن طلبات الإجازة عمداً. */
    public function employeeRequests(): HasMany
    {
        return $this->hasMany(EmployeeRequest::class);
    }

    /** المسمى الوظيفي — جزءٌ من الهيكل التنظيمي (كيانٌ مُدار لكل مؤسسة). */
    public function jobTitle(): BelongsTo
    {
        return $this->belongsTo(JobTitle::class);
    }

    /** القسم — جزءٌ من الهيكل التنظيمي. */
    public function department(): BelongsTo
    {
        return $this->belongsTo(Department::class);
    }

    /** المستوى الوظيفي — جزءٌ من الهيكل التنظيمي. */
    public function jobLevel(): BelongsTo
    {
        return $this->belongsTo(JobLevel::class);
    }

    /** نوع التوظيف — جزءٌ من الهيكل التنظيمي. */
    public function employmentType(): BelongsTo
    {
        return $this->belongsTo(EmploymentType::class);
    }

    /**
     * الوردية الافتراضية المقترحة عند تسجيل حضوره. `Shift` مُصنَّف
     * `BranchScoped`، فالوصول المباشر لهذه العلاقة من سياقٍ خارج فرعها لا يُرجع
     * صفاً — تحقّق الملكية عند الحفظ يمرّ عبر `BranchScope::reference()` بدل
     * هذه العلاقة، انظر `EmployeeController`.
     */
    public function shift(): BelongsTo
    {
        return $this->belongsTo(Shift::class);
    }

    /**
     * إجمالي استحقاق الموظف الشهري (الأساسي + البدلات) بالهللات، من عقده
     * النشط اليوم — لا حقوله الثابتة القديمة. صفر بلا عقدٍ نشط.
     */
    public function gross(): int
    {
        return $this->activeContract()?->gross() ?? 0;
    }

    /** إجمالي الاستقطاعات الشهرية (GOSI + استقطاعات أخرى) بالهللات، من العقد النشط. */
    public function deductions(): int
    {
        return $this->activeContract()?->deductions() ?? 0;
    }

    /** صافي استحقاق الموظف (الإجمالي − الاستقطاعات) بالهللات، من العقد النشط. */
    public function net(): int
    {
        return $this->activeContract()?->net() ?? 0;
    }
}
