<?php

namespace App\Services\Accounting;

use App\Models\CreditNote;
use App\Models\Invoice;
use App\Models\Tenant;
use App\Models\ZatcaChain;
use App\Models\ZatcaChainEntry;
use App\Support\ZatcaIcvScope;
use App\Tenancy\TenantContext;
use Carbon\CarbonInterface;
use RuntimeException;

/**
 * ═══════════════════════════════════════════════════════════════
 *  مخصِّص سلسلة ZATCA المشتركة (ICV/PIH) — REM-18b-2
 * ═══════════════════════════════════════════════════════════════
 *  المصدر الوحيد لـICV والهاش السابق (PIH) لكل مستند إلكتروني يصدر (الفاتورة؛ والإشعار الدائن 381 منذ REM-18b-3c).
 *  يحلّ محلّ قراءة `max(invoices.zatca_icv)` في `ZatcaService` ويكتب على مخطط REM-18b-1:
 *
 *    reserve()  داخل معاملة الترحيل وبعد قفل مِرساة المستأجر: قفل رأس السلسلة (أو إنشاؤه بذرةً من السجل القديم)،
 *               ثم ICV = last_icv + 1 وPIH = هاش XML المحفوظ للمستند السابق.
 *    record()   في المعاملة نفسها، **قبل** تحديث صفّ المستند: إدراج المدخل؛ المُشغّل T4 يُقدّم الرأس ذرّياً، والسياج F1 على
 *               `invoices` يرفض بعدها أي كتابة ICV لا يقابلها هذا المدخل.
 *
 *  ترتيب الأقفال: صفّ المستند ← مِرساة المستأجر (LedgerService) ← رأس السلسلة. لا قفل لرأس السلسلة قبل المِرساة أبداً.
 *  فشلٌ في أي خطوة (بناء/توقيع/إدراج/تحديث) يُرجع المعاملة كلها: لا ICV مستهلك ولا رأس يتيم.
 *
 *  ═══ الانتقال من السجل القديم (تقرير التصميم §6) ═══
 *  البذرة = max(invoices.zatca_icv) للمستأجر (max يتجاهل NULL — يُصلح F-6: ORDER BY DESC في PostgreSQL كان يضع الفاتورة
 *  بلا ICV أولاً). المستند السابق: لا شيء (genesis) إن كانت البذرة 0؛ والفاتورة القديمة ذات `zatca_icv = seed_icv`
 *  **بالمساواة** ما دام الرأس عند بذرته؛ ثم المدخل `icv = last_icv` بعد أول مستند جديد (لا رجوع إلى القديم أبداً — T5).
 *  PIH = هاش XML المحفوظ دائماً (لا عمود الهاش: الهاشات القديمة الخام تبقى كما هي — REM-17). وللمدخل الجديد يُشترط أن
 *  يساوي ذلك الهاش المسجَّل في المدخل: XML عُدّل بعد صدوره ⇒ فشل مغلق، لا سلسلة تُبنى على مستند مختلف عمّا صدر.
 *  XML غائب/فارغ/تالف ⇒ فشل مغلق. لا يُعاد كتابة أي مستند تاريخي ولا يُعاد استعمال أي ICV.
 */
class ZatcaChainAllocator
{
    public const CHAIN_KEY = 'tenant';

    public function __construct(
        private readonly ZatcaInvoiceHasher $hasher,
        private readonly TenantContext $tenantContext,
    ) {}

    public function reserve(string $tenantId): ZatcaChainSlot
    {
        if ($this->tenantContext->id() !== $tenantId) {
            throw new RuntimeException('سياق المستأجر لا يطابق مستأجر المستند؛ لا يُحجز ICV.');
        }
        // نطاق الفرع غير متاح اليوم بحكم الحارس؛ وإن أُتيح لاحقاً فله سلسلته وهجرته (REM-25) — لا يُدمج في سلسلة المستأجر.
        if (ZatcaIcvScope::current() !== ZatcaIcvScope::TENANT) {
            throw new RuntimeException('سلسلة ZATCA المشتركة تدعم نطاق المستأجر وحده؛ نطاق الفرع يحتاج سلسلته الخاصة.');
        }

        // المِرساة مقفولة أصلاً في LedgerService؛ إعادة القفل هنا تثبّت الترتيب لأي مستدعٍ آخر ولا تكلّف شيئاً.
        Tenant::whereKey($tenantId)->lockForUpdate()->first();

        $chain = ZatcaChain::query()
            ->where('tenant_id', $tenantId)
            ->where('chain_key', self::CHAIN_KEY)
            ->lockForUpdate()
            ->first() ?? $this->seed($tenantId);

        return new ZatcaChainSlot(
            $chain->id,
            $tenantId,
            (int) $chain->last_icv + 1,
            $this->previousHash($chain),
        );
    }

    /** يسجّل المستند المُصدَر في السلسلة. يُستدعى في معاملة `reserve()` نفسها وقبل كتابة أعمدة ZATCA على المستند. */
    public function recordInvoice(ZatcaChainSlot $slot, Invoice $invoice, string $uuid, string $hash, bool $signed): ZatcaChainEntry
    {
        if ($invoice->tenant_id !== $slot->tenantId) {
            throw new RuntimeException('الفاتورة لا تخصّ مستأجر خانة السلسلة.');
        }
        $issuedAt = $invoice->issued_at;
        if (! $issuedAt instanceof CarbonInterface) {
            throw new RuntimeException('لحظة إصدار الفاتورة غير محدّدة؛ لا يُسجَّل مدخل سلسلة.');
        }

        $entry = new ZatcaChainEntry([
            'chain_id' => $slot->chainId,
            'icv' => $slot->icv,
            'document_type' => 'invoice',
            'invoice_id' => $invoice->id,
            'type_code' => '388',
            'subtype' => (string) $invoice->zatca_document_type,
            'zatca_uuid' => $uuid,
            'previous_hash' => $slot->previousHash,
            'hash' => $hash,
            'signed' => $signed,
            'issued_at' => $issuedAt,
        ]);
        $entry->tenant_id = $slot->tenantId;
        $entry->save();

        return $entry;
    }

    /**
     * يسجّل الإشعار الدائن المُصدَر (381) في السلسلة المشتركة — REM-18b-3c. نظير `recordInvoice()` تماماً: يُستدعى في معاملة
     * `reserve()` نفسها و**قبل** كتابة أعمدة ZATCA على الإشعار (السياج F2 يشترط مدخلاً مطابقاً، والمُشغّل T4 يُقدّم الرأس).
     * لحظة الإصدار تُمرَّر صراحةً لأنها لم تُحفظ على الإشعار بعد (تُكتب في التحديث الذي يلي).
     */
    public function recordCreditNote(
        ZatcaChainSlot $slot,
        CreditNote $note,
        string $classification,
        string $uuid,
        string $hash,
        bool $signed,
        CarbonInterface $issuedAt,
    ): ZatcaChainEntry {
        if ($note->tenant_id !== $slot->tenantId) {
            throw new RuntimeException('الإشعار لا يخصّ مستأجر خانة السلسلة.');
        }
        if (! in_array($classification, ['standard', 'simplified'], true)) {
            throw new RuntimeException('تصنيف مستند ZATCA غير معروف؛ لا يُسجَّل مدخل سلسلة.');
        }

        $entry = new ZatcaChainEntry([
            'chain_id' => $slot->chainId,
            'icv' => $slot->icv,
            'document_type' => 'credit_note',
            'credit_note_id' => $note->id,
            'type_code' => '381',
            'subtype' => $classification,
            'zatca_uuid' => $uuid,
            'previous_hash' => $slot->previousHash,
            'hash' => $hash,
            'signed' => $signed,
            'issued_at' => $issuedAt,
        ]);
        $entry->tenant_id = $slot->tenantId;
        $entry->save();

        return $entry;
    }

    /** الهاش الابتدائي BR-KSA-26: Base64 لنصّ SHA-256("0") الست عشري (القيمة نفسها في `ZatcaService::genesisHash`). */
    public static function genesisHash(): string
    {
        return base64_encode(hash('sha256', '0'));
    }

    private function seed(string $tenantId): ZatcaChain
    {
        $legacy = Invoice::query()->where('tenant_id', $tenantId);

        $chain = new ZatcaChain([
            'chain_key' => self::CHAIN_KEY,
            // يتحقق مُشغّل T6 في القاعدة أن البذرة = هذا الحدّ نفسه، فلا تُقبل بذرة مختلقة ولو تجاوزت هذا الكود.
            'seed_icv' => (int) (clone $legacy)->max('zatca_icv'),
            'seed_legacy_count' => (clone $legacy)->whereNotNull('zatca_icv')->count(),
            'seed_excluded_null_icv' => (clone $legacy)->whereNull('zatca_icv')->whereNotNull('zatca_hash')->count(),
            'seeded_at' => now(),
        ]);
        $chain->last_icv = $chain->seed_icv;
        $chain->tenant_id = $tenantId;
        $chain->save();

        return $chain;
    }

    private function previousHash(ZatcaChain $chain): string
    {
        $last = (int) $chain->last_icv;
        if ($last === 0) {
            return self::genesisHash();
        }

        if ($last === (int) $chain->seed_icv) {
            // آخر فاتورة قديمة — بالمساواة على ICV (فريد لكل مستأجر)، لا بترتيبٍ يتأثر بقيم NULL.
            $legacy = Invoice::query()->where('tenant_id', $chain->tenant_id)->where('zatca_icv', $last)->first(['id', 'zatca_xml']);
            if ($legacy === null) {
                throw new RuntimeException('تعذر متابعة سلسلة ZATCA: الفاتورة القديمة الأخيرة غير موجودة.');
            }

            return $this->hashOf($legacy->zatca_xml);
        }

        $entry = ZatcaChainEntry::query()->where('chain_id', $chain->id)->where('icv', $last)->first();
        if ($entry === null) {
            throw new RuntimeException('تعذر متابعة سلسلة ZATCA: مدخل السلسلة الأخير غير موجود.');
        }

        $xml = match ($entry->document_type) {
            'invoice' => Invoice::query()->whereKey($entry->invoice_id)->value('zatca_xml'),
            'credit_note' => CreditNote::query()->whereKey($entry->credit_note_id)->value('zatca_xml'),
            default => throw new RuntimeException('نوع مستند غير معروف في سلسلة ZATCA.'),
        };
        $hash = $this->hashOf($xml);
        if (! hash_equals((string) $entry->hash, $hash)) {
            throw new RuntimeException('تعذر متابعة سلسلة ZATCA: XML المستند السابق لا يطابق الهاش الذي صدر به.');
        }

        return $hash;
    }

    private function hashOf(mixed $xml): string
    {
        if (! is_string($xml) || trim($xml) === '') {
            throw new RuntimeException('تعذر متابعة سلسلة ZATCA: XML المستند السابق غير محفوظ.');
        }

        // XML تالف أو بـDTD ⇒ يرمي الهاشر (فشل مغلق).
        return $this->hasher->hash($xml);
    }
}
