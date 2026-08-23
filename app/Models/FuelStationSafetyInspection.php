<?php

namespace App\Models;

use App\Support\GeneratesDocumentNumbers;
use App\Tenancy\BranchScoped;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use LogicException;

/** سلامة تشغيلية مستقلة؛ لا تغيّر المخزون أو القيود أو حالة جهاز مادي مباشرة. */
class FuelStationSafetyInspection extends BaseModel
{
    use BranchScoped;
    use GeneratesDocumentNumbers;

    public const STATUS_SCHEDULED = 'scheduled';
    public const STATUS_PERFORMED = 'performed';
    public const STATUS_VERIFIED = 'verified';
    public const STATUS_CLOSED = 'closed';
    public const STATUSES = [self::STATUS_SCHEDULED, self::STATUS_PERFORMED, self::STATUS_VERIFIED, self::STATUS_CLOSED];

    protected $fillable = [
        'tenant_id', 'branch_id', 'fuel_station_id', 'number', 'inspection_type', 'status',
        'scheduled_at', 'performed_at', 'verified_at', 'closed_at', 'inspector_id', 'verified_by',
        'notes', 'evidence_reference',
    ];

    protected $casts = [
        'scheduled_at' => 'datetime', 'performed_at' => 'datetime', 'verified_at' => 'datetime', 'closed_at' => 'datetime',
    ];

    protected static function booted(): void
    {
        static::updating(function (self $inspection): void {
            if ($inspection->getOriginal('status') === self::STATUS_CLOSED) {
                throw new LogicException('لا يعدّل فحص السلامة المغلق مباشرة؛ استخدم فحصاً جديداً أو إجراءً تصحيحياً مدققاً.');
            }
        });
        static::deleting(fn () => throw new LogicException('لا يحذف فحص السلامة حفاظاً على الأثر والامتثال.'));
    }

    public function station(): BelongsTo { return $this->belongsTo(FuelStation::class, 'fuel_station_id'); }
    public function inspector(): BelongsTo { return $this->belongsTo(User::class, 'inspector_id'); }
    public function verifier(): BelongsTo { return $this->belongsTo(User::class, 'verified_by'); }
    public function findings(): HasMany { return $this->hasMany(FuelStationSafetyFinding::class); }

    public static function nextNumber(?string $date = null, string|null|false $branchId = false): string
    {
        return static::nextDocumentNumber('FSIN', $date ?? now()->toDateString(), $branchId);
    }
}
