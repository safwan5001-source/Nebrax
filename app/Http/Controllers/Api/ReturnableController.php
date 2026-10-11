<?php

namespace App\Http\Controllers\Api;

use App\Models\Invoice;
use App\Models\Purchase;
use App\Services\Accounting\ReturnSourceAllocator;
use App\Support\Money;
use App\Tenancy\BranchScope;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * ═══════════════════════════════════════════════════════════════
 *  ما يُمكن ردّه من مستندٍ مصدر
 * ═══════════════════════════════════════════════════════════════
 *  تسحب الشاشة منه سطور الفاتورة بكمياتها وأسعارها، **مطروحاً منها ما رُدَّ
 *  سابقاً**. بدونه كانت الشاشة ستعرض الكمية المباعة كاملةً فيصطدم المستخدم
 *  برفض الخادم بعد أن ملأ النموذج — والحدّ يجب أن يُعرَض لا أن يُكتشَف.
 *
 *  المصدر يُحلّ **خارج عزل الفرع**: الفاتورة حجّة قائمة لا نتيجة تصفّح، وقد
 *  يُرَدّ في فرعٍ غير الذي بِيع فيه.
 */
class ReturnableController extends ApiController
{
    public function __invoke(Request $request, string $type, string $id): JsonResponse
    {
        abort_unless(in_array($type, ['sales', 'purchase'], true), 404);

        $class    = $type === 'sales' ? Invoice::class : Purchase::class;
        $document = BranchScope::reference($class)->with('lines.product')->findOrFail($id);

        abort_unless($document->isPosted(), 422, 'لا يُرَدّ على مستند غير مرحّل.');

        // REM-02: مسار الإشعار الدائن يحترم فرع المستخدم كما يفعل `CreditNoteController::store` (404 غير مُسرِّب)؛
        // مسار المرتجعات المرجعي عابر للفروع كما كان.
        if ($type === 'sales' && $request->query('purpose') === 'credit_note') {
            $this->assertRecordAccessible($document->branch_id, []);
        }

        // REM-01: ما حُصِّل فعلاً على كل سطر (أساس صافٍ وضريبة بعد خصم السطر
        // والرأس) وما رُدَّ منه — فتعرض الشاشة المتبقي الحقيقي بدل أن تُعيد
        // حسابه من السعر الإجمالي. إضافةٌ فقط: الحقول القائمة بحالها.
        //
        // AWJ-TAX-REM-02: «المردود» يشمل الإشعارات الدائنة المرحَّلة المربوطة بالسطر
        // — الاثنان يستهلكان سقفاً واحداً، فالمتبقي المعروض هو ما يقبله الخادم فعلاً.
        // المسوّدة لا تحجز كمية (نفس قاعدة الحارس في `ReturnService`).
        $allocator = app(ReturnSourceAllocator::class);
        $charged   = $allocator->charged($document);
        $amounts   = $allocator->returned($document->lines->pluck('id')->all());
        $returned  = array_map(fn (array $row) => $row['quantity'], $amounts);
        // REM-02: فاتورة عليها إشعارات دائنة تاريخية غير محسومة تُعرض ممنوعةً بسببها (إضافة فقط).
        $legacyBlocked = $type === 'sales'
            && (app(ReturnSourceAllocator::class)->unresolvedLegacyCounts([(string) $document->id])[(string) $document->id] ?? 0) > 0;
        $inclusive = (bool) $document->tax_inclusive;

        $lines = $document->lines->map(function ($line) use ($returned, $charged, $amounts, $allocator, $inclusive) {
            $already   = (int) ($returned[$line->id] ?? 0);
            $remaining = max(0, (int) $line->quantity - $already);
            $chargedLine  = $charged[$line->id];
            $returnedLine = $amounts[$line->id] ?? ['net' => 0, 'tax' => 0];
            // سبق على السطر ردٌّ بسعر مخفَّض؟ عندها لا يأخذ الجزء الأخير «المتبقي».
            $reducedBefore = isset($returnedLine['min_price']) && $chargedLine['unit_price'] > 0
                && $returnedLine['min_price'] < $chargedLine['unit_price'];
            $remainingNet = max(0, $chargedLine['net'] - $returnedLine['net']);
            $remainingTax = max(0, $chargedLine['tax'] - $returnedLine['tax']);

            return [
                'source_line_id' => $line->id,
                'product_id'     => $line->product_id,
                // الوصف يسقط إلى اسم المنتج: سطرٌ عنوانه «—» في شاشة الردّ
                // يجعل المستخدم يردّ صنفاً لا يعرفه. (`PurchaseService` يخزّن
                // الاسم عند غيابه منذ #190؛ و`InvoiceService` لا يفعل بعد،
                // فالسقوط هنا يغطّي الاثنين.)
                'description'    => $line->description ?: $line->product?->name,
                'quantity'       => (int) $line->quantity,
                'returned'       => $already,
                'remaining'      => $remaining,
                'unit_price'     => Money::toRiyal($line->unit_price),
                'tax_rate'       => (int) $line->tax_rate,
                'unit_price_before_tax' => Money::toRiyal($allocator->unitPriceBeforeTax($line, $inclusive)),
                'charged_net'    => Money::toRiyal($chargedLine['net']),
                'charged_tax'    => Money::toRiyal($chargedLine['tax']),
                'returned_net'   => Money::toRiyal($returnedLine['net']),
                'returned_tax'   => Money::toRiyal($returnedLine['tax']),
                'remaining_net'  => Money::toRiyal($remainingNet),
                'remaining_tax'  => Money::toRiyal($remainingTax),
                'reduced_price_returned' => $reducedBefore,
            ];
        })->values();

        return response()->json([
            'data' => [
                'id'          => $document->id,
                'number'      => $document->number,
                'partner_id'   => $document->partner_id,
                'warehouse_id' => $document->warehouse_id,
                'tax_inclusive' => (bool) $document->tax_inclusive,
                'date'         => optional($type === 'sales' ? $document->invoice_date : $document->purchase_date)
                    ->toDateString(),
                // مستندٌ رُدَّ بالكامل يبقى مرئياً بسطوره صفراً — إخفاؤه يترك
                // المستخدم يبحث عمّا ردّه بنفسه ظانّاً أنه أخطأ في الرقم.
                'fully_returned' => $lines->every(fn ($l) => $l['remaining'] === 0),
                'blocked_reason' => $legacyBlocked ? 'legacy_credit_review' : null,
                'lines'          => $lines,
            ],
        ]);
    }
}
