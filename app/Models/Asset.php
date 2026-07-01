<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Asset extends BaseModel
{
    protected $fillable = [
        'tenant_id', 'number', 'name', 'account_id', 'partner_id', 'acquisition_date',
        'payment_method', 'cost', 'tax_rate', 'tax_amount', 'total', 'salvage_value',
        'useful_life_months', 'accumulated_depreciation', 'status',
        'acquisition_entry_id', 'created_by',
    ];

    protected $casts = [
        'acquisition_date'         => 'date',
        'cost'                     => 'integer',
        'tax_rate'                 => 'integer',
        'tax_amount'               => 'integer',
        'total'                    => 'integer',
        'salvage_value'            => 'integer',
        'useful_life_months'       => 'integer',
        'accumulated_depreciation' => 'integer',
    ];

    public function account(): BelongsTo
    {
        return $this->belongsTo(Account::class);
    }

    public function partner(): BelongsTo
    {
        return $this->belongsTo(Partner::class);
    }

    public function isDraft(): bool
    {
        return $this->status === 'draft';
    }

    public function isActive(): bool
    {
        return $this->status === 'active';
    }

    /** الأساس القابل للإهلاك = التكلفة − القيمة التخريدية. */
    public function depreciableBase(): int
    {
        return max(0, (int) $this->cost - (int) $this->salvage_value);
    }

    /** القيمة الدفترية = التكلفة − مجمع الإهلاك. */
    public function bookValue(): int
    {
        return (int) $this->cost - (int) $this->accumulated_depreciation;
    }
}
