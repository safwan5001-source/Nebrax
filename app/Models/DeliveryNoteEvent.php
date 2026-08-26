<?php

namespace App\Models;

use App\Tenancy\BranchContext;
use App\Tenancy\BranchScoped;
use App\Tenancy\ResolvesBranchReferences;
use App\Tenancy\TenantContext;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/** سجل منقح لا يقبل التعديل أو الحذف لكل حدث مهم في دورة سند التسليم. */
class DeliveryNoteEvent extends BaseModel
{
    use BranchScoped;
    use ResolvesBranchReferences;

    public $timestamps = false;

    protected $guarded = ['id'];

    private static bool $appendAllowed = false;

    protected $casts = [
        'metadata' => 'array',
        'occurred_at' => 'immutable_datetime',
    ];

    protected static function booted(): void
    {
        static::creating(function (self $event): void {
            if (! self::$appendAllowed) {
                throw new LogicException('أحداث سندات التسليم لا تضاف إلا من خدمة سندات التسليم.');
            }

            $tenant = app(TenantContext::class);
            $branch = app(BranchContext::class);
            if (! $tenant->has() || ! $branch->has()) {
                throw new LogicException('أحداث سند التسليم تتطلب سياق مستأجر وفرع موثوقين.');
            }

            $note = DeliveryNote::query()->findOrFail($event->delivery_note_id);
            if ($note->tenant_id !== $tenant->id() || $note->branch_id !== $branch->id()) {
                throw new LogicException('نطاق حدث سند التسليم يجب أن يطابق رأس السند.');
            }

            $event->tenant_id = $tenant->id();
            $event->branch_id = $branch->id();
        });
        static::updating(fn () => throw new LogicException('أحداث سندات التسليم لا تعدل.'));
        static::deleting(fn () => throw new LogicException('أحداث سندات التسليم لا تحذف.'));
    }

    /** @template T @param callable(): T $callback @return T */
    public static function withAppend(callable $callback): mixed
    {
        if (self::$appendAllowed) {
            return $callback();
        }

        self::$appendAllowed = true;
        try {
            return $callback();
        } finally {
            self::$appendAllowed = false;
        }
    }

    public function deliveryNote(): BelongsTo
    {
        return $this->belongsTo(DeliveryNote::class);
    }

    public function actor(): BelongsTo
    {
        return $this->referenceBelongsTo(User::class, 'actor_id');
    }
}
