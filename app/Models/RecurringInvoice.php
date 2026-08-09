<?php

namespace App\Models;

use App\Tenancy\BranchScoped;
use App\Tenancy\ResolvesBranchReferences;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * فاتورة دورية (قالب + جدولة) — غير محاسبية. توليد فاتورة منها ينتج فاتورة
 * draft عبر InvoiceService. كل المبالغ بالهللات كـ bigint.
 */
/** @see design-system/foundations/multi-branch-architecture.md — تشغيلي: معزول بالفرع */
class RecurringInvoice extends BaseModel
{
    use ResolvesBranchReferences;
    use BranchScoped;

    protected $fillable = [
        'tenant_id', 'branch_id', 'title', 'partner_id', 'payment_type', 'frequency',
        'start_date', 'next_run_date', 'end_date', 'active', 'generated_count',
        'subtotal', 'tax_amount', 'total', 'notes', 'created_by',
    ];

    protected $casts = [
        'start_date'      => 'date',
        'next_run_date'   => 'date',
        'end_date'        => 'date',
        'active'          => 'boolean',
        'generated_count' => 'integer',
        'subtotal'        => 'integer',
        'tax_amount'      => 'integer',
        'total'           => 'integer',
    ];

    protected $attributes = [
        'payment_type'    => 'credit',
        'frequency'       => 'monthly',
        'active'          => true,
        'generated_count' => 0,
        'subtotal'        => 0,
        'tax_amount'      => 0,
        'total'           => 0,
    ];

    public function lines(): HasMany
    {
        return $this->hasMany(RecurringInvoiceLine::class);
    }

    /** مرجع مخزَّن — لا يُصفّى بالفرع أبداً (المستند حجّة قائمة، لا نتيجة تصفّح). */
    public function partner(): BelongsTo
    {
        return $this->referenceBelongsTo(Partner::class);
    }
}
