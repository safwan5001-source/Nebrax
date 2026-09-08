<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/** FISCAL-2 — سجل تدقيق ثابت للسنوات المالية. لا يُحدَّث ولا يُحذف بعد الإنشاء. */
class FiscalYearEvent extends BaseModel implements CompanyWide
{
    public const YEAR_CREATED = 'year_created';
    public const YEAR_UPDATED = 'year_updated';
    public const YEAR_CLOSED = 'year_closed';
    public const YEAR_REOPENED = 'year_reopened';

    protected $fillable = [
        'tenant_id', 'fiscal_year_id', 'fiscal_year_close_id', 'action',
        'actor_user_id', 'generation', 'journal_entry_id', 'reason', 'details',
    ];

    protected $casts = [
        'generation' => 'integer',
        'details'    => 'array',
    ];

    protected static function booted(): void
    {
        static::updating(fn () => throw new LogicException('Fiscal year events are immutable.'));
        static::deleting(fn () => throw new LogicException('Fiscal year events cannot be deleted.'));
    }

    public function actor(): BelongsTo
    {
        return $this->belongsTo(User::class, 'actor_user_id');
    }
}
