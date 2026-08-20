<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * بند راتبٍ فردي على عقد (أساسي/بدل/تأمينات/استقطاع آخر) — نطاق البناء الأول
 * لقوالب/بنود الراتب: بنودٌ على العقد مباشرة، لا قالبٌ مستقلٌّ بعد.
 * انظر Contract::CATEGORIES ومسار الترحيل المحاسبي في PayrollService::post().
 */
class ContractItem extends BaseModel implements CompanyWide
{
    protected $fillable = ['tenant_id', 'contract_id', 'category', 'name', 'amount', 'sort_order'];

    protected $casts = [
        'amount'     => 'integer',
        'sort_order' => 'integer',
    ];

    public function contract(): BelongsTo
    {
        return $this->belongsTo(Contract::class);
    }
}
