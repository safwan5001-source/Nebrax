<?php

namespace App\Services;

use App\Models\DeliveryPlatformProfileVersion as Version;
use App\Tenancy\TenantContext;
use RuntimeException;

/**
 * DLV-FINANCIAL-ROLE-CONFIG-1 — بوابة إعداد فقط.
 *
 * `eligible` يعني أن الحقول الأربعة المخزّنة تطابق شكل فاتورة المطعم
 * المقبول في OD-DG-3-POSTING-GATE. لا يعني أن الترحيل مسموح.
 * `posting_authorized` يبقى false: لا نقطة ضريبة ولا أمر فاتورة في هذه الشريحة.
 * لا يستدعي InvoiceService ولا ينشئ فاتورة أو سنداً أو قيداً أو حركة مخزون.
 */
final class DeliveryFinancialRoleGate
{
    public const DECISION_ELIGIBLE = 'eligible';

    public const DECISION_BLOCKED = 'blocked';

    public function __construct(private readonly TenantContext $tenantContext)
    {
    }

    /** @return array{decision:string,posting_authorized:bool,reason_codes:list<string>} */
    public function evaluate(Version $version): array
    {
        $tenantId = $this->tenantContext->id();
        if ($tenantId === null || (string) $version->tenant_id !== (string) $tenantId) {
            throw new RuntimeException('نسخة الدور المالي غير متاحة للمؤسسة الحالية.');
        }

        $reasons = [];
        if ($version->selling_role === Version::SELLING_UNKNOWN) {
            $reasons[] = 'selling_role_unknown';
        } elseif ($version->selling_role === Version::SELLING_PLATFORM) {
            $reasons[] = 'platform_seller_blocked';
        }

        if ($version->invoice_responsibility === Version::INVOICE_UNKNOWN) {
            $reasons[] = 'invoice_responsibility_unknown';
        } elseif ($version->invoice_responsibility === Version::INVOICE_PLATFORM_AS_SUPPLIER) {
            $reasons[] = 'platform_issues_as_supplier_blocked';
        } elseif ($version->invoice_responsibility === Version::INVOICE_PLATFORM_ON_BEHALF) {
            $reasons[] = 'platform_on_behalf_blocked';
        }

        if ($version->collection_role === Version::COLLECTION_ROLE_UNKNOWN) {
            $reasons[] = 'collection_role_unknown';
        } elseif ($version->collection_role === Version::COLLECTION_ROLE_PLATFORM_AS_SELLER) {
            $reasons[] = 'platform_collects_as_seller_blocked';
        }

        if ($version->merchant_vat_status_at_supply === Version::VAT_UNKNOWN) {
            $reasons[] = 'merchant_vat_status_unknown';
        } elseif ($version->merchant_vat_status_at_supply === Version::VAT_NOT_REGISTERED) {
            $reasons[] = 'merchant_not_registered_blocked';
        }

        $compatible = $reasons === []
            && $version->selling_role === Version::SELLING_MERCHANT
            && $version->invoice_responsibility === Version::INVOICE_MERCHANT_ISSUES
            && in_array($version->collection_role, [
                Version::COLLECTION_ROLE_PLATFORM_FOR_MERCHANT,
                Version::COLLECTION_ROLE_MERCHANT,
            ], true)
            && $version->merchant_vat_status_at_supply === Version::VAT_REGISTERED;

        if (! $compatible) {
            if ($reasons === []) {
                $reasons[] = 'incompatible_combination';
            }

            return [
                'decision' => self::DECISION_BLOCKED,
                'posting_authorized' => false,
                'reason_codes' => $reasons,
            ];
        }

        return [
            'decision' => self::DECISION_ELIGIBLE,
            'posting_authorized' => false,
            'reason_codes' => ['configuration_compatible', 'posting_not_authorized'],
        ];
    }
}
