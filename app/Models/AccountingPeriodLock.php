<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * ACC-6 — نطاق تاريخ محاسبي مقفل للمؤسسة كلها.
 *
 * `CompanyWide` بقرارٍ صريح في عقد ACC-6: القيد الواحد قد يضمّ سطوراً بفروع
 * مختلفة أو بلا فرع، فقفلٌ بالفرع يجعل قيداً متوازناً «مقفولاً جزئياً».
 *
 * النطاق شاملٌ لطرفيه (`start_date` و`end_date` داخله)، ولا يُحذف: التحرير
 * يحوّل الحالة إلى `released` ويُبقي الصفّ شاهداً تاريخياً.
 */
class AccountingPeriodLock extends BaseModel implements CompanyWide
{
    protected $fillable = [
        'tenant_id', 'start_date', 'end_date', 'status', 'reason',
        'created_by', 'released_by', 'released_at', 'release_reason',
    ];

    protected $casts = [
        'start_date'  => 'date',
        'end_date'    => 'date',
        'released_at' => 'datetime',
    ];

    public function isActive(): bool
    {
        return $this->status === 'active';
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function releaser(): BelongsTo
    {
        return $this->belongsTo(User::class, 'released_by');
    }
}
