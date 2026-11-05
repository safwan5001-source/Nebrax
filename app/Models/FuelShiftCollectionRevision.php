<?php

namespace App\Models;

use App\Tenancy\BranchScoped;
use LogicException;

/** نسخة محفوظة من إقرار تحصيل الوردية — سجل تدقيق append-only بمفتاح idempotency فريد للمؤسسة. */
class FuelShiftCollectionRevision extends BaseModel
{
    use BranchScoped;

    protected $guarded = ['*'];

    protected $casts = [
        'revision' => 'integer',
        'lines' => 'array',
        'collected_total_minor' => 'integer',
        'occurred_at' => 'datetime',
    ];

    protected static function booted(): void
    {
        static::updating(fn () => throw new LogicException('نسخة إقرار التحصيل سجل تدقيق لا يعدّل.'));
        static::deleting(fn () => throw new LogicException('نسخة إقرار التحصيل لا تحذف.'));
    }
}
