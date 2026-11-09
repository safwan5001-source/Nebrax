<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * TANKER-PR1 — بوابة نشر «إدارة أصحاب الصهاريج». مغلقة (الافتراضي) ⇒ 404 موحَّد لكل مسارات الميزة قبل أي فحص صلاحية أو قراءة بيانات،
 * فلا يُكشف وجودها ولا يتغيّر سلوك أي مستأجر. تُوضَع أول وسيط في قائمة المسار.
 */
class EnsureFuelTankerManagementEnabled
{
    public function handle(Request $request, Closure $next): Response
    {
        abort_unless((bool) config('fuel_stations.tanker_management_enabled', false), 404);

        return $next($request);
    }
}
