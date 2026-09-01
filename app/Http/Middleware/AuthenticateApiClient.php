<?php

namespace App\Http\Middleware;

use App\Models\ApiClient;
use App\Models\Tenant;
use App\Support\PublicApiErrorCode;
use App\Support\PublicApiResponse;
use App\Tenancy\TenantContext;
use App\Tenancy\TenantScope;
use Closure;
use Illuminate\Http\Request;
use Laravel\Sanctum\PersonalAccessToken;
use Symfony\Component\HttpFoundation\Response;

/**
 * مصادقة الـ Public API (M2M) — **معزولة تمامًا** عن مصادقة مستخدمي الـ Internal API.
 *
 * تقبل **فقط** مفاتيح API (توكن Sanctum بـ tokenable = ApiClient)؛ توكن مستخدم
 * بشري يُرفض. تشتقّ المستأجر من علاقة العميل الموثوقة على الخادم — **لا** من
 * ترويسة/معامل استعلام/جسم؛ فلا يستطيع العميل تبديل مستأجره خارجيًا.
 *
 * تفشل **مغلقةً**: أي خطوة ناقصة تُنهي الطلب برمز خطأ الـ Public API الموحّد،
 * دون تمييز يكشف وجود عملاء/مستأجرين آخرين (رفض مصادقة عامّ 401 للحالات الغامضة).
 *
 * الترتيب: بعد `PublicApiRequestContext`، وقبل `PublicApiTenantGuard` و`EnsureApiScope`.
 */
class AuthenticateApiClient
{
    public function __construct(private TenantContext $tenant) {}

    public function handle(Request $request, Closure $next): Response
    {
        $bearer = $request->bearerToken();
        if ($bearer === null || $bearer === '') {
            return $this->unauthenticated($request);
        }

        // بحث Sanctum الآمن: يفكّ `id|secret`، يجد بالمعرّف، ويقارن sha256 بثبات زمني.
        $token = PersonalAccessToken::findToken($bearer);
        if ($token === null) {
            return $this->unauthenticated($request);
        }

        // عزل: لا يقبل مسار الـ Public إلا مفاتيح ApiClient (يرفض توكنات المستخدمين).
        if ($token->tokenable_type !== ApiClient::class) {
            return $this->unauthenticated($request);
        }

        // انتهاء الصلاحية → رفض عامّ (السبب الدقيق يبقى في التشخيص الداخلي، لا يُكشف).
        if ($token->expires_at !== null && $token->expires_at->isPast()) {
            return $this->unauthenticated($request);
        }

        // حلّ الهوية بالمعرّف العامّ الفريد **متجاوزين نطاق المستأجر**: المصادقة تحدّد
        // من العميل عالميًا قبل إنشاء حدّ المستأجر، والتوكن مُصادَق بالفعل بالتجزئة.
        $client = ApiClient::withoutGlobalScope(TenantScope::class)
            ->whereKey($token->tokenable_id)
            ->first();
        if ($client === null) {
            return $this->unauthenticated($request);
        }

        if (! $client->is_active) {
            return PublicApiResponse::error(
                $request, PublicApiErrorCode::CLIENT_INACTIVE, 'عميل الـ API غير مفعّل.', 403,
            );
        }

        // المستأجر من العميل حصراً — يفشل مغلقًا إن غاب أو تعطّل أو حُذف.
        $tenant = Tenant::find($client->tenant_id);
        if ($tenant === null || ! $tenant->is_active) {
            return PublicApiResponse::error(
                $request, PublicApiErrorCode::TENANT_CONTEXT_REQUIRED, 'تعذّر تحديد مستأجر صالح لهذا العميل.', 403,
            );
        }

        // إنشاء حدّ المستأجر الموثوق، وربط هوية العميل والتوكن للطلب.
        $this->tenant->set($tenant->id);
        $client->withAccessToken($token);
        $request->setUserResolver(static fn () => $client);

        // آخر استخدام — النصّ الصريح لا يُخزَّن ولا يُسجَّل إطلاقًا.
        $token->forceFill(['last_used_at' => now()])->save();

        return $next($request);
    }

    private function unauthenticated(Request $request): Response
    {
        return PublicApiResponse::error(
            $request, PublicApiErrorCode::UNAUTHENTICATED, 'مصادقة الـ API مطلوبة أو غير صالحة.', 401,
        );
    }
}
