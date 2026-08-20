<?php

namespace App\Http\Controllers\Api;

use App\Models\Invoice;
use App\Models\Purchase;
use App\Models\ReturnLine;
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

        // ما رُدَّ سابقاً لكل سطر — من المرتجعات **المرحَّلة** وحدها، فالمسوّدة
        // لا تحجز كمية (نفس قاعدة الحارس في `ReturnService`).
        $returned = ReturnLine::query()
            ->whereIn('source_line_id', $document->lines->pluck('id'))
            ->whereHas('return', fn ($q) => $q->where('status', 'posted'))
            ->groupBy('source_line_id')
            ->selectRaw('source_line_id, SUM(quantity) as qty')
            ->pluck('qty', 'source_line_id');

        $lines = $document->lines->map(function ($line) use ($returned) {
            $already   = (int) ($returned[$line->id] ?? 0);
            $remaining = max(0, (int) $line->quantity - $already);

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
            ];
        })->values();

        return response()->json([
            'data' => [
                'id'          => $document->id,
                'number'      => $document->number,
                'partner_id'   => $document->partner_id,
                'warehouse_id' => $document->warehouse_id,
                'date'         => optional($type === 'sales' ? $document->invoice_date : $document->purchase_date)
                    ->toDateString(),
                // مستندٌ رُدَّ بالكامل يبقى مرئياً بسطوره صفراً — إخفاؤه يترك
                // المستخدم يبحث عمّا ردّه بنفسه ظانّاً أنه أخطأ في الرقم.
                'fully_returned' => $lines->every(fn ($l) => $l['remaining'] === 0),
                'lines'          => $lines,
            ],
        ]);
    }
}
