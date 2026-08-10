<?php

namespace App\Services\Accounting;

use App\Models\Partner;
use App\Models\ProcurementDocument;
use App\Models\ProcurementLine;
use App\Models\Purchase;
use App\Models\RfqInvitation;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * ═══════════════════════════════════════════════════════════════
 *  ProcurementService — دورة الشراء (مستندات غير محاسبية)
 * ═══════════════════════════════════════════════════════════════
 *  طلب شراء → طلب عروض → عرض مورّد → أمر شراء → **فاتورة مشتريات**.
 *
 *  **لا شيء هنا يمسّ المحرك.** المستندات الأربعة تجارية بحتة: لا `LedgerService`
 *  ولا حركة مخزون ولا رصيد حساب. الأثر المحاسبي يبدأ عند ترحيل الفاتورة
 *  الناتجة عن أمر الشراء (`PurchaseService::post`) — نفس مبدأ عرض السعر.
 *
 *  التحويل ينشئ مستنداً جديداً ويربطه بمصدره (`source_document_id`)، فتبقى
 *  السلسلة قابلة للتتبّع من الفاتورة رجوعاً إلى الطلب الأول.
 */
class ProcurementService
{
    use ComputesLineTax;

    /** التحويلات المسموحة. `request → order` مسموح عمداً: شراء صغير لا يحتمل مناقصة. */
    private const CHAIN = [
        'request'   => ['rfq', 'order'],
        'rfq'       => ['quotation'],
        'quotation' => ['order'],
        'order'     => [], // ينتهي إلى فاتورة مشتريات لا إلى مستند شراء آخر
    ];

    /** بادئة الترقيم لكل نوع. */
    private const PREFIX = [
        'request'   => 'PR',
        'rfq'       => 'RFQ',
        'quotation' => 'PQ',
        'order'     => 'PO',
    ];

    /** الأنواع التي يلزمها مورّد محدَّد. الطلب وطلب العروض بلا مورّد بطبيعتهما. */
    private const REQUIRES_PARTNER = ['quotation', 'order'];

    /** الانتقالات المسموحة بين الحالات. `converted` و`cancelled` نهائيتان. */
    private const TRANSITIONS = [
        'draft'     => ['submitted', 'cancelled'],
        'submitted' => ['approved', 'rejected', 'cancelled'],
        'approved'  => ['converted', 'cancelled'],
        'rejected'  => ['draft', 'cancelled'],
        'converted' => [],
        'cancelled' => [],
    ];

    public function __construct(protected PurchaseService $purchases) {}

    /**
     * إنشاء مستند شراء بحالة draft مع احتساب الإجماليات من السطور.
     *
     * @param  array  $data   ['type'=>string, 'partner_id'=>?uuid, 'doc_date'=>?, 'due_date'=>?,
     *                         'requested_by'=>?, 'notes'=>?, 'tax_inclusive'=>?bool,
     *                         'source_document_id'=>?uuid, 'supplier_ids'=>?array, 'number'=>?]
     * @param  array  $items  [['product_id'=>?, 'description'=>?, 'quantity'=>int, 'unit_price'=>?int, 'tax_rate'=>?int], ...]
     */
    public function create(array $data, array $items): ProcurementDocument
    {
        $type = $data['type'] ?? 'request';
        $this->assertType($type);

        if (empty($items)) {
            throw new RuntimeException('المستند يجب أن يحتوي على سطر واحد على الأقل.');
        }

        if (in_array($type, self::REQUIRES_PARTNER, true) && empty($data['partner_id'])) {
            throw new RuntimeException('هذا المستند يلزمه مورّد محدَّد.');
        }

        return DB::transaction(function () use ($data, $items, $type) {
            $date      = $data['doc_date'] ?? now()->toDateString();
            $inclusive = (bool) ($data['tax_inclusive'] ?? false);

            $doc = ProcurementDocument::create([
                'type'               => $type,
                'number'             => $data['number'] ?? $this->nextNumber($type, $date),
                'partner_id'         => $data['partner_id'] ?? null,
                'doc_date'           => $date,
                'due_date'           => $data['due_date'] ?? null,
                'requested_by'       => $data['requested_by'] ?? null,
                'status'             => 'draft',
                'tax_inclusive'      => $inclusive,
                'notes'              => $data['notes'] ?? null,
                'source_document_id' => $data['source_document_id'] ?? null,
                'created_by'         => $data['created_by'] ?? null,
            ]);

            $this->writeLines($doc, $items, $inclusive);
            $this->syncInvitations($doc, $data['supplier_ids'] ?? null);

            return $doc->load(['lines', 'invitations']);
        });
    }

    /**
     * تعديل مستند: حقول الرأس، وإن مُرّرت سطور تُستبدل القديمة وتُعاد الإجماليات.
     * المستند المُحوَّل أو الملغى لا يُعدَّل — صار حجّةً على ما تلاه.
     */
    public function update(ProcurementDocument $doc, array $data, ?array $items): ProcurementDocument
    {
        if ($doc->isClosed()) {
            throw new RuntimeException('لا يمكن تعديل مستند مُحوَّل أو ملغى.');
        }

        return DB::transaction(function () use ($doc, $data, $items) {
            $doc->update(array_filter([
                'partner_id'    => $data['partner_id'] ?? null,
                'doc_date'      => $data['doc_date'] ?? null,
                'due_date'      => $data['due_date'] ?? null,
                'requested_by'  => $data['requested_by'] ?? null,
                'tax_inclusive' => $data['tax_inclusive'] ?? null,
                'notes'         => $data['notes'] ?? null,
            ], fn ($v) => $v !== null));

            if ($items !== null) {
                if (empty($items)) {
                    throw new RuntimeException('المستند يجب أن يحتوي على سطر واحد على الأقل.');
                }
                $doc->lines()->delete();
                $this->writeLines($doc, $items, (bool) $doc->tax_inclusive);
            }

            if (array_key_exists('supplier_ids', $data)) {
                $this->syncInvitations($doc, $data['supplier_ids'], replace: true);
            }

            return $doc->fresh(['lines', 'invitations']);
        });
    }

    /**
     * نقل المستند إلى حالة تالية مسموحة (اعتماد/رفض/إلغاء…).
     * `converted` لا تُضبط يدوياً — التحويل وحده يضعها.
     */
    public function transition(ProcurementDocument $doc, string $status): ProcurementDocument
    {
        if ($status === 'converted') {
            throw new RuntimeException('حالة «مُحوَّل» تُضبط بالتحويل لا يدوياً.');
        }

        $this->assertTransition($doc, $status);
        $doc->update(['status' => $status]);

        return $doc->fresh(['lines', 'invitations']);
    }

    /**
     * تحويل المستند إلى المرحلة التالية من السلسلة (طلب → طلب عروض → عرض → أمر).
     * لا قيد ولا حركة مخزون — نسخُ سطورٍ ووسمُ المصدر ليس إلا.
     */
    public function convert(ProcurementDocument $doc, string $targetType, array $overrides = []): ProcurementDocument
    {
        $this->assertConvertible($doc, $targetType);

        if (in_array($targetType, self::REQUIRES_PARTNER, true) && empty($overrides['partner_id']) && empty($doc->partner_id)) {
            throw new RuntimeException('هذا المستند يلزمه مورّد محدَّد.');
        }

        return DB::transaction(function () use ($doc, $targetType, $overrides) {
            $target = $this->create(array_merge([
                'type'               => $targetType,
                'partner_id'         => $doc->partner_id,
                'due_date'           => $doc->due_date?->toDateString(),
                'requested_by'       => $doc->requested_by,
                'tax_inclusive'      => $doc->tax_inclusive,
                'notes'              => "محوّل من {$doc->number}",
                'source_document_id' => $doc->id,
                'created_by'         => $doc->created_by,
            ], $overrides), $this->itemsOf($doc));

            $doc->update(['status' => 'converted']);

            return $target;
        });
    }

    /**
     * تحويل أمر الشراء إلى فاتورة مشتريات (draft). لا ترحيل تلقائي — يراجع
     * المستخدم الفاتورة ثم يرحّلها، فيبدأ الأثر المحاسبي عبر المحرك وحده.
     */
    public function convertToPurchase(ProcurementDocument $doc, string $paymentType = 'credit'): Purchase
    {
        if ($doc->type !== 'order') {
            throw new RuntimeException('فاتورة المشتريات تُولَّد من أمر شراء فقط.');
        }
        $this->assertTransition($doc, 'converted');

        if (empty($doc->partner_id)) {
            throw new RuntimeException('أمر الشراء بلا مورّد — لا يمكن توليد فاتورة منه.');
        }

        return DB::transaction(function () use ($doc, $paymentType) {
            $purchase = $this->purchases->create([
                'partner_id'    => $doc->partner_id,
                'payment_type'  => $paymentType,
                'tax_inclusive' => $doc->tax_inclusive,
                'notes'         => "محوّل من أمر الشراء {$doc->number}",
                'created_by'    => $doc->created_by,
            ], $this->itemsOf($doc));

            $doc->update(['status' => 'converted', 'converted_purchase_id' => $purchase->id]);

            return $purchase;
        });
    }

    /** سطور المستند بصيغة مدخلات صالحة لمستند تالٍ أو لفاتورة. */
    protected function itemsOf(ProcurementDocument $doc): array
    {
        $doc->loadMissing('lines');

        return $doc->lines->map(fn (ProcurementLine $l) => [
            'product_id'  => $l->product_id,
            'description' => $l->description,
            'quantity'    => $l->quantity,
            'unit_price'  => $l->unit_price,
            'tax_rate'    => $l->tax_rate,
        ])->all();
    }

    /** يكتب السطور ويحدّث إجماليات الرأس منها (السطور مصدر الحقيقة). */
    protected function writeLines(ProcurementDocument $doc, array $items, bool $inclusive): void
    {
        $subtotal = $taxTotal = 0;

        foreach ($items as $item) {
            $qty       = (int) ($item['quantity'] ?? 1);
            $unitPrice = (int) ($item['unit_price'] ?? 0);
            $rate      = (int) ($item['tax_rate'] ?? 15);

            if ($qty <= 0 || $unitPrice < 0) {
                throw new RuntimeException('الكمية يجب أن تكون موجبة والسعر غير سالب.');
            }

            $lineGross = $qty * $unitPrice;
            [$lineNet, $lineTax] = $this->splitLineTax($lineGross, $rate, $inclusive);

            ProcurementLine::create([
                'procurement_document_id' => $doc->id,
                'product_id'              => $item['product_id'] ?? null,
                'description'             => $item['description'] ?? null,
                'quantity'                => $qty,
                'unit_price'              => $unitPrice,
                'tax_rate'                => $rate,
                'line_subtotal'           => $lineNet,
                'line_tax'                => $lineTax,
                'line_total'              => $lineNet + $lineTax,
            ]);

            $subtotal += $lineNet;
            $taxTotal += $lineTax;
        }

        $doc->update([
            'subtotal'   => $subtotal,
            'tax_amount' => $taxTotal,
            'total'      => $subtotal + $taxTotal,
        ]);
    }

    /** يسجّل الموردين المدعوّين لطلب العروض. */
    protected function syncInvitations(ProcurementDocument $doc, ?array $supplierIds, bool $replace = false): void
    {
        if ($supplierIds === null) {
            return;
        }

        if ($doc->type !== 'rfq') {
            throw new RuntimeException('دعوة الموردين تخصّ طلب عروض الأسعار فقط.');
        }

        if ($replace) {
            $doc->invitations()->delete();
        }

        foreach (array_unique($supplierIds) as $partnerId) {
            Partner::findOrFail($partnerId); // عزل: المورّد يخصّ المستأجر
            RfqInvitation::create(['procurement_document_id' => $doc->id, 'partner_id' => $partnerId]);
        }
    }

    protected function assertType(string $type): void
    {
        if (! in_array($type, ProcurementDocument::TYPES, true)) {
            throw new RuntimeException("نوع مستند شراء غير معروف: {$type}");
        }
    }

    protected function assertTransition(ProcurementDocument $doc, string $status): void
    {
        if (! in_array($status, self::TRANSITIONS[$doc->status] ?? [], true)) {
            throw new RuntimeException("لا يمكن نقل المستند من «{$doc->status}» إلى «{$status}».");
        }
    }

    protected function assertConvertible(ProcurementDocument $doc, string $targetType): void
    {
        $this->assertType($targetType);

        if (! in_array($targetType, self::CHAIN[$doc->type] ?? [], true)) {
            throw new RuntimeException("لا يمكن تحويل «{$doc->type}» إلى «{$targetType}».");
        }

        $this->assertTransition($doc, 'converted');
    }

    /**
     * تسلسل مستقلّ لكل نوع: PR · RFQ · PQ · PO. الترقيم على مستوى المستأجر
     * (`unique(tenant_id, number)`) لا الفرع — ولولا ذلك لبدأ كل فرع من ١.
     */
    protected function nextNumber(string $type, string $date): string
    {
        $year  = substr($date, 0, 4);
        $count = ProcurementDocument::where('type', $type)->whereYear('doc_date', $year)->count() + 1;

        return sprintf('%s-%s-%05d', self::PREFIX[$type], $year, $count);
    }
}
