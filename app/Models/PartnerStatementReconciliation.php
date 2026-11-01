<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * رأس مقارنة كشف حساب طرف (IMP-PS-A1، D-PS-03: `CompanyWide`). **تجهيز مقارنة لا أثر مالي**: لا قيد ولا مستند ولا رصيد؛ الجداول لا ترتبط بالأستاذ.
 * يكتبه `PartnerStatementImportService` وحده. السياسات (`policy`) مجمَّدة وقت المعاينة وتستعملها المطابقة لاحقاً (PS-A2).
 */
class PartnerStatementReconciliation extends BaseModel implements CompanyWide
{
    public const ROLE_CUSTOMER = 'customer';

    public const ROLE_SUPPLIER = 'supplier';

    public const ROLES = [self::ROLE_CUSTOMER, self::ROLE_SUPPLIER];

    public const STATUS_DRAFT = 'draft';

    protected $fillable = [
        'tenant_id', 'partner_id', 'role', 'period_from', 'period_to', 'currency', 'status', 'original_filename', 'file_sha256',
        'source_import_job_id', 'line_count', 'total_debit_minor', 'total_credit_minor', 'policy', 'checks', 'created_by',
    ];

    protected $casts = [
        'period_from' => 'date:Y-m-d',
        'period_to' => 'date:Y-m-d',
        'line_count' => 'integer',
        'total_debit_minor' => 'integer',
        'total_credit_minor' => 'integer',
        'policy' => 'array',
        'checks' => 'array',
    ];

    public function lines(): HasMany
    {
        return $this->hasMany(PartnerStatementLine::class, 'reconciliation_id');
    }

    public function partner(): BelongsTo
    {
        return $this->belongsTo(Partner::class);
    }
}
