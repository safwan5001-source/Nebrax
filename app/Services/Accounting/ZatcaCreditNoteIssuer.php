<?php

namespace App\Services\Accounting;

use App\Models\CreditNote;
use App\Models\Invoice;
use App\Models\ZatcaCredential;
use App\Support\ZatcaCreditNoteIneligibleException;
use App\Support\ZatcaCreditNoteInputFactory;
use App\Support\ZatcaCreditNoteXml;
use App\Support\ZatcaIssueTimestamp;
use App\Support\ZatcaPartyXml;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use InvalidArgumentException;
use LogicException;

/**
 * ═══════════════════════════════════════════════════════════════
 *  إصدار الإشعار الدائن الإلكتروني (381) عند الترحيل — REM-18b-3c
 * ═══════════════════════════════════════════════════════════════
 *  يُستدعى من `CreditNoteService::post()` **داخل معاملة الترحيل وبعد القيد المحاسبي** (فلا يمسّه ولا يعيد حساب شيء)، ويعيد أعمدة
 *  ZATCA التي يكتبها الاستدعاء في التحديث الواحد الذي يرحّل الإشعار. لا اتصال ولا إرسال: يُنتج مستنداً ويسجّله في السلسلة فقط.
 *
 *  التسلسل الذرّي (بعد قفل الإشعار ثم الفاتورة المصدر ثم مِرساة المستأجر في `LedgerService`):
 *    1) قراءة الحالة الفعّالة للتفعيل — **مرة واحدة، بعبارة واحدة، بلا قفل** (`ZatcaRolloutControlService`). تأتي قبل قفل رأس السلسلة
 *       لأن القفل نفسه لا يُؤخَذ إلا إن كان الإصدار قائماً؛ ولا أثر لموضعها على الأقفال لأنها بلا قفل.
 *    2) غير مفعَّل (لا ضابط، أو معطَّل، أو إيقاف طارئ للمنصة) ⇒ `null`: الترحيل القديم بلا أي قرار (سلوك ما قبل 3c بايتاً ببايت).
 *    3) مفعَّل ⇒ أهلية صارمة؛ غير المؤهَّل يرمي `ZatcaCreditNoteIneligibleException` ويتراجع الترحيل كاملاً (لا ترحيل صامت).
 *    4) `reserve()` (قفل رأس السلسلة) ← بناء XML/الهاش/QR/التوقيع ← `recordCreditNote()` (إدراج المدخل **قبل** تحديث الإشعار).
 *    5) يعيد الأعمدة؛ التحديث الواحد التالي (status=posted + هوية المستند) يرضي F2a (مدخل مطابق) وF2b (قرار صريح).
 *
 *  ما يحمي من السباق: ضوابط المستأجر تتغيّر خلف مِرساة المستأجر المقفولة هنا، والإيقاف الطارئ للمنصة غير مرتبط بمِرساة؛ فإن انقلبت الحالة
 *  بين قراءتنا وتحديث الإشعار يعيد السياج F2b تقييمها في عبارة التحديث نفسها (الفشل مغلق، المعاملة تتراجع). القرار الصريح `generated`
 *  مقبول في كل الحالات. سياسة الإيقاف الطارئ للمستأجر المفعَّل (الخيار B) **غير منفَّذة**: يُعامَل كغير مفعَّل (ترحيل قديم) كعقد 3a/3b.
 *
 *  الأهلية (كلها مطلوبة): مبيعات · استرداد نقدي `cash` (لا رمز دفع موثَّق لـ`credit` — D4) · فاتورة مصدر مرحَّلة · لقطة طرفين صالحة
 *  على الفاتورة المصدر · تصنيف standard|simplified · سطور تحقق منها `ZatcaCreditNoteInputFactory`. لا مستقل (BR-KSA-56) ولا مشتريات.
 *
 *  التوقيع: السياسة المعتمدة نفسها للفاتورة — لا اعتماد ⇒ مستأجر ما زال على المرحلة الأولى (QR فقط، `signed=false`)؛ وجود أي اعتماد ⇒
 *  `ZatcaSignedInvoiceFinalizer` الإنتاجي ويفشل مغلقاً عند أي نقص (سياسة/مفتاح/شهادة). لا توقيع بديل ولا عيّنات SDK.
 *
 *  سبب الإصدار (KSA-10): للاسترداد النقدي رمز واحد ثابت `goods_or_services_refund` — **قرار AWJ** لا قاعدة ZATCA مثبتة (تقرير 3c).
 */
final class ZatcaCreditNoteIssuer
{
    /** KSA-10 لإشعار استرداد نقدي من فاتورة مرحَّلة: «عند ترجيع السلع أو الخدمات». */
    public const CASH_REFUND_REASON = 'goods_or_services_refund';

    public function __construct(
        private readonly ZatcaRolloutControlService $rollout,
        private readonly ZatcaChainAllocator $chain,
        private readonly ZatcaInvoiceHasher $hasher,
        private readonly ZatcaSignedInvoiceFinalizer $finalizer,
        private readonly ZatcaService $zatca,
    ) {}

    /**
     * @param CreditNote $note   إشعار مبيعات: القيد المحاسبي صدر والإجماليات والحالة `posted` محمولة **في الذاكرة** (لم تُحفظ بعد)
     * @param Invoice|null $source الفاتورة المصدر المقفولة في `post()`؛ null للإشعار المستقل
     * @return array<string, mixed>|null أعمدة ZATCA للتحديث الواحد، أو null (غير مفعَّل: ترحيل قديم)
     */
    public function issue(CreditNote $note, ?Invoice $source): ?array
    {
        if (DB::transactionLevel() < 1) {
            throw new LogicException('إصدار الإشعار الدائن يجب أن يجري داخل معاملة الترحيل.');
        }
        if ($note->type !== 'sales') {
            return null;
        }

        $state = $this->rollout->effectiveForTenant((string) $note->tenant_id);
        if (! $state->enabled) {
            return null;
        }

        $this->assertEligible($note, $source);
        /** @var Invoice $source */
        $issuedAt = ZatcaIssueTimestamp::capture();
        $uuid = (string) Str::uuid();

        $slot = $this->chain->reserve((string) $note->tenant_id);

        // `credit_note_lines` بلا عمود ترتيب: يُثبَّت ترتيب حتمي (بالمعرّف، كاشتقاق السطور في الخدمة) كي لا يتبدّل ترتيب XML بين المحرّكين.
        $note->setRelation('lines', $note->loadMissing('lines')->lines->sortBy('id')->values());

        try {
            $input = ZatcaCreditNoteInputFactory::fromPostedNote(
                $note, $source, $uuid, $slot->icv, $slot->previousHash, $issuedAt, self::CASH_REFUND_REASON,
            );
            $unsignedXml = ZatcaCreditNoteXml::build($input);
            $phaseOneQr = ZatcaCreditNoteXml::phaseOneQr($input);
        } catch (InvalidArgumentException $e) {
            throw new ZatcaCreditNoteIneligibleException('document_invalid', $e->getMessage());
        }

        $hash = $this->hasher->hash($unsignedXml);
        $xml = ZatcaCreditNoteXml::withQr($unsignedXml, $phaseOneQr);
        $qr = $phaseOneQr;

        $signed = ZatcaCredential::query()->exists();
        if ($signed) {
            $final = $this->finalizer->finalize(
                $unsignedXml,
                ZatcaCreditNoteXml::QR_PLACEHOLDER,
                ZatcaPartyXml::text($input->parties['seller']['name'] ?? null) ?? '',
                ZatcaPartyXml::text($input->parties['seller']['vat_number'] ?? null) ?? '',
                $issuedAt,
                now('UTC'),
                $this->zatca->formatAmount((int) $note->total),
                $this->zatca->formatAmount((int) $note->tax_amount),
                $input->classification,
            );
            [$xml, $hash, $qr] = [$final['xml'], $final['hash'], $final['qr']];
        }

        // المدخل أولاً (T4 يقدّم الرأس) — ثم يكتب الاستدعاء أعمدة الإشعار فيرى F2 المدخل المطابق.
        $this->chain->recordCreditNote($slot, $note, $input->classification, $uuid, $hash, $signed, $issuedAt);

        return [
            'zatca_status' => 'generated',
            'zatca_skip_reason' => null,
            'zatca_document_type' => $input->classification,
            'zatca_reason_code' => self::CASH_REFUND_REASON,
            'issued_at' => $issuedAt,
            'party_snapshot' => $source->party_snapshot,
            'zatca_uuid' => $uuid,
            'zatca_icv' => $slot->icv,
            'zatca_previous_hash' => $slot->previousHash,
            'zatca_hash' => $hash,
            'zatca_qr' => $qr,
            'zatca_xml' => $xml,
        ];
    }

    private function assertEligible(CreditNote $note, ?Invoice $source): void
    {
        if ($note->refund_type !== 'cash') {
            throw new ZatcaCreditNoteIneligibleException(
                'refund_type_unsupported',
                'الإصدار الإلكتروني للإشعار الدائن متاح للاسترداد النقدي فقط؛ لا رمز وسيلة دفع موثَّق لتخفيض الذمّة. لا يُرحَّل الإشعار.',
            );
        }
        if ($source === null || $note->original_invoice_id === null) {
            throw new ZatcaCreditNoteIneligibleException(
                'standalone_not_supported',
                'الإشعار الدائن المستقل (بلا فاتورة مصدر) لا يُصدَر إلكترونياً؛ مرجع الفاتورة (BT-25) إلزامي. لا يُرحَّل الإشعار.',
            );
        }
        if (! $source->isPosted()) {
            throw new ZatcaCreditNoteIneligibleException('source_invoice_not_posted', 'الفاتورة المصدر غير مرحَّلة؛ لا يُصدَر الإشعار.');
        }
        if (! is_array($source->party_snapshot) || $source->party_snapshot === []) {
            throw new ZatcaCreditNoteIneligibleException(
                'source_snapshot_missing',
                'الفاتورة المصدر بلا لقطة بائع/مشترٍ ثابتة (مرحَّلة قبل التقاطها)؛ لا يُصدَر إشعارها إلكترونياً. لا يُرحَّل الإشعار.',
            );
        }
        if (! in_array($source->zatca_document_type, ['standard', 'simplified'], true)) {
            throw new ZatcaCreditNoteIneligibleException('document_type_unsupported', 'تصنيف مستند الفاتورة المصدر غير مدعوم؛ لا يُصدَر الإشعار.');
        }
    }
}
