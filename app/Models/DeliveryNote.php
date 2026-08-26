<?php

namespace App\Models;

use App\Support\GeneratesDocumentNumbers;
use App\Tenancy\BranchScoped;
use App\Tenancy\ResolvesBranchReferences;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use LogicException;

/**
 * سند تسليم مبيعات تشغيلي عام. لا ينشئ بنفسه فاتورة أو حركة مخزون أو قيداً.
 * كل انتقال حالة يمر عبر DeliveryNoteService داخل withWorkflowMutation().
 */
class DeliveryNote extends BaseModel
{
    use BranchScoped;
    use GeneratesDocumentNumbers;
    use ResolvesBranchReferences;

    public const STATUS_DRAFT = 'draft';
    public const STATUS_CONFIRMED = 'confirmed';
    public const STATUS_CANCELLED = 'cancelled';
    public const STATUSES = [self::STATUS_DRAFT, self::STATUS_CONFIRMED, self::STATUS_CANCELLED];

    /** @var array<int, string> */
    private const WORKFLOW_FIELDS = [
        'status', 'version', 'confirmed_by', 'confirmed_at',
        'cancelled_by', 'cancelled_at', 'cancellation_reason',
    ];

    private static bool $workflowMutationAllowed = false;

    protected $fillable = [
        'tenant_id', 'branch_id', 'number', 'external_reference', 'customer_id', 'warehouse_id',
        'delivery_date', 'status', 'notes', 'version', 'created_by',
        'confirmed_by', 'confirmed_at', 'cancelled_by', 'cancelled_at', 'cancellation_reason',
    ];

    protected $casts = [
        'delivery_date' => 'date',
        'version' => 'integer',
        'confirmed_at' => 'datetime',
        'cancelled_at' => 'datetime',
    ];

    protected $attributes = [
        'status' => self::STATUS_DRAFT,
        'version' => 1,
    ];

    protected static function booted(): void
    {
        static::creating(function (self $note): void {
            if ($note->status !== self::STATUS_DRAFT || (int) $note->version !== 1
                || $note->confirmed_by !== null || $note->confirmed_at !== null
                || $note->cancelled_by !== null || $note->cancelled_at !== null
                || $note->cancellation_reason !== null) {
                throw new LogicException('سند التسليم يبدأ مسودة فقط عبر خدمة سندات التسليم.');
            }
        });

        static::updating(function (self $note): void {
            if (! self::$workflowMutationAllowed
                && array_intersect(array_keys($note->getDirty()), self::WORKFLOW_FIELDS) !== []) {
                throw new LogicException('حالة سند التسليم ونسخته وحقول القرار لا تتغير إلا عبر خدمة سندات التسليم.');
            }
        });

        static::deleting(function (self $note): void {
            if (! $note->isDraft()) {
                throw new LogicException('لا يمكن حذف سند تسليم مؤكد أو ملغى؛ استخدم الإلغاء للحفاظ على سجل التدقيق.');
            }
        });
    }

    /** @template T @param callable(): T $callback @return T */
    public static function withWorkflowMutation(callable $callback): mixed
    {
        if (self::$workflowMutationAllowed) {
            return $callback();
        }

        self::$workflowMutationAllowed = true;
        try {
            return $callback();
        } finally {
            self::$workflowMutationAllowed = false;
        }
    }

    public function customer(): BelongsTo
    {
        return $this->referenceBelongsTo(Partner::class, 'customer_id');
    }

    public function warehouse(): BelongsTo
    {
        return $this->referenceBelongsTo(Warehouse::class);
    }

    public function creator(): BelongsTo
    {
        return $this->referenceBelongsTo(User::class, 'created_by');
    }

    public function confirmer(): BelongsTo
    {
        return $this->referenceBelongsTo(User::class, 'confirmed_by');
    }

    public function canceller(): BelongsTo
    {
        return $this->referenceBelongsTo(User::class, 'cancelled_by');
    }

    public function lines(): HasMany
    {
        return $this->hasMany(DeliveryNoteLine::class)->orderBy('line_number');
    }

    public function events(): HasMany
    {
        return $this->hasMany(DeliveryNoteEvent::class)->orderBy('occurred_at')->orderBy('id');
    }

    public function isDraft(): bool
    {
        return $this->status === self::STATUS_DRAFT;
    }

    public function isConfirmed(): bool
    {
        return $this->status === self::STATUS_CONFIRMED;
    }

    public function isCancelled(): bool
    {
        return $this->status === self::STATUS_CANCELLED;
    }
}
