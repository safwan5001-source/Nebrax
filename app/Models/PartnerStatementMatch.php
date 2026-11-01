<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use LogicException;

/**
 * نتيجة مطابقة واحدة (سطر كشف أو وحدة دفترية) ضمن تشغيلة — IMP-PS-A2c (`CompanyWide`). مشتقّة وغير قابلة للتعديل؛ لا تغيّر أي قيد أو مستند.
 */
class PartnerStatementMatch extends BaseModel implements CompanyWide
{
    protected $fillable = [
        'tenant_id', 'run_id', 'side', 'line_id', 'ordinal', 'outcome', 'rule', 'unit_key', 'difference_minor', 'day_difference',
        'explanation', 'warnings', 'unit', 'candidates', 'suggestions',
    ];

    protected $casts = [
        'ordinal' => 'integer', 'difference_minor' => 'integer', 'day_difference' => 'integer',
        'explanation' => 'array', 'warnings' => 'array', 'unit' => 'array', 'candidates' => 'array', 'suggestions' => 'array',
    ];

    protected static function booted(): void
    {
        parent::booted();
        static::updating(static function (): void {
            throw new LogicException('نتيجة المطابقة غير قابلة للتعديل بعد إنشائها.');
        });
    }
}
