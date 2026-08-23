<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use App\Tenancy\ResolvesBranchReferences;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/** سجل تدقيق موحد وحتمي لتغييرات Cycle 6 الحساسة. */
class CorporateFuelAuditEvent extends BaseModel implements CompanyWide
{
    use ResolvesBranchReferences;

    protected $fillable = [
        'tenant_id', 'subject_type', 'subject_id', 'action', 'before', 'after', 'changed_by', 'reason', 'changed_at',
    ];

    protected $casts = [
        'before' => 'array',
        'after' => 'array',
        'changed_at' => 'datetime',
    ];

    protected static function booted(): void
    {
        static::updating(fn () => throw new LogicException('حدث تدقيق الوقود المؤسسي immutable.'));
        static::deleting(fn () => throw new LogicException('حدث تدقيق الوقود المؤسسي لا يحذف.'));
    }

    public function changedBy(): BelongsTo
    {
        return $this->referenceBelongsTo(User::class, 'changed_by');
    }
}
