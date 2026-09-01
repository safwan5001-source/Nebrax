<?php

namespace App\Http\Middleware;

use App\Models\ApiClient;
use App\Models\PublicApiIdempotencyKey;
use App\Support\PublicApiErrorCode;
use App\Support\PublicApiIdempotency;
use App\Support\PublicApiResponse;
use Closure;
use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Http\Response as IlluminateResponse;
use Symfony\Component\HttpFoundation\Response;
use Throwable;

/**
 * حارس Idempotency لمسارات الكتابة المستقبلية (PR-5) — يمنع التنفيذ المزدوج عند
 * إعادة إرسال العميل الطلبَ نفسه. **لا يُطبَّق على GET/HEAD** (يمرّها كما هي).
 *
 * البوابة = إدراجٌ أوّل مقابل قيد فريد `(tenant_id, api_client_id, key_hash)`:
 * الطلب الفائز بالإدراج ينفّذ العملية، والمتزامن معه يصطدم بالقيد فيُعامَل تكرارًا.
 * فلا يعتمد الأمان على قفلٍ تطبيقي بل على ضمان قاعدة البيانات (PostgreSQL أقوى؛
 * SQLite يسلسل الكتابة فيصمد القيد).
 *
 * آلة الحالة:
 *  - أوّل طلب            → إدراج in_progress ⇒ تنفيذ ⇒ إكمال (تخزين استجابة 2xx).
 *  - تكرار أثناء التنفيذ → 409 idempotency_in_progress (لا تنفيذ).
 *  - تكرار مكتمِل مطابق  → إعادة تشغيل الاستجابة المخزَّنة (Idempotency-Replayed).
 *  - المفتاح نفسه بحمولة مختلفة → 409 idempotency_conflict.
 *  - فشل (4xx/5xx) أو استثناء → تحرير السجلّ (المفتاح قابل لإعادة المحاولة).
 *  - سجلّ منتهٍ/قفلٌ مهجور → يُستعاد ويُعامَل أوّل طلب.
 *
 * سياسة إعادة التشغيل: **2xx فقط** تُخزَّن وتُعاد. لا يُعاد أيّ 5xx إطلاقًا.
 * استجابةٌ متجاوزةٌ للحدّ (>64KB) لا تُخزَّن (تُعلَّم `Idempotency-Stored: false`).
 */
class EnforceApiIdempotency
{
    /** حدّ تكرار المطالبة عند تسابقٍ حادّ (سجلٌّ حُذف بين الإدراج والقراءة). */
    private const MAX_CLAIM_ATTEMPTS = 3;

    public function handle(Request $request, Closure $next): Response
    {
        // idempotency للطرق غير الآمنة فقط؛ GET/HEAD/OPTIONS تمرّ بلا اشتراط مفتاح.
        if (in_array(strtoupper($request->getMethod()), ['GET', 'HEAD', 'OPTIONS'], true)) {
            return $next($request);
        }

        $client = $request->user();
        if (! $client instanceof ApiClient) {
            // دفاعي: يجب أن يسبقه AuthenticateApiClient. لا هوية ⇒ لا idempotency.
            return PublicApiResponse::error(
                $request, PublicApiErrorCode::UNAUTHENTICATED, 'مصادقة الـ API مطلوبة.', 401,
            );
        }

        $rawKey = (string) $request->headers->get('Idempotency-Key', '');
        if ($rawKey === '') {
            return PublicApiResponse::error(
                $request, PublicApiErrorCode::IDEMPOTENCY_KEY_REQUIRED,
                'ترويسة Idempotency-Key مطلوبة لهذه العملية.', 400,
            );
        }
        if (! PublicApiIdempotency::isValidKey($rawKey)) {
            return PublicApiResponse::error(
                $request, PublicApiErrorCode::INVALID_IDEMPOTENCY_KEY,
                'قيمة Idempotency-Key غير صالحة (طول أو محارف غير مسموحة).', 400,
            );
        }

        $keyHash = PublicApiIdempotency::hashKey($rawKey);
        $fingerprint = PublicApiIdempotency::fingerprint($request);
        $routeIdentity = $request->route()?->getName() ?? ($request->method() . ' ' . $request->path());

        [$state, $record] = $this->claim($client, $request, $keyHash, $fingerprint, $routeIdentity, 0);

        // حالة موجزة لسجلّ التدقيق: created (تنفيذٌ أوّلي) / replayed / in_progress / conflict.
        $request->attributes->set('public_api_idempotency_status', match ($state) {
            'claimed'   => 'created',
            'completed' => 'replayed',
            default     => $state,
        });

        if ($state === 'conflict') {
            return PublicApiResponse::error(
                $request, PublicApiErrorCode::IDEMPOTENCY_CONFLICT,
                'أُعيد استعمال Idempotency-Key نفسه لعمليةٍ أو حمولةٍ مختلفة.', 409,
            );
        }

        if ($state === 'in_progress') {
            return PublicApiResponse::error(
                $request, PublicApiErrorCode::IDEMPOTENCY_IN_PROGRESS,
                'طلبٌ سابقٌ بالمفتاح نفسه قيد المعالجة؛ أعد المحاولة لاحقًا.', 409,
            );
        }

        if ($state === 'completed') {
            return $this->replay($record);
        }

        // state === 'claimed' — نملك التنفيذ.
        try {
            $response = $next($request);
        } catch (Throwable $e) {
            $this->release($record);   // حرِّر القفل فالمفتاح قابل لإعادة المحاولة.
            throw $e;                   // يحوّله عارض الأخطاء إلى مغلّف Public موحّد.
        }

        $this->finalize($record, $response);

        return $response;
    }

    /**
     * مطالبة ذرّية بالمفتاح. تعيد [state, record] حيث state ∈
     * claimed | in_progress | completed | conflict.
     *
     * @return array{0: string, 1: PublicApiIdempotencyKey|null}
     */
    private function claim(
        ApiClient $client,
        Request $request,
        string $keyHash,
        string $fingerprint,
        string $routeIdentity,
        int $attempt,
    ): array {
        $now = now();

        try {
            $record = new PublicApiIdempotencyKey();
            $record->forceFill([
                'tenant_id'           => $client->tenant_id,
                'api_client_id'       => $client->getKey(),
                'key_hash'            => $keyHash,
                'method'              => strtoupper($request->getMethod()),
                'route_identity'      => mb_substr($routeIdentity, 0, 191),
                'request_fingerprint' => $fingerprint,
                'status'              => PublicApiIdempotencyKey::STATUS_IN_PROGRESS,
                'locked_at'           => $now,
                'expires_at'          => $now->copy()->addHours(PublicApiIdempotency::RETENTION_HOURS),
            ]);
            $record->save();

            return ['claimed', $record];
        } catch (QueryException $e) {
            if (! $this->isUniqueViolation($e)) {
                throw $e;
            }
        }

        // اصطدمنا بالقيد الفريد — يوجد سجلٌّ لهذا المفتاح.
        $existing = PublicApiIdempotencyKey::query()
            ->where('api_client_id', $client->getKey())
            ->where('key_hash', $keyHash)
            ->first();

        if ($existing === null) {
            // تسابق: حُذف بين فشل الإدراج والقراءة — أعد المحاولة بحدود.
            if ($attempt + 1 >= self::MAX_CLAIM_ATTEMPTS) {
                return ['in_progress', null];
            }

            return $this->claim($client, $request, $keyHash, $fingerprint, $routeIdentity, $attempt + 1);
        }

        // منتهٍ ⇒ عامله غائبًا: احذف وأعد المطالبة (أوّل طلب فعليًا).
        if ($existing->expires_at !== null && $existing->expires_at->isPast()) {
            $this->release($existing);

            return $attempt + 1 >= self::MAX_CLAIM_ATTEMPTS
                ? ['in_progress', null]
                : $this->claim($client, $request, $keyHash, $fingerprint, $routeIdentity, $attempt + 1);
        }

        // نفس المفتاح ببصمةٍ مختلفة ⇒ تعارض (أيًّا كانت الحالة).
        if (! hash_equals((string) $existing->request_fingerprint, $fingerprint)) {
            return ['conflict', $existing];
        }

        if ($existing->status === PublicApiIdempotencyKey::STATUS_COMPLETED) {
            return ['completed', $existing];
        }

        // in_progress: قفلٌ مهجور (طلبٌ انهار قبل الإكمال) ⇒ استعادة.
        if ($existing->locked_at !== null
            && $existing->locked_at->lt($now->copy()->subSeconds(PublicApiIdempotency::IN_PROGRESS_TTL_SECONDS))) {
            $this->release($existing);

            return $attempt + 1 >= self::MAX_CLAIM_ATTEMPTS
                ? ['in_progress', null]
                : $this->claim($client, $request, $keyHash, $fingerprint, $routeIdentity, $attempt + 1);
        }

        return ['in_progress', $existing];
    }

    /** إكمال أو تحرير حسب صنف الاستجابة. 2xx (محدودة) تُخزَّن؛ غيرها تُحرَّر. */
    private function finalize(PublicApiIdempotencyKey $record, Response $response): void
    {
        $status = $response->getStatusCode();

        if ($status < 200 || $status >= 300) {
            $this->release($record); // 4xx/5xx: لا تُخزَّن ولا تُعاد — المفتاح متاح لإعادة المحاولة.

            return;
        }

        $body = $response->getContent();
        if ($body === false || strlen($body) > PublicApiIdempotency::MAX_REPLAY_BYTES) {
            // استجابة متجاوزة/دفقية: سياسة صريحة — لا تُخزَّن (لا ضمان إعادة تشغيل).
            $this->release($record);
            $response->headers->set('Idempotency-Stored', 'false');

            return;
        }

        $safeHeaders = [];
        $contentType = $response->headers->get('Content-Type');
        if (is_string($contentType) && $contentType !== '') {
            $safeHeaders['Content-Type'] = $contentType;
        }

        try {
            $record->forceFill([
                'status'           => PublicApiIdempotencyKey::STATUS_COMPLETED,
                'response_status'  => $status,
                'response_body'    => $body,
                'response_headers' => $safeHeaders,
                'completed_at'     => now(),
            ])->save();
        } catch (Throwable) {
            // تعذّر التخزين لا يبطل الاستجابة الأصلية؛ حرِّر القفل بهدوء.
            $this->release($record);
        }
    }

    /** إعادة تشغيل الاستجابة المخزَّنة حرفيًا — دون تنفيذ العملية ثانية. */
    private function replay(PublicApiIdempotencyKey $record): Response
    {
        $headers = is_array($record->response_headers) ? $record->response_headers : [];
        $response = new IlluminateResponse(
            (string) $record->response_body,
            (int) ($record->response_status ?? 200),
            $headers,
        );
        $response->headers->set('Idempotency-Replayed', 'true');

        return $response;
    }

    private function release(PublicApiIdempotencyKey $record): void
    {
        try {
            $record->delete();
        } catch (Throwable) {
            // تحرير القفل best-effort؛ الاحتفاظ يلتقط الباقي.
        }
    }

    private function isUniqueViolation(QueryException $e): bool
    {
        $sqlState = (string) $e->getCode();
        if ($sqlState === '23505' || $sqlState === '23000') {
            return true;
        }

        $message = strtolower($e->getMessage());

        return str_contains($message, 'unique constraint')
            || str_contains($message, 'unique violation')
            || str_contains($message, 'duplicate');
    }
}
