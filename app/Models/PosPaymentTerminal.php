<?php

namespace App\Models;

use App\Tenancy\BranchScoped;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * جهاز دفع بطاقة لنقطة بيع (PAY-H6-02). معزول بالفرع. `meta` بيانات وصفية غير سرية فقط؛ أسرار الاقتران/المزوّد تأتي مع المحوّل الحقيقي (H6-03)
 * وتُخزَّن مشفّرة، ولا تظهر في أي مورد.
 */
class PosPaymentTerminal extends BaseModel
{
    use BranchScoped;

    protected $fillable = ['tenant_id', 'branch_id', 'pos_device_id', 'name', 'code', 'provider', 'meta', 'is_active'];

    protected $casts = [
        'meta' => 'array',
        'is_active' => 'boolean',
    ];

    protected $attributes = [
        'is_active' => true,
    ];

    public function posDevice(): BelongsTo
    {
        return $this->belongsTo(PosDevice::class);
    }

    public function requests(): HasMany
    {
        return $this->hasMany(PosTerminalRequest::class, 'pos_payment_terminal_id');
    }
}
