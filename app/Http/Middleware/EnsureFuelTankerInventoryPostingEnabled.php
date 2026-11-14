<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * TANKER-PR6B-3 — بوابة نشر «الترحيل المخزني والمحاسبي لسند تعبئة الصهريج» (`fuel_stations.tanker_inventory_posting_enabled`، **مغلقة افتراضياً**).
 * مغلقة ⇒ 404 موحَّد قبل أي فحص صلاحية أو قراءة بيانات. تُوضَع بعد بوابتَي PR-1 وPR-4 في قائمة المسار؛ والخدمة نفسها ترفض عند الإغلاق (لا تعتمد على الوسيط وحده).
 * فتحها لأي مستأجر قرار تفعيل منسَّق مستقل بعد توثيق شروط الملكية والسيطرة والضريبة — لا يُفتح بهذه الشريحة.
 */
class EnsureFuelTankerInventoryPostingEnabled
{
    public function handle(Request $request, Closure $next): Response
    {
        abort_unless((bool) config('fuel_stations.tanker_inventory_posting_enabled', false), 404);

        return $next($request);
    }
}
