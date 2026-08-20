<?php

namespace App\Http\Middleware;

use App\Models\PlatformAdministrator;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * يحمي مسارات تشغيل المنصة من حسابات المستأجرين.
 *
 * لا يكفي `auth:sanctum` هنا، إذ يمكن لتوكن مستخدم مستأجر أن ينجح في المصادقة.
 * هذا الوسيط يطلب نموذج مدير المنصة صراحةً وتوكناً ذا قدرة محددة، تُمرَّر
 * اسماً عبر المسار (افتراضها `platform:read`): `EnsurePlatformAdministrator::class . ':platform:manage'`.
 */
class EnsurePlatformAdministrator
{
    public function handle(Request $request, Closure $next, string $ability = 'platform:read'): Response
    {
        $administrator = $request->user();

        if (! $administrator instanceof PlatformAdministrator || ! $administrator->is_active) {
            abort(403, 'هذه المساحة مخصصة لمديري المنصة فقط.');
        }

        if (! $administrator->tokenCan($ability)) {
            abort(403, 'لا يحمل هذا التوكن الصلاحية المطلوبة.');
        }

        return $next($request);
    }
}
