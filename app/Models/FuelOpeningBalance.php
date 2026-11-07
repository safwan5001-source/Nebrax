<?php

namespace App\Models;

use App\Support\GeneratesDocumentNumbers;
use App\Tenancy\BranchScoped;
use App\Tenancy\ResolvesBranchReferences;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use LogicException;

/**
 * FUEL-TANKS-V2 / PR-1 — مستند رصيد افتتاحي للوقود: مسودة ← مرحَّل (محطة واحدة).
 *
 * المسودة لا أثر لها على المخزون أو الدفتر أو الحسابات. الأثر يُنتَج مرة واحدة عند الترحيل عبر
 * `FuelOpeningBalanceService::post` فقط (الخدمة هي الكاتب الوحيد للحالة والقيد). المستند المرحَّل ثابت: لا تعديل ولا حذف؛
 * التصحيح بقيد عكسي حسب سياسة المحاسبة، لا بتعديل المستند.
 */
class FuelOpeningBalance extends BaseModel
{
    use BranchScoped;
    use GeneratesDocumentNumbers;
    use ResolvesBranchReferences;

    public const STATUS_DRAFT = 'draft';
    public const STATUS_POSTED = 'posted';

    protected $fillable = [
        'tenant_id', 'branch_id', 'fuel_station_id', 'warehouse_id', 'number', 'opening_date', 'status', 'notes',
        'allow_zero_cost', 'idempotency_key', 'request_hash', 'total_milliliters', 'total_value_minor',
        'journal_entry_id', 'created_by', 'posted_by', 'posted_at',
    ];

    protected $casts = [
        'opening_date' => 'date',
        'allow_zero_cost' => 'boolean',
        'total_milliliters' => 'integer',
        'total_value_minor' => 'integer',
        'posted_at' => 'datetime',
    ];

    protected $attributes = [
        'status' => self::STATUS_DRAFT,
        'allow_zero_cost' => false,
        'total_milliliters' => 0,
    ];

    protected static function booted(): void
    {
        static::updating(function (self $document): void {
            if ($document->getOriginal('status') === self::STATUS_POSTED) {
                throw new LogicException('رصيد الوقود الافتتاحي المرحَّل ثابت؛ لا يُعدَّل. صحّحه بمستند أو قيد عكسي معتمد.');
            }
        });
        static::deleting(function (self $document): void {
            if ($document->status === self::STATUS_POSTED) {
                throw new LogicException('رصيد الوقود الافتتاحي المرحَّل لا يُحذف.');
            }
        });
    }

    public function isDraft(): bool { return $this->status === self::STATUS_DRAFT; }
    public function isPosted(): bool { return $this->status === self::STATUS_POSTED; }

    public function lines(): HasMany { return $this->hasMany(FuelOpeningBalanceLine::class)->orderBy('position'); }
    public function station(): BelongsTo { return $this->referenceBelongsTo(FuelStation::class, 'fuel_station_id'); }
    public function warehouse(): BelongsTo { return $this->referenceBelongsTo(Warehouse::class); }
    public function journalEntry(): BelongsTo { return $this->referenceBelongsTo(JournalEntry::class); }
    public function creator(): BelongsTo { return $this->referenceBelongsTo(User::class, 'created_by'); }
    public function poster(): BelongsTo { return $this->referenceBelongsTo(User::class, 'posted_by'); }
}
