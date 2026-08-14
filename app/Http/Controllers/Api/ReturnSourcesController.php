<?php

namespace App\Http\Controllers\Api;

use App\Models\Invoice;
use App\Models\Purchase;
use App\Models\ReturnLine;
use App\Support\Money;
use App\Support\Settings;
use App\Tenancy\BranchScope;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * ═══════════════════════════════════════════════════════════════
 *  مستندات طرفٍ القابلة للردّ عليها — بأسبابِ ما لا يصلح منها
 * ═══════════════════════════════════════════════════════════════
 *  الشاشة كانت تجلب **كل** الفواتير وتُصفّيها في المتصفح بالطرف والحالة، ثم
 *  يكتشف المستخدمُ الرفضَ بعد أن يختار ويملأ: «رُدَّ بالكامل» أو «خارج المهلة».
 *
 *  **الحدّ يجب أن يُعرَض لا أن يُكتشَف.** هذه النقطة تحسب الأهلية في الخادم —
 *  حيث السياسة والبيانات — فتُعيد لكل مستند سببَ منعه إن وُجد، وتعرضه الشاشة
 *  خياراً معطّلاً بسببه مكتوباً.
 *
 *  ولا تُخفى غير الصالحة: إخفاؤها يترك المستخدم يبحث عن فاتورةٍ يعرف رقمها
 *  ظانّاً أنه أخطأ فيه.
 */
class ReturnSourcesController extends ApiController
{
    public function __invoke(Request $request, string $type): JsonResponse
    {
        abort_unless(in_array($type, ['sales', 'purchase'], true), 404);

        $partnerId = $request->query('partner_id');
        if (! $partnerId) {
            return response()->json(['data' => []]);
        }

        $class = $type === 'sales' ? Invoice::class : Purchase::class;
        $group = $type === 'sales' ? 'sales' : 'purchases';
        $dateField = $type === 'sales' ? 'invoice_date' : 'purchase_date';

        // مستندات الطرف المرحَّلة — مرجعٌ لا تصفّح، فقد يُرَدّ في فرعٍ غير
        // الذي بِيع فيه (نفس قاعدة `ReturnableController`).
        $documents = BranchScope::reference($class)
            ->with('lines:id,' . ($type === 'sales' ? 'invoice_id' : 'purchase_id') . ',quantity')
            ->where('partner_id', $partnerId)
            ->where('status', 'posted')
            ->latest($dateField)
            ->limit(200)
            ->get();

        // ما رُدَّ من كل سطر — استعلامٌ واحد لكل المستندات لا استعلام لمستند.
        $lineIds  = $documents->flatMap(fn ($d) => $d->lines->pluck('id'));
        $returned = ReturnLine::query()
            ->whereIn('source_line_id', $lineIds)
            ->whereHas('return', fn ($q) => $q->where('status', 'posted'))
            ->groupBy('source_line_id')
            ->selectRaw('source_line_id, SUM(quantity) as qty')
            ->pluck('qty', 'source_line_id');

        $windowDays = (int) Settings::get($group, 'return_window_days');
        $today      = Carbon::parse(now()->toDateString());

        $data = $documents->map(function ($doc) use ($dateField, $returned, $windowDays, $today) {
            $remaining = $doc->lines->sum(
                fn ($l) => max(0, (int) $l->quantity - (int) ($returned[$l->id] ?? 0))
            );

            // المهلة تُقاس بتاريخ **اليوم** هنا لا بتاريخ مرتجعٍ لم يُكتب بعد:
            // الشاشة تسأل «هل يصلح الآن؟»، والحارس في الخدمة يقيسها بتاريخ
            // المستند حين يُحفَظ.
            $elapsed = (int) Carbon::parse($doc->{$dateField})->diffInDays($today, false);
            $expired = $windowDays > 0 && $elapsed > $windowDays;

            return [
                'id'        => $doc->id,
                'number'    => $doc->number,
                'date'      => optional($doc->{$dateField})->toDateString(),
                'total'     => Money::toRiyal($doc->total),
                'remaining' => $remaining,
                // سببٌ واحد يكفي المستخدم؛ و«رُدَّ بالكامل» أسبق لأنه نهائي
                // بينما المهلة قد تكون قابلة للتفاوض خارج النظام.
                'blocked_reason' => $remaining <= 0 ? 'fully_returned'
                    : ($expired ? 'out_of_window' : null),
                'elapsed_days'   => $elapsed,
            ];
        });

        return response()->json(['data' => $data->values()]);
    }
}
