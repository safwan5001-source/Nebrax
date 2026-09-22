<?php

namespace App\Models;

use App\Support\GeneratesDocumentNumbers;
use App\Tenancy\CompanyWide;
use App\Tenancy\ResolvesBranchReferences;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
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
 *
 * `snapshot` (PR-COM-6C): لقطة العميل/الاتصال/الشحن/الفوترة وقت الطلب —
 * حجّة تاريخية اختيارية (صفرٌ أو سطرٌ واحد)، منفصلة تماماً عن الملكية
 * أعلاه. لا سلطة تفويضٍ فيها إطلاقاً — راجع `CommerceOrderSnapshot`.
 *
 * ═══════════════════════════════════════════════════════════════
 *  COM-CHECKOUT-1B — هويةٌ موحَّدة مع سلسلة Cart→Checkout→Order
 * ═══════════════════════════════════════════════════════════════
 * هذا النموذج نفسه هو الوجهة النهائية لـ`AWJ_CHECKOUT_V1_ARCHITECTURE.md §10`
 * — لا كيان Order ثانٍ (`AWJ_COMMERCE_ORDER_IDENTITY_DECISION_REPORT.md`،
 * القرار C: Unify/Migrate). `storefront_id`/`commerce_checkout_id`
 * (الفريد)/`delivery_method` أعمدةٌ إضافية بحتة — `null` دائماً لطلبات
 * المسار القديم (staff/trusted، PR-COM-5A/6A/6B). طلب Checkout يُنشأ عبر
 * `CommerceOrderService::createFromCheckout()` (مسارٌ مستقل تماماً عن
 * `create()` القديم، لا يغيّر سلوكه) **مباشرةً بحالة `confirmed` النهائية**
 * داخل معاملةٍ واحدة ذرّية مع سطوره ولقطته — `draft` يبقى حالةً داخلية
 * عابرة غير مرئية خارج تلك المعاملة، فلا حاجة لقيمة `status` جديدة ولا
 * لإعادة تفسير `confirmed` القديم: يعني تماماً ما كان يعنيه دوماً — التزامٌ
 * تجاريٌّ نهائي بلا أثرٍ محاسبي أو مخزني بعد، لكلا المصدرين.
 */
class CommerceOrder extends BaseModel implements CompanyWide
{
    use GeneratesDocumentNumbers;
    use ResolvesBranchReferences;

    public const STATUS_DRAFT = 'draft';

    public const STATUS_CONFIRMED = 'confirmed';

    protected $fillable = [
        'tenant_id', 'sales_channel_id', 'storefront_id', 'commerce_checkout_id',
        'partner_id', 'customer_identity_id', 'number', 'status', 'total', 'delivery_method',
        'delivery_amount_minor', 'confirmed_at',
    ];

    protected $casts = [
        'total' => 'integer',
        'delivery_amount_minor' => 'integer',
        'confirmed_at' => 'datetime',
    ];

    protected $attributes = [
        'status' => self::STATUS_DRAFT,
        'total' => 0,
        'delivery_amount_minor' => 0,
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

    /**
     * المتجر المصدر لطلب Checkout — `null` دائماً لطلبات المسار القديم
     * (staff/trusted) التي لا مصدر متجرٍ لها (COM-CHECKOUT-1B).
     */
    public function storefront(): BelongsTo
    {
        return $this->belongsTo(Storefront::class);
    }

    /**
     * جلسة الدفع المصدر — `null` دائماً لطلبات المسار القديم. الفريدة على
     * العمود (migration) تضمن طلباً واحداً كحدٍّ أقصى لكل Checkout.
     */
    public function checkout(): BelongsTo
    {
        return $this->belongsTo(CommerceCheckout::class, 'commerce_checkout_id');
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

    /** لقطة العميل/الاتصال/الشحن/الفوترة وقت الطلب (PR-COM-6C) — صفرٌ أو سطرٌ واحد. */
    public function snapshot(): HasOne
    {
        return $this->hasOne(CommerceOrderSnapshot::class);
    }

    public function isDraft(): bool
    {
        return $this->status === self::STATUS_DRAFT;
    }

    public function isConfirmed(): bool
    {
        return $this->status === self::STATUS_CONFIRMED;
    }

    /** COM-CHECKOUT-1B — طلبٌ أُنشئ عبر `createFromCheckout()`، لا المسار القديم. */
    public function originatesFromCheckout(): bool
    {
        return $this->commerce_checkout_id !== null;
    }
}
