<?php

namespace App\Services\Accounting;

use App\Models\Invoice;
use App\Models\ZatcaChain;
use App\Models\ZatcaChainEntry;
use App\Support\ZatcaIntegrityException;
use App\Tenancy\TenantContext;
use Throwable;

/**
 * حارس سلامة المستند الصادر قبل أي إرسال إلى ZATCA — فشل مغلق، قراءة فقط (لا يكتب ولا يُصلح شيئاً).
 *
 * لفاتورة صدرت عبر السلسلة المشتركة (لها مدخل `zatca_chain_entries`) يجب أن يتطابق **كل** ما يلي:
 *   1. هاش XML المحفوظ بالتحويل الرسمي نفسه (`ZatcaInvoiceHasher`، لا خوارزمية جديدة) = هاش المدخل الثابت.
 *   2. العمود `invoices.zatca_hash` = هاش المدخل.
 *   3. هوية المستند: المستأجر والفاتورة ونوع المستند والسلسلة، وICV وUUID والهاش السابق (PIH) بين الفاتورة والمدخل.
 * المدخل غير قابل للتعديل في القاعدة (T1–T3) فهو المرجع؛ أما `zatca_xml` و`zatca_hash` فقابلان للكتابة عمداً
 * (مسار الإرسال يكتب `zatca_cleared_xml`، وتجميدهما قرار منفصل)، وهذا الحارس هو ما يمنع وصول نسخة معدَّلة منهما إلى النقل.
 * XML المضمَّن (ICV/PIH/UUID) مغطّى بالهاش الرسمي نفسه فلا يُستخرج ويُقارَن ثانيةً.
 *
 * ═══ فواتير ما قبل السلسلة (سلوك قديم محفوظ) ═══
 * فاتورة بلا مدخل وبلا رأس سلسلة لمستأجرها، أو ICV لها ≤ بذرة الرأس، تُعامَل قديمة: **لا يُشترط لها مدخل ولا يُعاد تفسير
 * هاشها الخام** (قد يخالف هاش XML مشروعاً، REM-17) — فلا تُفحَص هنا، وتبقى حمايتها فحوص مسار الإرسال القائمة وحدها
 * (`request_hash` لما بعد تسجيل المحاولة). المخاطرة المتبقية موثّقة في تقرير الشريحة.
 * أما فاتورة بلا مدخل وICV لها > البذرة في مستأجر له رأس فمستحيلة بحكم السياج F1، فتُرفض إن وُجدت.
 */
final class ZatcaIssuedDocumentIntegrity
{
    public const CHAIN = 'chain';

    public const LEGACY = 'legacy';

    public function __construct(
        private readonly ZatcaInvoiceHasher $hasher,
        private readonly TenantContext $tenantContext,
    ) {}

    /**
     * @return string `self::CHAIN` (تحقق كامل) أو `self::LEGACY` (فاتورة سابقة للسلسلة، لا مدخل مطلوب).
     *
     * @throws ZatcaIntegrityException
     */
    public function assertIntact(Invoice $invoice): string
    {
        // الاستعلامات أدناه ضمن نطاق المستأجر الحالي؛ سياق مختلف كان سيُخفي المدخل فيُعامَل المستند قديماً — فشل مغلق بدلاً من ذلك.
        if ($invoice->tenant_id === null || $this->tenantContext->id() !== $invoice->tenant_id) {
            throw new ZatcaIntegrityException('tenant_context');
        }

        $entry = ZatcaChainEntry::query()->where('invoice_id', $invoice->id)->first();
        if ($entry === null) {
            $this->assertLegacy($invoice);

            return self::LEGACY;
        }

        $this->assertEntryBelongsToInvoice($entry, $invoice);
        $this->assertChainIdentity($entry, $invoice);
        $this->assertHashes($entry, $invoice);

        return self::CHAIN;
    }

    /** بلا مدخل: قديمة فقط إن لم يكن لمستأجرها رأس سلسلة تغطّي ICV الفاتورة. */
    private function assertLegacy(Invoice $invoice): void
    {
        $icv = $invoice->zatca_icv;
        if ($icv === null) {
            return;
        }

        $head = ZatcaChain::query()
            ->where('tenant_id', $invoice->tenant_id)
            ->where('chain_key', ZatcaChainAllocator::CHAIN_KEY)
            ->first();
        if ($head !== null && (int) $icv > (int) $head->seed_icv) {
            throw new ZatcaIntegrityException('entry_missing');
        }
    }

    private function assertEntryBelongsToInvoice(ZatcaChainEntry $entry, Invoice $invoice): void
    {
        if ($entry->tenant_id !== $invoice->tenant_id) {
            throw new ZatcaIntegrityException('entry_tenant');
        }
        if ($entry->document_type !== 'invoice'
            || $entry->type_code !== '388'
            || $entry->invoice_id !== $invoice->id
            || $entry->credit_note_id !== null) {
            throw new ZatcaIntegrityException('entry_document');
        }

        $chain = ZatcaChain::query()->whereKey($entry->chain_id)->first();
        if ($chain === null
            || $chain->tenant_id !== $invoice->tenant_id
            || $chain->chain_key !== ZatcaChainAllocator::CHAIN_KEY
            || $entry->icv <= (int) $chain->seed_icv
            || $entry->icv > (int) $chain->last_icv) {
            throw new ZatcaIntegrityException('entry_chain');
        }
    }

    private function assertChainIdentity(ZatcaChainEntry $entry, Invoice $invoice): void
    {
        if ($invoice->zatca_icv === null || (int) $invoice->zatca_icv !== $entry->icv) {
            throw new ZatcaIntegrityException('icv_mismatch');
        }
        if (! $this->same($entry->zatca_uuid, $invoice->zatca_uuid)) {
            throw new ZatcaIntegrityException('uuid_mismatch');
        }
        if (! $this->same($entry->previous_hash, $invoice->zatca_previous_hash)) {
            throw new ZatcaIntegrityException('pih_mismatch');
        }
    }

    private function assertHashes(ZatcaChainEntry $entry, Invoice $invoice): void
    {
        if (! $this->same($entry->hash, $invoice->zatca_hash)) {
            throw new ZatcaIntegrityException('hash_column_mismatch');
        }

        $xml = $invoice->zatca_xml;
        if (! is_string($xml) || trim($xml) === '') {
            throw new ZatcaIntegrityException('xml_missing');
        }
        try {
            $computed = $this->hasher->hash($xml);
        } catch (Throwable) {
            throw new ZatcaIntegrityException('xml_unreadable');
        }
        if (! hash_equals((string) $entry->hash, $computed)) {
            throw new ZatcaIntegrityException('xml_hash_mismatch');
        }
    }

    private function same(mixed $expected, mixed $actual): bool
    {
        return is_string($expected) && $expected !== '' && is_string($actual) && hash_equals($expected, $actual);
    }
}
