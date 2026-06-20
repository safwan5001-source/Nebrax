<?php

namespace App\Http\Middleware;

use App\Support\Rbac;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * يفرض صلاحية RBAC على المسار حسب دور المستخدم.
 * الاستخدام: ->middleware(EnsurePermission::class.':invoices.manage')
 */
class EnsurePermission
{
    public function handle(Request $request, Closure $next, string $permission): Response
    {
        $user = $request->user();

        if (! $user || ! Rbac::allows($user->role, $permission)) {
            abort(403, 'ليس لديك صلاحية لتنفيذ هذا الإجراء.');
        }

        return $next($request);
    }
}
