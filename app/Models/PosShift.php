<?php

namespace App\Models;

use App\Tenancy\BranchScoped;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * وردية تشغيل نقاط البيع — مستقلة عن وردية الموارد البشرية.
 * تستخدم لتجميع جلسات POS والتقارير ولا تفرض جدول دوام موظف.
 */
class PosShift extends BaseModel
{
    use BranchScoped;

    protected $fillable = [
        'tenant_id', 'branch_id', 'name', 'code', 'description', 'is_active',
    ];

    protected $casts = [
        'is_active' => 'boolean',
    ];

    protected $attributes = [
        'is_active' => true,
    ];

    public function sessions(): HasMany
    {
        return $this->hasMany(PosSession::class);
    }
}
