<?php

namespace App\Http\Middleware;

use App\Support\Rbac;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * FUEL-B2: يفرض أن يملك دور المستخدم **واحدة على الأقل** من الصلاحيات المذكورة.
 * الاستخدام: ->middleware(EnsureAnyPermission::class.':fuel_stations.manage,fuel.delivery.approve')
 *
 * وسيطٌ مستقل عمداً: `EnsurePermission` (مفتاح واحد) تحرس مئات المسارات ولا يُمسّ. هذا الوسيط يخدم انتقال مسارات الوقود من المفتاح الواسع
 * إلى مفاتيح دقيقة مع بقاء الأدوار القديمة تعمل. نجاحه **لا يغني** عن نطاق الفرع/المخزن ولا عن سياسات الخدمة (فصل المعتمِد)، فهي تُفحص بعده دائماً.
 * بلا مستخدم أو بلا أي صلاحية مطابقة ⇒ 403 (فشل مغلق).
 */
class EnsureAnyPermission
{
    public function handle(Request $request, Closure $next, string ...$permissions): Response
    {
        $user = $request->user();

        if (! $user || $permissions === []) {
            abort(403, 'ليس لديك صلاحية لتنفيذ هذا الإجراء.');
        }

        foreach ($permissions as $permission) {
            if (Rbac::allows($user->role, $permission)) {
                return $next($request);
            }
        }

        abort(403, 'ليس لديك صلاحية لتنفيذ هذا الإجراء.');
    }
}
