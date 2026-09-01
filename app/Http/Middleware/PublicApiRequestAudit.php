<?php

namespace App\Http\Middleware;

use App\Models\ApiClient;
use App\Models\PublicApiRequestLog;
use App\Support\PublicApiResponse;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;
use Throwable;

/**
 * تدقيق طلبات الـ Public API — تشغيلي/أمني، بيانات وصفية فقط. يُعلِّم بدء الطلب
 * في `handle`، ويكتب سجلّ التدقيق في `terminate` **بعد** إرسال الاستجابة النهائية
 * (نجاحًا أو رفضًا أو 429 أو خطأً حوّله العارض) — فيلتقط الحالة النهائية بأقلّ أثرٍ
 * على زمن الطلب.
 *
 * حدّ التدقيق (موثَّق): يُسجَّل فقط ما مرّ بالمصادقة (يوجد عميل موثوق)، فلا تكتب
 * حركةٌ غير مصادَقة (401) صفوفًا — تفاديًا لإغراق الجدول من مصدرٍ مجهول. مسار
 * الصحّة (`health`) خارج المجموعة أصلًا فلا يُدقَّق (ضجيج مسبار).
 *
 * **fail-open:** فشل كتابة التدقيق لا يكسر توفّر الـ API إطلاقًا (التدقيق
 * observability لا تفويض). لا يُخزَّن أيّ سرّ: لا Authorization ولا مفتاح API/
 * idempotency خام ولا جسم طلب/استجابة.
 *
 * الترتيب: يوضع **قبل** محدِّد المعدّل ليلتقط سجلّه `handle` ثم يلتقط `terminate`
 * استجابة 429 أيضًا.
 */
class PublicApiRequestAudit
{
    /** قائمة سماح لمعاملات الاستعلام المدقَّقة — لا نصّ بحثٍ حرّ ولا أسرار. */
    private const SAFE_QUERY_KEYS = ['page', 'per_page', 'sort', 'type', 'status'];

    private const START_ATTRIBUTE = 'public_api_audit_started_at';

    public function handle(Request $request, Closure $next): Response
    {
        $request->attributes->set(self::START_ATTRIBUTE, microtime(true));

        return $next($request);
    }

    public function terminate(Request $request, Response $response): void
    {
        try {
            $this->record($request, $response);
        } catch (Throwable) {
            // fail-open: التدقيق لا يكسر الـ API. لا نسجّل السرّ ولا نعيد رمي الخطأ.
        }
    }

    private function record(Request $request, Response $response): void
    {
        $startedAt = $request->attributes->get(self::START_ATTRIBUTE);
        if (! is_float($startedAt)) {
            return; // لم يمرّ `handle` (رفض ما قبل المصادقة) — خارج حدّ التدقيق.
        }

        $client = $request->user();
        if (! $client instanceof ApiClient) {
            return; // لا هوية موثوقة — لا نكتب صفًّا لحركةٍ غير مصادَقة.
        }

        $durationMs = (int) round((microtime(true) - $startedAt) * 1000);
        $userAgent = (string) $request->userAgent();

        PublicApiRequestLog::create([
            'tenant_id'          => $client->tenant_id,
            'api_client_id'      => $client->getKey(),
            'request_id'         => PublicApiResponse::requestId($request),
            'method'             => strtoupper($request->getMethod()),
            'route_identity'     => $request->route()?->getName() ?? $request->path(),
            'path'               => '/' . ltrim($request->path(), '/'),
            'query_params'       => $this->safeQuery($request),
            'scope'              => $this->stringAttr($request, 'public_api_scope'),
            'response_status'    => $response->getStatusCode(),
            'duration_ms'        => $durationMs,
            'rate_limited'       => (bool) $request->attributes->get('public_api_rate_limited', false),
            'idempotency_status' => $this->stringAttr($request, 'public_api_idempotency_status'),
            'ip'                 => $request->ip(),
            'user_agent'         => $userAgent !== '' ? mb_substr($userAgent, 0, 255) : null,
        ]);
    }

    /** @return array<string, string>|null */
    private function safeQuery(Request $request): ?array
    {
        $out = [];

        foreach (self::SAFE_QUERY_KEYS as $key) {
            if ($request->query->has($key)) {
                $out[$key] = mb_substr((string) $request->query->get($key), 0, 64);
            }
        }

        return $out === [] ? null : $out;
    }

    private function stringAttr(Request $request, string $key): ?string
    {
        $value = $request->attributes->get($key);

        return is_string($value) && $value !== '' ? $value : null;
    }
}
