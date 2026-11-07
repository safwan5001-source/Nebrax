<?php

namespace App\Models;

use App\Tenancy\BranchScoped;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/**
 * FUEL-B6 (تعديل) — طلب قراءة خزان بتاريخ سابق بانتظار قرار مشرف مخوَّل (سياسة `supervisor_approval`).
 *
 * ليس قراءة تشغيلية: لا يدخل `fuel_tank_readings` ولا يؤثر في «آخر قراءة» ولا في المخزون أو الدفتر أو التسوية حتى يُعتمد. يكتبه
 * `FuelTankReadingRequestService` وحده (إنشاء/قرار) — لا `$fillable`. القرار مرة واحدة: بعد `approved|rejected` لا يتغيّر الطلب ولا يُحذف.
 */
class FuelTankReadingRequest extends BaseModel
{
    use BranchScoped;

    public const STATUS_PENDING = 'pending';
    public const STATUS_APPROVED = 'approved';
    public const STATUS_REJECTED = 'rejected';

    protected $guarded = ['*'];

    protected $casts = [
        'quantity_milliliters' => 'integer',
        'measured_at' => 'datetime',
        'decided_at' => 'datetime',
        'evidence' => 'array',
    ];

    protected static function booted(): void
    {
        static::updating(function (self $request) {
            if ($request->getOriginal('status') !== self::STATUS_PENDING) {
                throw new LogicException('A decided late-reading request cannot be changed.');
            }
        });
        static::deleting(fn () => throw new LogicException('Late-reading requests cannot be deleted.'));
    }

    public function station(): BelongsTo { return $this->belongsTo(FuelStation::class, 'fuel_station_id'); }
    public function tank(): BelongsTo { return $this->belongsTo(FuelTank::class, 'fuel_tank_id'); }
    public function requester(): BelongsTo { return $this->belongsTo(User::class, 'requested_by'); }
    public function decider(): BelongsTo { return $this->belongsTo(User::class, 'decided_by'); }
    public function reading(): BelongsTo { return $this->belongsTo(FuelTankReading::class, 'fuel_tank_reading_id'); }
}
