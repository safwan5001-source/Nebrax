<?php

namespace App\Models;

use App\Support\GeneratesDocumentNumbers;
use App\Tenancy\CompanyWide;
use App\Tenancy\ResolvesBranchReferences;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use LogicException;

/**
 * ═══════════════════════════════════════════════════════════════
 *  سجلّ التزام تجاري — PR-COM-5A (ADR-01)
 * ═══════════════════════════════════════════════════════════════
 *
 * `CommerceOrder != Invoice`: لا أثر محاسبي أو مخزني عند الإنشاء أو التأكيد
 * (ADR-01 §2/§6). التأكيد التزامٌ تجاريٌّ فقط — لا حجز مخزون (PR-COM-5B)، لا
 * دفعة، لا فاتورة، لا قيد. راجع `App\Support\CommerceBoundary`.
 *
 * **`CompanyWide`**: بنفس تصنيف `SalesChannel`/`FulfillmentPolicy`/
 * `CommerceListing`/`InventoryReservation` أنفسهم — لا فرعاً بعينه.
 * `SalesChannel != Branch` (ADR-03 §1)، فالطلب يتبع قناته لا فرعاً تشغيلياً.
 *
 * `status`: بُعدان مستقلّان لم يُبنَيا بعد (الدفع والتنفيذ) لا يُضغَطان هنا
 * (ADR-01 §4) — هذا العمود يمثّل بُعد الطلب التجاري وحده: `draft`/`confirmed`.
 *
 * `customer_identity_id` (PR-COM-6B): مصدر الملكية الرقمية الوحيد —
 * `App\Tenancy\CustomerContext::customerIdentityId()` حين مُؤسَّساً، و`null`
 * دوماً للضيف/الطاقم. لا مُدخَل طالبٍ يصل إليه إطلاقاً؛ لا علاقة له بـ
 * `trustedPartnerSelection` (يبقى محصوراً بـ`partner_id` وحده). `Partner`
 * يبقى علاقةً تجاريةً وصفية — لا يمنح وصولاً لمورد بذاته.
 */
class CommerceOrder extends BaseModel implements CompanyWide
{
    use ResolvesBranchReferences;
    use GeneratesDocumentNumbers;

    public const STATUS_DRAFT = 'draft';

    public const STATUS_CONFIRMED = 'confirmed';

    protected $fillable = [
        'tenant_id', 'sales_channel_id', 'partner_id', 'customer_identity_id', 'number', 'status', 'total', 'confirmed_at',
    ];

    protected $casts = [
        'total' => 'integer',
        'confirmed_at' => 'datetime',
    ];

    protected $attributes = [
        'status' => self::STATUS_DRAFT,
        'total' => 0,
    ];

    /**
     * الحذف مسموحٌ للمسودة فقط (§28 — Deletion Semantics): طلبٌ مؤكَّد سجلٌّ
     * تاريخي («ما اتُّفق عليه») لا يُمحى، بنفس منطق حراسة `InvoiceLine` ضد
     * حذف سطرٍ مرتبط بسند تسليم — قرارٌ صريح لا صمتٌ على قيد قاعدة بيانات.
     */
    protected static function booted(): void
    {
        static::deleting(function (self $order): void {
            if ($order->status === self::STATUS_CONFIRMED) {
                throw new LogicException('لا يمكن حذف طلب Commerce مؤكَّد — هو سجلٌّ تاريخي لالتزامٍ تجاري.');
            }
        });
    }

    public function lines(): HasMany
    {
        return $this->hasMany(CommerceOrderLine::class);
    }

    public function salesChannel(): BelongsTo
    {
        return $this->belongsTo(SalesChannel::class);
    }

    /** مرجع مخزَّن اختياري — لا يُصفّى بالفرع أبداً (المستند حجّة قائمة، لا نتيجة تصفّح). */
    public function partner(): BelongsTo
    {
        return $this->referenceBelongsTo(Partner::class);
    }

    /**
     * مالك الطلب الرقمي (PR-COM-6B) — `CustomerIdentity` مُشترَكٌ لا يُصفّى
     * بالفرع (`CompanyWide` من أساسه)، فعلاقةٌ مباشرة تكفي دون `referenceBelongsTo`.
     */
    public function customerIdentity(): BelongsTo
    {
        return $this->belongsTo(CustomerIdentity::class);
    }

    public function isDraft(): bool
    {
        return $this->status === self::STATUS_DRAFT;
    }

    public function isConfirmed(): bool
    {
        return $this->status === self::STATUS_CONFIRMED;
    }
}
