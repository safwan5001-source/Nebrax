<?php

namespace App\Models;

use App\Tenancy\BelongsToBranch;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/**
 * تسوية وقود immutable بعد الاعتماد. لقطة الكميات والتكلفة والمخزن تمنع تغير
 * المعنى التاريخي عند تعديل إعداد المحطة أو متوسط تكلفة المنتج لاحقاً.
 */
class FuelReconciliation extends BaseModel
{
    use BelongsToBranch;

    public const STATUS_DRAFT = 'draft';
    public const STATUS_APPROVED = 'approved';
    public const STATUSES = [self::STATUS_DRAFT, self::STATUS_APPROVED];

    protected $fillable = [
        'tenant_id', 'branch_id', 'fuel_station_id', 'fuel_tank_id', 'fuel_product_id', 'warehouse_id', 'status',
        'opening_book_milliliters', 'deliveries_milliliters', 'sales_milliliters', 'transfers_milliliters',
        'prior_adjustments_milliliters', 'expected_closing_milliliters', 'physical_closing_milliliters',
        'atg_closing_milliliters', 'variance_milliliters', 'variance_basis_points',
        'tolerance_absolute_milliliters', 'tolerance_basis_points', 'requires_approval',
        'unit_cost_minor', 'financial_variance_minor', 'physical_reading_id', 'atg_reading_id',
        'stock_movement_id', 'journal_entry_id', 'created_by', 'approved_by', 'approved_at', 'reason',
    ];

    protected $casts = [
        'opening_book_milliliters' => 'integer', 'deliveries_milliliters' => 'integer', 'sales_milliliters' => 'integer',
        'transfers_milliliters' => 'integer', 'prior_adjustments_milliliters' => 'integer', 'expected_closing_milliliters' => 'integer',
        'physical_closing_milliliters' => 'integer', 'atg_closing_milliliters' => 'integer', 'variance_milliliters' => 'integer',
        'variance_basis_points' => 'integer', 'tolerance_absolute_milliliters' => 'integer', 'tolerance_basis_points' => 'integer',
        'requires_approval' => 'boolean', 'unit_cost_minor' => 'integer', 'financial_variance_minor' => 'integer',
        'approved_at' => 'datetime',
    ];

    protected $attributes = ['status' => self::STATUS_DRAFT, 'requires_approval' => true];

    protected static function booted(): void
    {
        static::updating(function (self $reconciliation): void {
            if ($reconciliation->getOriginal('status') === self::STATUS_APPROVED) {
                throw new LogicException('Approved fuel reconciliations are immutable. Use a correction workflow.');
            }

            if ($reconciliation->status !== self::STATUS_APPROVED) {
                throw new LogicException('Fuel reconciliations can only change through explicit approval.');
            }

            $allowed = [
                'status', 'unit_cost_minor', 'financial_variance_minor', 'stock_movement_id',
                'journal_entry_id', 'approved_by', 'approved_at', 'reason', 'updated_at',
            ];
            if (array_diff(array_keys($reconciliation->getDirty()), $allowed) !== []) {
                throw new LogicException('Approval cannot alter the reconciliation evidence or snapshots.');
            }
        });
        static::deleting(function (self $reconciliation): void {
            if (! $reconciliation->isDraft()) {
                throw new LogicException('Approved fuel reconciliations cannot be deleted.');
            }
        });
    }

    public function station(): BelongsTo { return $this->belongsTo(FuelStation::class, 'fuel_station_id'); }
    public function tank(): BelongsTo { return $this->belongsTo(FuelTank::class, 'fuel_tank_id'); }
    public function fuelProduct(): BelongsTo { return $this->belongsTo(FuelProduct::class); }
    public function warehouse(): BelongsTo { return $this->belongsTo(Warehouse::class); }
    public function physicalReading(): BelongsTo { return $this->belongsTo(FuelTankReading::class, 'physical_reading_id'); }
    public function atgReading(): BelongsTo { return $this->belongsTo(FuelTankReading::class, 'atg_reading_id'); }
    public function stockMovement(): BelongsTo { return $this->belongsTo(StockMovement::class); }
    public function journalEntry(): BelongsTo { return $this->belongsTo(JournalEntry::class); }
    public function creator(): BelongsTo { return $this->belongsTo(User::class, 'created_by'); }
    public function approver(): BelongsTo { return $this->belongsTo(User::class, 'approved_by'); }
    public function isDraft(): bool { return $this->status === self::STATUS_DRAFT; }
}
