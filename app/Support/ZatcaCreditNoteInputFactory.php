<?php

namespace App\Support;

use App\Models\CreditNote;
use App\Models\Invoice;
use Carbon\CarbonInterface;
use InvalidArgumentException;

/**
 * يحوّل إشعاراً دائناً **مرحَّلاً** وفاتورته الأصلية إلى `ZatcaCreditNoteInput` — REM-18a. قراءة فقط: لا حفظ ولا قفل ولا
 * استعلام إضافي ولا تعديل لأيٍّ من النموذجين (الفاتورة الأصلية وإشعارها يبقيان كما هما بايتاً ببايت).
 *
 * لا يستنتج شيئاً: تصنيف المستند من `zatca_document_type` المخزَّن في الفاتورة (مجهول/فارغ ⇒ رفض)، ولقطة الطرفين هي لقطة
 * الفاتورة الأصلية نفسها (غائبة ⇒ رفض، لا التقاط حيّ — القرار D5 مفتوح)، والسبب رمزٌ صريح من المستدعي (نصّ `reason` الحرّ
 * القائم لا يُربط ولا يُقتبس)، والمبالغ كما خزّنها `CreditNoteService` (سعر الوحدة قبل الضريبة `unit_price_before_tax`
 * مطلوب فلا يُستخرج من سعر شامل). UUID وICV وPIH ولحظة الإصدار تأتي من المستدعي؛ تخصيصها وتخزينها (REM-18b) خارج النطاق.
 *
 * يرفض: إشعار المشتريات (`type=purchase`)، غير المرحَّل، غير المرتبط بهذه الفاتورة بالذات، الفاتورة غير المرحَّلة، طرفاً
 * مختلفاً، ومستأجراً مختلفاً.
 */
final class ZatcaCreditNoteInputFactory
{
    public static function fromPostedNote(
        CreditNote $note,
        Invoice $source,
        string $uuid,
        int $icv,
        string $previousHash,
        CarbonInterface $issuedAt,
        string $reasonCode,
    ): ZatcaCreditNoteInput {
        if ($note->type !== 'sales') {
            throw new InvalidArgumentException('إشعار المشتريات مستند من جهة المشتري وليس إشعاراً صادراً عن البائع؛ لا يُولَّد له XML لـ ZATCA.');
        }
        if ($note->status !== 'posted') {
            throw new InvalidArgumentException('لا يُولَّد XML إلا لإشعار مرحَّل.');
        }
        if ($note->original_invoice_id === null || $note->original_invoice_id !== $source->id) {
            throw new InvalidArgumentException('الإشعار غير مرتبط بالفاتورة الأصلية المُمرَّرة؛ المرجع (BT-25) إلزامي ولا يُخمَّن.');
        }
        if (! $source->isPosted()) {
            throw new InvalidArgumentException('الفاتورة الأصلية غير مرحَّلة.');
        }
        if ($source->partner_id !== $note->partner_id || $source->tenant_id !== $note->tenant_id) {
            throw new InvalidArgumentException('الفاتورة الأصلية لا تخصّ عميل الإشعار أو مؤسسته.');
        }

        $lines = [];
        foreach ($note->lines as $line) {
            if ($line->unit_price_before_tax === null) {
                throw new InvalidArgumentException('سطر الإشعار بلا سعر وحدة قبل الضريبة؛ لا يُشتق من سعر قد يكون شاملاً.');
            }
            $lines[] = new ZatcaCreditNoteLine(
                $line->description,
                (int) $line->quantity,
                (int) $line->unit_price_before_tax,
                (int) $line->tax_rate,
                (int) $line->line_subtotal,
                (int) $line->line_discount,
                (int) $line->line_tax,
                (int) $line->line_total,
            );
        }

        return new ZatcaCreditNoteInput(
            (string) $note->number,
            $uuid,
            $icv,
            $previousHash,
            $issuedAt,
            (string) $source->zatca_document_type,
            $source->party_snapshot,
            (string) $source->number,
            $reasonCode,
            (string) $note->refund_type,
            (int) $note->subtotal,
            (int) $note->tax_amount,
            (int) $note->total,
            $lines,
        );
    }
}
