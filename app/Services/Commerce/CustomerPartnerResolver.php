<?php

namespace App\Services\Commerce;

use App\Models\CommerceOrder;
use App\Models\Partner;
use App\Services\Accounting\PartnerService;
use App\Support\CommercePartnerPolicy;
use App\Support\ContactKey;
use App\Tenancy\BranchScope;
use App\Tenancy\CustomerContext;
use App\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * ═══════════════════════════════════════════════════════════════
 *  ربط مشتري المتجر بطرف محاسبي — H4-01 (D-05 المعتمد: link_verified_else_create، قابل للضبط)
 * ═══════════════════════════════════════════════════════════════
 *  الدفع الإلكتروني يُرحَّل بسند قبض يتطلب طرفاً (`PaymentService`/`InvoiceService`)؛ ضيف المتجر بلا طرف. هذه الخدمة تحسم الطرف **عند إنشاء نية
 *  الدفع الإلكتروني فقط** (لا يتغيّر COD/الاستلام ولا الطلبات القائمة)، وفق `sales.commerce_partner_policy` (`CommercePartnerPolicy`).
 *
 *  • **لا دمج ولا مطابقة مع أطراف الموظفين:** بيانات الضيف غير موثَّقة، فمطابقتها مع طرف قائم تسمح لمنتحل رقم عميل بتسجيل مشترياته على ذمته. الطرف
 *    الآلي مفتاحه حتمي في `partners.code` (`WEB-` + 16 خانة من SHA-256 لـ(المستأجر، مفتاح الاتصال))، فتتقارب الطلبات المتكررة لنفس الهاتف/البريد
 *    على طرف «ويب» واحد، ويحرس القيد الفريد `(tenant_id, code)` أي سباق. هوية العميل المربوطة بطرف (ربط موظف) تتقدّم دوماً.
 *  • **المفتاح:** هوية موثَّقة (إن وُجد `CustomerContext`) ← هاتف مطبَّع ← بريد مطبَّع ← معرّف الطلب (طرف لكل طلب بلا بيانات اتصال).
 *  • **التزامن:** قفل استشاري على PostgreSQL (`pg_advisory_xact_lock`) حول البحث+الإنشاء داخل معاملة الإتمام نفسها؛ لا يُلتقط خطأ تفرّد داخل معاملة
 *    PostgreSQL (تُسمَّم). على SQLite الكتابة متسلسلة.
 *  • طرف «ويب» محذوف ناعماً يُستعاد؛ طرف معطَّل ⇒ رفض الإتمام (لا طلب لعميل أوقفه التاجر).
 */
final class CustomerPartnerResolver
{
    public const CODE_PREFIX = 'WEB-';

    public const GENERIC_CODE = 'WEB-GENERIC';

    public function __construct(
        private readonly PartnerService $partners,
        private readonly TenantContext $tenant,
    ) {}

    /** الطرف الذي يُسجَّل عليه الطلب وفق السياسة؛ null ⇒ `manual_link` (لا طرف آلي). يجب استدعاؤه داخل معاملة (معاملة الإتمام). */
    public function resolveForOrder(CommerceOrder $order): ?Partner
    {
        $tenantId = $this->tenant->id() ?? throw new RuntimeException('لا سياق مستأجر نشط.');

        return match (CommercePartnerPolicy::configured()) {
            CommercePartnerPolicy::MANUAL_LINK => null,
            CommercePartnerPolicy::GENERIC_CASH_CUSTOMER => $this->findOrCreate($tenantId, self::GENERIC_CODE, [
                'name' => 'عميل المتجر الإلكتروني',
                'name_en' => 'Online store customer',
            ]),
            default => $this->resolveLinkedOrAutomatic($order, $tenantId),
        };
    }

    private function resolveLinkedOrAutomatic(CommerceOrder $order, string $tenantId): Partner
    {
        $context = app(CustomerContext::class);
        $identityId = $context->isEstablished() && $context->tenantId() === $tenantId ? $context->customerIdentityId() : null;

        // ربط موظف قائم لهوية موثَّقة يتقدّم (طرف نشط من نوع عميل).
        if ($identityId !== null && $context->linkedPartnerId() !== null) {
            $linked = Partner::query()->withoutGlobalScope(BranchScope::class)->find($context->linkedPartnerId());
            if ($linked !== null && $linked->is_active && $linked->isCustomer()) {
                return $linked;
            }
        }

        $snapshot = $order->snapshot ?? $order->loadMissing('snapshot')->snapshot;
        $phone = ContactKey::phone($snapshot?->phone);
        $email = ContactKey::email($snapshot?->email);
        $key = match (true) {
            $identityId !== null => 'i:'.$identityId,
            $phone !== null => 'p:'.$phone,
            $email !== null => 'e:'.$email,
            default => 'o:'.$order->getKey(),
        };

        return $this->findOrCreate($tenantId, self::CODE_PREFIX.strtoupper(substr(hash('sha256', $tenantId.'|'.$key), 0, 16)), array_filter([
            'name' => $snapshot?->customer_name ?: 'عميل المتجر الإلكتروني',
            'phone' => $snapshot?->phone,
            'email' => $email,
            'country' => $snapshot?->shipping_country,
            'city' => $snapshot?->shipping_city,
            'district' => $snapshot?->shipping_district,
            'street' => $snapshot?->shipping_street,
            'postal_code' => $snapshot?->shipping_postal_code,
        ], fn ($v) => $v !== null && $v !== ''));
    }

    /** @param array<string, mixed> $attributes */
    private function findOrCreate(string $tenantId, string $code, array $attributes): Partner
    {
        if (DB::transactionLevel() < 1) {
            throw new RuntimeException('يجب حسم الطرف داخل معاملة الإتمام.');
        }
        if (DB::getDriverName() === 'pgsql') {
            DB::select('select pg_advisory_xact_lock(hashtextextended(?, 0))', ['partner-resolve:'.$tenantId.':'.$code]);
        }

        $partner = Partner::query()->withoutGlobalScope(BranchScope::class)->withTrashed()->where('code', $code)->first();
        if ($partner !== null) {
            if ($partner->trashed()) {
                $partner->restore();
            }
            if (! $partner->is_active || ! $partner->isCustomer()) {
                throw new RuntimeException('حساب العميل غير نشط؛ لا يمكن إتمام الطلب.');
            }

            return $partner;
        }

        return $this->partners->create($attributes + [
            'code' => $code,
            'type' => 'customer',
            'entity_type' => 'individual',
            'is_active' => true,
        ]);
    }
}
