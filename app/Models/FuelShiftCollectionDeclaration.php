<?php

namespace App\Models;

use App\Tenancy\BranchScoped;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/**
 * إقرار تحصيل وردية الوقود: ما أقرّ البائع بتحصيله حسب طريقة الدفع، مقابل مبيعات العدادات × السعر الفعّال.
 *
 * تشغيلي فقط — ليس سند قبض ولا فاتورة ولا قيداً، ولا يغيّر نقد الوردية المتوقع. يكتبه `FuelShiftCollectionService` وحده
 * (لا `$fillable`)، ويُجمَّد عند إغلاق الوردية فلا يقبل أي تعديل بعدها.
 */
class FuelShiftCollectionDeclaration extends BaseModel
{
    use BranchScoped;

    public const STATUS_DECLARED = 'declared';
    public const STATUS_FROZEN = 'frozen';

    protected $guarded = ['*'];

    protected $casts = [
        'revision' => 'integer',
        'lines' => 'array',
        'collected_total_minor' => 'integer',
        'cash_declared_minor' => 'integer',
        'network_declared_minor' => 'integer',
        'sales_milliliters' => 'integer',
        'sales_milliliters_complete' => 'boolean',
        'sales_minor' => 'integer',
        'sales_complete' => 'boolean',
        'sales_breakdown' => 'array',
        'sales_gaps' => 'array',
        'sales_evaluated_at' => 'datetime',
        'difference_minor' => 'integer',
        'opening_float_minor' => 'integer',
        'counted_cash_minor' => 'integer',
        'cash_in_minor' => 'integer',
        'cash_out_minor' => 'integer',
        'treasury_handover_minor' => 'integer',
        'expenses_minor' => 'integer',
        'drawer_implied_sales_cash_minor' => 'integer',
        'cash_cross_difference_minor' => 'integer',
        'declared_at' => 'datetime',
        'frozen_at' => 'datetime',
    ];

    protected static function booted(): void
    {
        static::updating(function (self $declaration): void {
            if ($declaration->getOriginal('status') === self::STATUS_FROZEN) {
                throw new LogicException('إقرار تحصيل الوردية المجمَّد لا يعدّل.');
            }
        });
        static::deleting(fn () => throw new LogicException('إقرار تحصيل الوردية لا يحذف مباشرة.'));
    }

    public function shift(): BelongsTo { return $this->belongsTo(FuelShift::class, 'fuel_shift_id'); }
}
