<?php

namespace App\Services\Accounting;

use App\Models\Invoice;
use App\Models\ZatcaCredential;
use App\Support\ZatcaIssueTimestamp;
use App\Support\ZatcaMonetaryXml;
use App\Support\ZatcaPartyXml;
use Carbon\CarbonImmutable;
use Illuminate\Support\Str;
use RuntimeException;

/**
 * ═══════════════════════════════════════════════════════════════
 *  ZatcaService — الفاتورة الإلكترونية (هيئة الزكاة والضريبة)
 * ═══════════════════════════════════════════════════════════════
 *  المرحلة 1 (التوليد): رمز QR بصيغة TLV/Base64 بالحقول الخمسة.
 *  المرحلة 2 (الربط):   UUID + عدّاد ICV + سلسلة الهاش (PIH) + مستند UBL 2.1
 *                       + هاش SHA-256 بعد تحويل ZATCA الرسمي وC14N 1.1
 *                       + توقيع XAdES وQR المرحلة الثانية عند بدء التهيئة.
 *
 *  المؤجَّل (يتطلب ربطاً حياً): CSID/CSR الآلي وإرسال Clearance/Reporting.
 *
 *  المبالغ تُحوَّل من الهللات إلى نص عشري بلا float.
 */
class ZatcaService
{
    public function __construct(
        private readonly ZatcaInvoiceHasher $invoiceHasher,
        private readonly ZatcaSignedInvoiceFinalizer $signedInvoiceFinalizer,
        private readonly ZatcaChainAllocator $chain,
    ) {}

    /**
     * بناء كامل بيانات الفاتورة الإلكترونية عند الترحيل.
     *
     * @return array{uuid:string, icv:int, prev:string, xml:string, hash:string, qr:string, signed:bool, slot:ZatcaChainSlot}
     */
    public function buildFor(Invoice $invoice): array
    {
        // REM-13a: لحظة الإصدار تُلتقط في InvoiceService::post() قبل هذا النداء وتُحمَل على النموذج.
        // غيابها فشل مغلق — لا رجوع صامت إلى created_at (وقت المسودة) ولا إلى الساعة الحالية.
        $issuedAt = $this->issuedAtOf($invoice);

        // REM-15a: كتلتا البائع والمشتري في XML واسما البائع/رقمه في QR تُشتقّ كلّها من لقطة party_snapshot (REM-14) المثبّتة
        // عند الترحيل — لا من Tenant/Partner الحيّين. غياب اللقطة أو تلفها فشل مغلق قبل أي قفل أو استهلاك ICV.
        $parties = ZatcaPartyXml::requireSnapshot($invoice);

        $invoice->loadMissing('lines');

        $uuid = (string) Str::uuid();

        // ═══════════════════════════════════════════════════════════
        //  ICV/PIH من سلسلة ZATCA المشتركة — REM-18b-2
        // ═══════════════════════════════════════════════════════════
        //  `ZatcaChainAllocator` يقفل مِرساة المستأجر ثم رأس السلسلة (أو يُنشئه بذرةً من السجل القديم)، ويعيد ICV التالي
        //  وهاش XML المحفوظ للمستند السابق — فاتورةً كان أو إشعاراً دائناً لاحقاً. لا يُقرأ `max(invoices.zatca_icv)` هنا بعد
        //  اليوم: الرأس هو المصدر، والسياج F1 يرفض أي كتابة ICV على الفواتير لا يقابلها مدخل سلسلة. الخانة لا تُستهلك إلا
        //  بـ`record()` قبل تحديث الفاتورة في معاملة الترحيل نفسها؛ وأي فشل قبله يُرجع كل شيء فلا يضيع ICV.
        //  نطاق الفرع (`ZatcaIcvScope`) غير متاح اليوم، والمخصِّص يفشل مغلقاً إن أُتيح دون سلسلته الخاصة (REM-25).
        $slot = $this->chain->reserve($invoice->tenant_id);
        $icv  = $slot->icv;
        $prev = $slot->previousHash;

        // يُبنى مرجع QR داخل XML أولاً، لكن بقيمة مؤقتة. تحويل ZATCA
        // يستبعد عقدة QR ومرجع التوقيع، لذلك يبقى Hash هو نفسه بعد تثبيت
        // قيمة QR الفعلية في المستند المجمّد.
        $unsignedXml = $this->buildXml($invoice, $parties, $uuid, $icv, $prev);
        $hash = $this->invoiceHasher->hash($unsignedXml);
        $qr   = $this->qrFor($invoice);
        $xml  = $this->attachQr($unsignedXml, $qr);

        // لا وجود لاعتماد = مستأجر ما زال على عقد المرحلة الأولى التاريخي.
        // بمجرد وجود أي صف اعتماد يبدأ مسار المرحلة الثانية ولا يُسمح بالرجوع
        // الصامت إلى XML غير موقّع بسبب اختيار بيئة بلا اعتماد أو سياسة ناقصة؛
        // finalizer يفشل مغلقاً، ومعاملة InvoiceService تتراجع بكامل أثرها.
        $signed = ZatcaCredential::query()->exists();
        if ($signed) {
            // وقت الإصدار (للوسم 3 في QR المرحلة الثانية) هو لحظة الإصدار المخزَّنة؛ ووقت التوقيع
            // `now('UTC')` لحظة مستقلة عنها بالتصميم (ADR-0001 قرار 4) — لا يُفترض تطابقهما قانونياً.
            $final = $this->signedInvoiceFinalizer->finalize(
                $xml,
                $qr,
                ZatcaPartyXml::text($parties['seller']['name'] ?? null) ?? '',
                ZatcaPartyXml::text($parties['seller']['vat_number'] ?? null) ?? '',
                $issuedAt,
                now('UTC'),
                $this->formatAmount($invoice->total),
                $this->formatAmount($invoice->tax_amount),
                $invoice->zatca_document_type,
            );
            $xml = $final['xml'];
            $hash = $final['hash'];
            $qr = $final['qr'];
        }

        return compact('uuid', 'icv', 'prev', 'xml', 'hash', 'qr', 'signed', 'slot');
    }

    /**
     * يسجّل الفاتورة المبنية في سلسلة ZATCA المشتركة — REM-18b-2. يُستدعى من `InvoiceService::post()` في معاملة الترحيل
     * نفسها، **بعد** `buildFor()` و**قبل** كتابة أعمدة ZATCA على الفاتورة (السياج F1 يشترط وجود هذا المدخل مطابقاً).
     *
     * @param array{uuid:string, icv:int, prev:string, xml:string, hash:string, qr:string, signed:bool, slot:ZatcaChainSlot} $built
     */
    public function record(Invoice $invoice, array $built): void
    {
        $slot = $built['slot'];
        if (! $slot instanceof ZatcaChainSlot || $slot->icv !== $built['icv'] || $slot->previousHash !== $built['prev']) {
            throw new RuntimeException('مخرجات ZATCA لا تطابق خانة السلسلة المحجوزة.');
        }

        $this->chain->recordInvoice($slot, $invoice, $built['uuid'], $built['hash'], $built['signed']);
    }

    /**
     * لحظة الإصدار المخزَّنة على الفاتورة (UTC). فشل مغلق إن غابت: الفاتورة المرحَّلة قبل REM-13a تبقى
     * `issued_at = NULL` ولا يُعاد توليد أي من مخرجاتها، فلا يصل إلى هنا إلا ترحيل جديد.
     */
    private function issuedAtOf(Invoice $invoice): CarbonImmutable
    {
        $issuedAt = $invoice->issued_at;
        if ($issuedAt === null) {
            throw new RuntimeException('لحظة إصدار الفاتورة (issued_at) غير محدّدة؛ لا تُولَّد مخرجات ZATCA بلا لحظة إصدار مثبّتة.');
        }

        return $issuedAt;
    }

    /**
     * يثبّت QR داخل موضعه النظامي من دون إعادة تسلسل بقية XML.
     *
     * إعادة تسلسل المستند كاملاً قد تغيّر البايتات الداخلة في C14N خارج
     * العقدة المستبعدة؛ لذلك يُستبدل موضع وحيد معلوم ثم يُعاد التحقق من
     * الهاش على XML النهائي في الاختبارات.
     */
    private function attachQr(string $xml, string $qr): string
    {
        $marker = '<cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">'
            . '__NEBRAX_ZATCA_QR__'
            . '</cbc:EmbeddedDocumentBinaryObject>';
        if (substr_count($xml, $marker) !== 1) {
            throw new RuntimeException('تعذر تثبيت QR داخل XML الخاص بـ ZATCA.');
        }

        $qrNode = '<cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">'
            . htmlspecialchars($qr, ENT_XML1 | ENT_QUOTES, 'UTF-8')
            . '</cbc:EmbeddedDocumentBinaryObject>';

        return str_replace($marker, $qrNode, $xml);
    }

    /**
     * رمز QR للمرحلة 1: Base64 لحقول TLV الخمسة الإلزامية.
     */
    public function qrFor(Invoice $invoice): string
    {
        // الوسمان 1–2 من لقطة البائع نفسها التي يُبنى منها XML (REM-15a) فلا يختلف اسم/رقم QR عن المستند.
        $issuedAt = $this->issuedAtOf($invoice);
        $seller = ZatcaPartyXml::requireSnapshot($invoice)['seller'];

        $payload =
            $this->tlv(1, ZatcaPartyXml::text($seller['name'] ?? null) ?? '') .
            $this->tlv(2, ZatcaPartyXml::text($seller['vat_number'] ?? null) ?? '') .
            $this->tlv(3, ZatcaIssueTimestamp::phase1QrText($issuedAt)) .
            $this->tlv(4, $this->formatAmount($invoice->total)) .
            $this->tlv(5, $this->formatAmount($invoice->tax_amount));

        return base64_encode($payload);
    }

    /**
     * PIH الابتدائي في XML قبل REM-17: Base64 لبايتات SHA-256("0") الخام. **لا يُصدَر أبداً** بعد REM-17؛
     * يبقى للتعرّف على سلاسل تجريبية بدأت به (أول فاتورة فيها تحمله ولا يُعاد توليدها — REM-25).
     */
    public const LEGACY_GENESIS_HASH = 'X+zrZv/IbzjZUnhsbWlsecLbwjndTpG0ZynXOif7V+k=';

    /**
     * الهاش الابتدائي لسلسلة PIH (أول فاتورة في سلسلة جديدة فقط) — REM-17.
     *
     * معيار تنفيذ XML (BR-KSA-26) ينصّ حرفياً: «لأول فاتورة، الهاش السابق هو
     * NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==» = Base64 لنصّ
     * SHA-256("0") **الست عشري** (لا لبايتاته الخام)، وهي القيمة نفسها في عيّنات SDK الرسمية وملف pih.txt.
     * السلاسل القائمة لا تتأثر: الفاتورة التالية تشير دائماً إلى هاش XML السابق المحفوظ.
     */
    public function genesisHash(): string
    {
        return base64_encode(hash('sha256', '0'));
    }

    /**
     * بناء حقل TLV واحد: [وسم 1 بايت][طول البايتات 1 بايت][القيمة].
     * الطول بايت واحد (معيار ميزات الأمان §4.1): قيمة أطول من 255 بايت تُرفض ولا تُقتطع أبداً (اسم البائع بيانات
     * هوية قانونية) — REM-17.
     */
    public function tlv(int $tag, string $value): string
    {
        if (strlen($value) > 255) {
            throw new RuntimeException("قيمة وسم QR رقم {$tag} تتجاوز 255 بايت؛ لا تُقتطع بيانات QR.");
        }

        return chr($tag) . chr(strlen($value)) . $value;
    }

    /**
     * تحويل المبلغ من الهللات إلى نص عشري — بلا float. 115000 → "1150.00"
     */
    public function formatAmount(int $minor): string
    {
        $sign  = $minor < 0 ? '-' : '';
        $minor = abs($minor);

        return sprintf('%s%d.%02d', $sign, intdiv($minor, 100), $minor % 100);
    }

    /** يعرض الكمية النسبية في UBL من دون تحويل عائم أو فقد دقة. */
    private function lineQuantity(\App\Models\InvoiceLine $line): string
    {
        if ($line->quantity_numerator === null || $line->quantity_denominator === null) {
            return (string) $line->quantity;
        }

        $numerator = (int) $line->quantity_numerator;
        $denominator = (int) $line->quantity_denominator;
        if ($numerator <= 0 || $denominator <= 0) {
            throw new RuntimeException('كمية سطر الفاتورة النسبية غير صالحة لتمثيل ZATCA.');
        }

        $scale = 0;
        $reduced = $denominator;
        while ($reduced % 2 === 0) { $reduced = intdiv($reduced, 2); $scale++; }
        while ($reduced % 5 === 0) { $reduced = intdiv($reduced, 5); $scale++; }
        if ($reduced !== 1) {
            throw new RuntimeException('مقام كمية سطر الفاتورة لا يمكن تمثيله عشرياً بدقة في ZATCA.');
        }

        $scale = max($scale, 3);
        $factor = 1;
        for ($i = 0; $i < $scale; $i++) { $factor *= 10; }
        if ($factor % $denominator !== 0 || $numerator > intdiv(PHP_INT_MAX, intdiv($factor, $denominator))) {
            throw new RuntimeException('كمية سطر الفاتورة تتجاوز حد تمثيل ZATCA.');
        }
        $scaled = $numerator * intdiv($factor, $denominator);
        $whole = intdiv($scaled, $factor);
        $fraction = str_pad((string) ($scaled % $factor), $scale, '0', STR_PAD_LEFT);

        return rtrim(rtrim("{$whole}.{$fraction}", '0'), '.');
    }

    /**
     * بناء مستند UBL 2.1 مبسّط للفاتورة (تمثيل بنيوي — غير مُتحقَّق مقابل XSD ZATCA).
     * كتلتا الطرفين (REM-15a) من لقطة party_snapshot عبر ZatcaPartyXml؛ والمبالغ/الأسطر (REM-16) تُعرض كما خُزّنت عبر
     * ZatcaMonetaryXml بلا أي إعادة حساب. الترويسة والتوقيع/QR/PIH خارج هذه الدالة.
     *
     * @param array{seller: array<string, mixed>, buyer: array<string, mixed>} $parties
     */
    protected function buildXml(Invoice $invoice, array $parties, string $uuid, int $icv, string $prev): string
    {
        $e = fn ($v) => htmlspecialchars((string) $v, ENT_XML1 | ENT_QUOTES, 'UTF-8');

        // REM-16: المبالغ والأسطر تُعرض كما خُزّنت (ZatcaMonetaryXml) — لا إعادة حساب هنا.
        $linesXml = '';
        foreach ($invoice->lines as $i => $line) {
            $linesXml .= ZatcaMonetaryXml::line($invoice, $line, $i + 1, $this->lineQuantity($line));
        }
        $monetaryXml = ZatcaMonetaryXml::documentBlock($invoice);

        // REM-13a / BR-KSA-70: توقيت السعودية (AST) بلا Z، مشتق من لحظة الإصدار المخزَّنة.
        $issuedAt = $this->issuedAtOf($invoice);
        $issueDate = ZatcaIssueTimestamp::xmlDate($issuedAt);
        $issueTime = ZatcaIssueTimestamp::xmlTime($issuedAt);
        $transactionCode = $invoice->zatca_document_type === 'standard' ? '0100000' : '0200000';
        $partiesXml = rtrim(
            ZatcaPartyXml::supplier($parties['seller'])
            . ZatcaPartyXml::customer($parties['buyer'], $invoice->zatca_document_type === 'standard' ? 'standard' : 'simplified')
        );

        return <<<XML
<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
         xmlns:sig="urn:oasis:names:specification:ubl:schema:xsd:CommonSignatureComponents-2"
         xmlns:sac="urn:oasis:names:specification:ubl:schema:xsd:SignatureAggregateComponents-2"
         xmlns:sbc="urn:oasis:names:specification:ubl:schema:xsd:SignatureBasicComponents-2"
         xmlns:ds="http://www.w3.org/2000/09/xmldsig#"
         xmlns:xades="http://uri.etsi.org/01903/v1.3.2#">
  <cbc:ProfileID>reporting:1.0</cbc:ProfileID>
  <cbc:ID>{$e($invoice->number)}</cbc:ID>
  <cbc:UUID>{$e($uuid)}</cbc:UUID>
  <cbc:IssueDate>{$e($issueDate)}</cbc:IssueDate>
  <cbc:IssueTime>{$e($issueTime)}</cbc:IssueTime>
  <cbc:InvoiceTypeCode name="{$transactionCode}">388</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>SAR</cbc:DocumentCurrencyCode>
  <cbc:TaxCurrencyCode>SAR</cbc:TaxCurrencyCode>
  <cac:AdditionalDocumentReference>
    <cbc:ID>ICV</cbc:ID>
    <cbc:UUID>{$e($icv)}</cbc:UUID>
  </cac:AdditionalDocumentReference>
  <cac:AdditionalDocumentReference>
    <cbc:ID>PIH</cbc:ID>
    <cac:Attachment>
      <cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">{$e($prev)}</cbc:EmbeddedDocumentBinaryObject>
    </cac:Attachment>
  </cac:AdditionalDocumentReference>
  <cac:AdditionalDocumentReference>
    <cbc:ID>QR</cbc:ID>
    <cac:Attachment>
      <cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">__NEBRAX_ZATCA_QR__</cbc:EmbeddedDocumentBinaryObject>
    </cac:Attachment>
  </cac:AdditionalDocumentReference>
  <cac:Signature>
    <cbc:ID>urn:oasis:names:specification:ubl:signature:Invoice</cbc:ID>
    <cbc:SignatureMethod>urn:oasis:names:specification:ubl:dsig:enveloped:xades</cbc:SignatureMethod>
  </cac:Signature>
{$partiesXml}
{$monetaryXml}{$linesXml}</Invoice>
XML;
    }
}
