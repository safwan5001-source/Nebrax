<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;

/**
 * فحص صحّة للنشر (بلا مصادقة) — تستخدمه منصّة الاستضافة للتأكد أن الخدمة حيّة.
 * متحكّم (لا closure) كي يبقى المسار قابلاً للتخزين المؤقت عبر route:cache.
 */
class HealthController extends Controller
{
    public function __invoke(): array
    {
        return ['status' => 'ok'];
    }
}
