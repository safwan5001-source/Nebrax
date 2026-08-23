<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use App\Tenancy\ResolvesBranchReferences;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** Mutex متين لقرار الائتمان، وليس جدول أرصدة أو دفتر ذمم موازياً. */
class CorporateFuelCreditLock extends BaseModel implements CompanyWide
{
    use ResolvesBranchReferences;

    protected $fillable = ['tenant_id', 'partner_id'];

    public function partner(): BelongsTo
    {
        return $this->referenceBelongsTo(Partner::class);
    }
}
