<?php

namespace App\Services\Accounting;

use App\Models\CreditNote;
use App\Models\Invoice;
use App\Models\Purchase;
use RuntimeException;

/**
 * يحافظ على ملكية الإشعار عند كل حد ثقة: المصدر المخزّن يسبق دائماً النوع
 * المطلوب أو المخزّن. لا يصلح صفاً متناقضاً بصمت لأن ذلك قد يخفي أثراً
 * محاسبياً أو قرار تطبيق خاطئاً.
 */
final class CreditNoteOwnershipResolver
{
    public const SALES = 'sales';
    public const PURCHASE = 'purchase';

    /** @param array{original_purchase_id?:?string,original_invoice_id?:?string,type?:?string} $data */
    public function forData(array $data): string
    {
        return $this->resolve(
            $data['original_purchase_id'] ?? null,
            $data['original_invoice_id'] ?? null,
            $data['type'] ?? null,
        );
    }

    public function forNote(CreditNote $note): string
    {
        return $this->resolve(
            $note->original_purchase_id,
            $note->original_invoice_id,
            $note->type,
        );
    }

    private function resolve(?string $purchaseId, ?string $invoiceId, ?string $type): string
    {
        if ($purchaseId !== null && $invoiceId !== null) {
            throw new RuntimeException('لا يجوز ربط الإشعار بفاتورة ومشتريات معاً.');
        }

        if ($purchaseId !== null) {
            // lookup طبيعي تحت TenantScope: المعرّف الأجنبي لا يكشف وجوده.
            Purchase::findOrFail($purchaseId);
            $this->assertType($type, self::PURCHASE);

            return self::PURCHASE;
        }

        if ($invoiceId !== null) {
            // lookup طبيعي تحت TenantScope: المعرّف الأجنبي لا يكشف وجوده.
            Invoice::findOrFail($invoiceId);
            $this->assertType($type, self::SALES);

            return self::SALES;
        }

        if (! in_array($type, [self::SALES, self::PURCHASE], true)) {
            throw new RuntimeException('نوع الإشعار المستقل مطلوب.');
        }

        return $type;
    }

    private function assertType(?string $type, string $sourceType): void
    {
        if ($type !== null && $type !== $sourceType) {
            throw new RuntimeException('نوع الإشعار لا يطابق المستند المصدر.');
        }
    }
}
