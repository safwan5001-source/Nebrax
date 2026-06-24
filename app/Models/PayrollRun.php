<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * مسيّر رواتب شهري. يُنشأ draft من الموظفين النشطين، ثم يُرحَّل (استحقاق)
 * عبر PayrollService::post (مدين 5120 / دائن 2130)، ثم يُصرف عبر pay
 * (مدين 2130 / دائن 1110|1120). كل القيود تمر عبر LedgerService حصراً.
 * المبالغ بالـ minor units (هللات) كـ bigint.
 */
class PayrollRun extends BaseModel
{
    protected $fillable = [
        'tenant_id', 'number', 'period', 'period_start', 'period_end',
        'status', 'pay_method', 'total_gross', 'total_gosi', 'total_other_deductions',
        'total_net', 'notes', 'journal_entry_id', 'payment_journal_entry_id', 'created_by',
        'posted_at', 'paid_at',
    ];

    protected $casts = [
        'period_start'           => 'date',
        'period_end'             => 'date',
        'total_gross'            => 'integer',
        'total_gosi'             => 'integer',
        'total_other_deductions' => 'integer',
        'total_net'              => 'integer',
        'posted_at'              => 'datetime',
        'paid_at'                => 'datetime',
    ];

    protected $attributes = [
        'status'                 => 'draft',
        'total_gross'            => 0,
        'total_gosi'             => 0,
        'total_other_deductions' => 0,
        'total_net'              => 0,
    ];

    public function items(): HasMany
    {
        return $this->hasMany(PayrollItem::class);
    }

    public function journalEntry(): BelongsTo
    {
        return $this->belongsTo(JournalEntry::class, 'journal_entry_id');
    }

    public function paymentJournalEntry(): BelongsTo
    {
        return $this->belongsTo(JournalEntry::class, 'payment_journal_entry_id');
    }

    public function isDraft(): bool
    {
        return $this->status === 'draft';
    }

    public function isPosted(): bool
    {
        return $this->status === 'posted';
    }

    public function isPaid(): bool
    {
        return $this->status === 'paid';
    }

    /** إجمالي الاستقطاعات (GOSI + استقطاعات أخرى) بالهللات. */
    public function totalDeductions(): int
    {
        return (int) $this->total_gosi + (int) $this->total_other_deductions;
    }
}
