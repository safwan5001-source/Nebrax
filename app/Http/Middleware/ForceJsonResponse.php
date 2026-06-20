<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * يفرض استجابات JSON موحّدة لكل مسارات الـ API (بما فيها الأخطاء)،
 * بضبط ترويسة Accept فيعيد Laravel أخطاءه بصيغة JSON مع رموز HTTP صحيحة.
 */
class ForceJsonResponse
{
    public function handle(Request $request, Closure $next): Response
    {
        $request->headers->set('Accept', 'application/json');

        return $next($request);
    }
}
