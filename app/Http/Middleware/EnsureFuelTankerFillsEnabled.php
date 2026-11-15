<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * TANKER-PR4 — بوابة نشر «سندات تعبئة الصهاريج» (منفصلة عن بوابة إدارة أصحاب الصهاريج). مغلقة (الافتراضي) ⇒ 404 موحَّد قبل أي فحص صلاحية أو قراءة بيانات.
 * سبب الفصل: السند المسجَّل لا يخصم المخزون قبل التكامل المخزني المعتمد (PR-6)، فلا يُعرَّض للتشغيل الفعلي إلا بقرار تفعيل صريح مستقل من المالك.
 * تُوضَع بعد `EnsureFuelTankerManagementEnabled` في قائمة المسار.
 */
class EnsureFuelTankerFillsEnabled
{
    public function handle(Request $request, Closure $next): Response
    {
        abort_unless((bool) config('fuel_stations.tanker_fills_enabled', false), 404);

        return $next($request);
    }
}
