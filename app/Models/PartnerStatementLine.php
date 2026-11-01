<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/** سطر كشف كما طُبع عند الطرف الآخر (IMP-PS-A1). غير قابل للتعديل بعد الإنشاء؛ تصحيحه = رفع كشف جديد. */
class PartnerStatementLine extends BaseModel implements CompanyWide
{
    protected $fillable = [
        'tenant_id', 'reconciliation_id', 'ordinal', 'line_date', 'reference', 'reference_key', 'our_reference', 'our_reference_key',
        'description', 'debit_minor', 'credit_minor', 'balance_minor', 'kind',
    ];

    protected $casts = [
        'ordinal' => 'integer',
        'line_date' => 'date:Y-m-d',
        'debit_minor' => 'integer',
        'credit_minor' => 'integer',
        'balance_minor' => 'integer',
    ];

    protected static function booted(): void
    {
        static::updating(static fn () => throw new LogicException('سطور كشف الطرف المستوردة غير قابلة للتعديل.'));
    }

    public function reconciliation(): BelongsTo
    {
        return $this->belongsTo(PartnerStatementReconciliation::class, 'reconciliation_id');
    }
}
