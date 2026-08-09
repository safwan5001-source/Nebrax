<?php

namespace App\Models;

use App\Tenancy\BelongsToBranch;
use App\Tenancy\ResolvesBranchReferences;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * حركة مخزون (دخول/خروج/تسوية) — سجل دائم.
 * التكاليف بالـ minor units (هللات) كـ bigint.
 */
/**
 * @see design-system/foundations/multi-branch-architecture.md
 * موسومة بالفرع **بلا عزل**: الفرع بُعد للعرض، وتصفيتها التلقائية كانت ستكسر
 * حساب التقييم (المتوسط المتحرك عالمي على المنتج). الوسم من **فرع المخزن**
 * لا الفرع النشط — الحركة تخصّ المكان الذي خرجت منه البضاعة فعلاً.
 */
class StockMovement extends BaseModel
{
    use BelongsToBranch;
    use ResolvesBranchReferences;

    protected $fillable = [
        // `warehouse_id` كان ساقطاً من القائمة منذ إضافة المخازن، فكان يُحذف صامتاً
        // عند الإنشاء. بدونه لا يمكن للحركة أن تتبع فرع مخزنها أصلاً.
        'tenant_id', 'branch_id', 'warehouse_id', 'product_id', 'type', 'quantity',
        'unit_cost', 'total_cost', 'balance_quantity',
        'source_type', 'source_id', 'movement_date', 'notes',
    ];

    protected $casts = [
        'quantity'         => 'integer',
        'unit_cost'        => 'integer',
        'total_cost'       => 'integer',
        'balance_quantity' => 'integer',
        'movement_date'    => 'date',
    ];

    /** مرجع مخزَّن — لا يُصفّى بالفرع أبداً (وإلا تخطّى المسار المحاسبي السطرَ صامتاً). */
    public function product(): BelongsTo
    {
        return $this->referenceBelongsTo(Product::class);
    }
}
