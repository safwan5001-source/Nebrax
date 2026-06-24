<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * سطر مسيّر رواتب — لقطة راتب موظف لحظة إنشاء المسيّر.
 * gross = basic_salary + allowances ، net = gross (في MVP، بلا استقطاعات).
 * المبالغ بالـ minor units (هللات) كـ bigint.
 */
class PayrollItem extends BaseModel
{
    protected $fillable = [
        'tenant_id', 'payroll_run_id', 'employee_id',
        'basic_salary', 'allowances', 'gosi', 'other_deductions', 'gross', 'net',
    ];

    protected $casts = [
        'basic_salary'     => 'integer',
        'allowances'       => 'integer',
        'gosi'             => 'integer',
        'other_deductions' => 'integer',
        'gross'            => 'integer',
        'net'              => 'integer',
    ];

    public function run(): BelongsTo
    {
        return $this->belongsTo(PayrollRun::class, 'payroll_run_id');
    }

    public function employee(): BelongsTo
    {
        return $this->belongsTo(Employee::class);
    }
}
