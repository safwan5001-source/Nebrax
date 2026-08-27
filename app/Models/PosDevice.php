<?php

namespace App\Models;

use App\Tenancy\BranchScoped;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * جهاز نقطة بيع تشغيلي معزول بالفرع. يعيّن مخزن الخروج الذي تلتقطه جلسة
 * الكاشير عند فتحها؛ تعديل الجهاز لاحقاً لا يعيد تفسير جلسة أو فاتورة قائمة.
 */
class PosDevice extends BaseModel
{
    use BranchScoped;

    protected $fillable = [
        'tenant_id', 'branch_id', 'warehouse_id', 'name', 'code', 'notes', 'cash_drawer_config', 'is_active',
    ];

    protected $casts = [
        'cash_drawer_config' => 'array',
            'is_active' => 'boolean',
    ];

    protected $attributes = [
        'is_active' => true,
    ];

    /** المخزن إعداد مؤسسي مشترك، فلا يحتاج إلى تجاوز عزل فرع عند الحل. */
    public function warehouse(): BelongsTo
    {
        return $this->belongsTo(Warehouse::class);
    }

    public function sessions(): HasMany
    {
        return $this->hasMany(PosSession::class);
    }
}
