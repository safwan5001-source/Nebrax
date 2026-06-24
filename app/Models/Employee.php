<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * موظف. الرواتب بالـ minor units (هللات) كـ bigint — لا float إطلاقاً.
 * الإجمالي (gross) = الراتب الأساسي + البدلات.
 */
class Employee extends BaseModel
{
    protected $fillable = [
        'tenant_id', 'employee_no', 'name', 'national_id', 'job_title',
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
