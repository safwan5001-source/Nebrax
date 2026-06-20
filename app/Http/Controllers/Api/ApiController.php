<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Closure;
use RuntimeException;

abstract class ApiController extends Controller
{
    /**
     * ينفّذ منطق نطاق ويحوّل أخطاء العمل (RuntimeException) إلى استجابة 422 موحّدة.
     */
    protected function domain(Closure $fn): mixed
    {
        try {
            return $fn();
        } catch (RuntimeException $e) {
            abort(422, $e->getMessage());
        }
    }
}
