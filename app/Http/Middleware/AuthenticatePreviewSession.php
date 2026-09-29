<?php

namespace App\Http\Middleware;

use App\Models\PreviewSession;
use App\Models\PreviewSessionEvent;
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
 * مصادقة `preview/v1` — معزولة تماماً عن كل مصادقة أخرى في المستودع (لا
 * `AuthenticateApiClient`/`AuthenticateCommerceCustomer`، ولا حارس مستخدم
 * داخلي). تطبيق حرفي لـ`docs/plans/app-builder/MOBILE-PREVIEW-5-SECURITY-ARCHITECTURE.md`
 * §5.4 — نفس بنية `AuthenticateApiClient` (حلّ عالمي متجاوزاً `TenantScope`
 * ثم ضبط `TenantContext` من الصفّ الموثوق وحده)، مع فحص إضافي لا يملكه
 * `ApiClient`: انتهاء/إبطال **جلسة المعاينة نفسها** (`preview_sessions`)،
 * لا توكن Sanctum فقط — فالتدقيق يبقى حياً حتى بعد تنظيف Sanctum لصفّ التوكن.
 *
 * **فشلٌ مغلقٌ بشكلٍ واحدٍ فقط** لكل حالات الرفض (منتهية/مبطَلة/مجهولة/
 * تطبيق أو مستأجر معطَّل): نفس الرسالة والرمز، لا تمييز يكشف السبب الحقيقي
 * للمستدعي غير المصادَق (§5.15) — الفرق يبقى فقط في `preview_session_events`
 * الداخلي (تدقيق لا استجابة).
 *
 * **لا يُنشئ سياق فرع**: `preview/v1` لا يعرف فروعاً؛ القراءة الوحيدة
 * (اللقطة المجمَّدة) لا تُصفّى بفرع.
 */
class AuthenticatePreviewSession
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

        // عزل مبدأ المصادقة: هذا المسار لا يقبل إلا توكنات PreviewSession.
        if ($token->tokenable_type !== PreviewSession::class) {
            return $this->unauthenticated($request);
        }

        if ($token->expires_at !== null && $token->expires_at->isPast()) {
            return $this->unauthenticated($request);
        }

        if (! $token->can(PreviewSession::ABILITY_READ)) {
            return $this->unauthenticated($request);
        }

        // حلّ الجلسة بمعرّفها العامّ **متجاوزين نطاق المستأجر**: نفس نمط
        // `AuthenticateApiClient` — المصادقة تحدّد الجلسة عالمياً قبل إنشاء
        // حدّ المستأجر، والتوكن مُصادَق بالفعل بالتجزئة.
        $session = PreviewSession::withoutGlobalScope(TenantScope::class)
            ->whereKey($token->tokenable_id)
            ->first();
        if ($session === null) {
            return $this->unauthenticated($request);
        }

        if (! $session->isUsable()) {
            $this->recordRejected($session, $session->isRevoked() ? 'revoked' : 'expired');

            return $this->unauthenticated($request);
        }

        $tenant = Tenant::find($session->tenant_id);
        if ($tenant === null || ! $tenant->is_active) {
            $this->recordRejected($session, 'tenant_inactive');

            return $this->unauthenticated($request);
        }

        // المستأجر من الجلسة حصراً — لا معامل طلب يُقرَأ هنا إطلاقاً (E6:
        // لا معرّف عميل/تطبيق في الطلب لإعادة توجيهه أصلاً).
        $this->tenant->set($tenant->id);
        $session->withAccessToken($token);
        $request->setUserResolver(static fn () => $session);

        // آخر استخدام — لا يُسجَّل النصّ الصريح للتوكن هنا ولا في أي مكان.
        $token->forceFill(['last_used_at' => now()])->save();

        return $next($request);
    }

    private function recordRejected(PreviewSession $session, string $reason): void
    {
        PreviewSessionEvent::create([
            'tenant_id' => $session->tenant_id,
            'preview_session_id' => $session->getKey(),
            'action' => PreviewSessionEvent::ACTION_REJECTED,
            'reason' => $reason,
        ]);
    }

    private function unauthenticated(Request $request): Response
    {
        return PublicApiResponse::error(
            $request, PublicApiErrorCode::UNAUTHENTICATED, 'هذه المعاينة لم تعد متاحة.', 401,
        );
    }
}
