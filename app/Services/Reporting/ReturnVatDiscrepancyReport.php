<?php

namespace App\Services\Reporting;

use App\Models\Invoice;
use App\Models\Purchase;
use App\Models\ReturnDocument;
use App\Services\Accounting\ReturnSourceAllocator;
use App\Tenancy\BranchScope;

/**
 * ═══════════════════════════════════════════════════════════════
 *  AWJ-TAX-REM-01 — تقرير مرتجعات تاريخية تخالف سطر مصدرها (قراءة فقط)
 * ═══════════════════════════════════════════════════════════════
 *  الإصلاح يغيّر مبالغ المرتجعات **المستقبلية** وحدها ولا يمسّ مرحَّلاً. هذا
 *  التقرير يعرض للمالية ما رُحِّل قبله بأساسٍ أو ضريبةٍ تخالف ما كانت القاعدة
 *  الصحيحة ستنتجه من سطر المصدر — لتقرّر هي التصحيح (إن لزم) بقيودها هي.
 *
 *  المنهج: لكل مصدر، تُعاد قراءة مرتجعاته المرحَّلة بترتيب التاريخ ثم الإنشاء
 *  (ترتيب الترحيل الفعلي غير مخزَّن، فهذا تقريب) ويُحتسب لكلٍّ ما كانت القاعدة
 *  ستنتجه بالنظر إلى **المرحَّل فعلاً** قبله (كالمحرك وقت ترحيله)، ثم يُقارن بالمرحَّل. لا كتابة ولا قيد ولا تعديل لأي سجل.
 *
 *  مستثنى: مرتجعات POS (لم يغيّرها الإصلاح) والمرتجعات الحرّة (لا مصدر لها).
 *  النطاق: المستأجر الحالي في `TenantContext`، عبر كل فروعه — فالسقف تراكمي
 *  على المصدر لا على الفرع.
 */
class ReturnVatDiscrepancyReport
{
    private const SOURCE_TYPES = [Invoice::class, Purchase::class];

    public function __construct(protected ReturnSourceAllocator $allocator) {}

    /**
     * @return list<array{
     *   return_id:string, return_number:string, type:string, source_number:string, return_date:string,
     *   recorded_net:int, expected_net:int, recorded_tax:int, expected_tax:int,
     *   recorded_total:int, expected_total:int, tax_delta:int, total_delta:int
     * }>
     */
    public function forCurrentTenant(): array
    {
        $groups = ReturnDocument::query()
            ->where('status', 'posted')
            ->whereNotNull('original_id')
            ->whereNull('pos_session_id')
            ->whereIn('original_type', self::SOURCE_TYPES)
            ->with('lines')
            ->orderBy('return_date')->orderBy('created_at')->orderBy('id')
            ->get()
            ->groupBy(fn (ReturnDocument $r) => $r->original_type.'|'.$r->original_id);

        $rows = [];
        foreach ($groups as $returns) {
            /** @var ReturnDocument $first */
            $first = $returns->first();
            $source = BranchScope::reference($first->original_type)->find($first->original_id);
            if (! $source) {
                continue;
            }

            $charged = $this->allocator->charged($source);
            $running = [];

            foreach ($returns as $return) {
                $expectedNet = $expectedTax = 0;

                foreach ($return->lines->sortBy('id') as $line) {
                    $lineId = $line->source_line_id;
                    if (! $lineId || ! isset($charged[$lineId])) {
                        // لا سطر مصدر يُقاس عليه — يُؤخذ كما رُحِّل فلا يُعدّ فرقاً.
                        $expectedNet += (int) $line->line_subtotal - (int) $line->line_discount;
                        $expectedTax += (int) $line->line_tax;
                        continue;
                    }

                    $alloc = $this->allocator->allocate(
                        $charged[$lineId],
                        $running[$lineId] ?? [],
                        (int) $line->quantity,
                        (int) $line->unit_price
                    );

                    // ما رُحِّل فعلاً هو ما استهلك السقف للمرتجع التالي — لا ما كانت
                    // القاعدة ستنتجه: مرتجعٌ تاريخي زائد يقيّد لاحقه الصحيح، فلا يُبلَّغ
                    // اللاحقُ فرقاً كاذباً.
                    $prior = $running[$lineId] ?? ['quantity' => 0, 'net' => 0, 'tax' => 0];
                    $running[$lineId] = [
                        'quantity' => $prior['quantity'] + (int) $line->quantity,
                        'net'      => $prior['net'] + (int) $line->line_subtotal - (int) $line->line_discount,
                        'tax'      => $prior['tax'] + (int) $line->line_tax,
                    ];
                    $expectedNet += $alloc['net'];
                    $expectedTax += $alloc['tax'];
                }

                $recordedNet = (int) $return->subtotal;
                $recordedTax = (int) $return->tax_amount;
                if ($recordedNet === $expectedNet && $recordedTax === $expectedTax) {
                    continue;
                }

                $rows[] = [
                    'return_id'      => $return->id,
                    'return_number'  => $return->number,
                    'type'           => $return->type,
                    'source_number'  => (string) $source->number,
                    'return_date'    => $return->return_date->toDateString(),
                    'recorded_net'   => $recordedNet,
                    'expected_net'   => $expectedNet,
                    'recorded_tax'   => $recordedTax,
                    'expected_tax'   => $expectedTax,
                    'recorded_total' => $recordedNet + $recordedTax,
                    'expected_total' => $expectedNet + $expectedTax,
                    'tax_delta'      => $recordedTax - $expectedTax,
                    'total_delta'    => ($recordedNet + $recordedTax) - ($expectedNet + $expectedTax),
                ];
            }
        }

        return $rows;
    }
}
