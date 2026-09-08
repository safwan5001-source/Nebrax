<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * FISCAL-2 — السنة المالية.
 *
 * `CompanyWide` بقرار FISCAL-1: الإقفال السنوي مؤسسيّ لا فرعيّ، ولا يوزَّع
 * على الفروع في V1. الحدّان `start_date`/`end_date` شاملان، والسنة قد تكون
 * غير تقويمية. لا تتداخل سنتان نشطتان لمستأجر واحد.
 */
class FiscalYear extends BaseModel implements CompanyWide
{
    public const STATUS_OPEN = 'open';
    public const STATUS_CLOSING = 'closing';
    public const STATUS_CLOSED = 'closed';
    public const STATUS_REOPENING = 'reopening';

    protected $fillable = [
        'tenant_id', 'name', 'start_date', 'end_date', 'status', 'created_by',
    ];

    protected $casts = [
        'start_date' => 'date',
        'end_date'   => 'date',
    ];

    public function isOpen(): bool
    {
        return $this->status === self::STATUS_OPEN;
    }

    public function isClosed(): bool
    {
        return $this->status === self::STATUS_CLOSED;
    }

    /** هل السنة في منتصف عملية إقفال/فتح؟ عملية ثانية موازية ممنوعة حينها. */
    public function isTransitioning(): bool
    {
        return in_array($this->status, [self::STATUS_CLOSING, self::STATUS_REOPENING], true);
    }

    public function closes(): HasMany
    {
        return $this->hasMany(FiscalYearClose::class)->orderBy('generation');
    }

    /** الجيل النشط — واحدٌ على الأكثر: الفتح يعكسه قبل السماح بإقفال جديد. */
    public function activeClose(): HasMany
    {
        return $this->hasMany(FiscalYearClose::class)->where('status', FiscalYearClose::STATUS_ACTIVE);
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }
}
