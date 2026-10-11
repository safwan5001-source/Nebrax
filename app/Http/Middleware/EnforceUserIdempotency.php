<?php

namespace App\Http\Middleware;

use App\Models\UserRequestIdempotencyKey;
use App\Support\UserRequestIdempotency;
use Closure;
use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Http\Response as IlluminateResponse;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpFoundation\Response;
use Throwable;

/**
 * Idempotency اختياري لطلبات الواجهة (إنشاء مصروف/دفعة). **غياب الترويسة = السلوك القديم حرفياً**
 * (توافق خلفي كامل). بوجود `Idempotency-Key`:
 *  - أول طلب          ⇒ مطالبة (إدراج in_progress) ثم تنفيذ ثم تخزين استجابة 2xx.
 *  - تكرار متزامن     ⇒ 409 `idempotency_in_progress` بلا تنفيذ.
 *  - تكرار بعد النجاح ⇒ إعادة الاستجابة المخزَّنة (`Idempotency-Replayed: true`) بلا تنفيذ ثانٍ.
 *  - المفتاح نفسه بحمولة مختلفة ⇒ 409 `idempotency_conflict`.
 *  - فشل (غير 2xx) أو استثناء ⇒ تحرير المفتاح، فإعادة الطلب محاولة أولى نظيفة (يتكامل مع ذرّية
 *    المرفقات في S1: فشل رفع لا يترك أباً ولا مفتاحاً).
 *  - مفتاحان مختلفان ⇒ عمليتان مشروعتان مستقلتان.
 *
 * البوابة = قيد فريد `(tenant_id, user_id, key_hash)`؛ المطالبة تُلتزم خارج معاملة العمل فيراها الطلب
 * المتزامن. لا يمسّ أي خدمة مالية ولا القيود: الإعادة لا تصل إلى المتحكّم أصلاً.
 */
class EnforceUserIdempotency
{
    private const MAX_CLAIM_ATTEMPTS = 3;

    public function handle(Request $request, Closure $next): Response
    {
        $raw = $request->headers->get('Idempotency-Key');
        if ($raw === null || $raw === '') {
            return $next($request);
        }
        $user = $request->user();
        if ($user === null || ! UserRequestIdempotency::isValidKey((string) $raw)) {
            return response()->json([
                'message' => 'قيمة Idempotency-Key غير صالحة (8–255 محرفاً: أحرف وأرقام و . _ : -).',
                'code' => 'invalid_idempotency_key',
            ], 400);
        }

        $keyHash = UserRequestIdempotency::hashKey((string) $raw);
        $fingerprint = UserRequestIdempotency::fingerprint($request);
        $route = mb_substr($request->route()?->getName() ?? ($request->method().' '.$request->path()), 0, 191);

        [$state, $record] = $this->claim($request, $keyHash, $fingerprint, $route, 0);

        if ($state === 'conflict') {
            return response()->json([
                'message' => 'أُعيد استعمال Idempotency-Key نفسه لعملية أو حمولة مختلفة.',
                'code' => 'idempotency_conflict',
            ], 409);
        }
        if ($state === 'in_progress') {
            return response()->json([
                'message' => 'طلب سابق بالمفتاح نفسه قيد المعالجة؛ أعد المحاولة بعد قليل.',
                'code' => 'idempotency_in_progress',
            ], 409);
        }
        if ($state === 'completed') {
            return $this->replay($record);
        }

        try {
            $response = $next($request);
        } catch (Throwable $e) {
            $this->release($record);
            throw $e;
        }

        $this->finalize($record, $response);

        return $response;
    }

    /** @return array{0:string,1:UserRequestIdempotencyKey|null} */
    private function claim(Request $request, string $keyHash, string $fingerprint, string $route, int $attempt): array
    {
        $user = $request->user();
        $now = now();
        $record = new UserRequestIdempotencyKey();
        $record->forceFill([
            'tenant_id' => $user->tenant_id,
            'user_id' => $user->getKey(),
            'key_hash' => $keyHash,
            'method' => strtoupper($request->getMethod()),
            'route_identity' => $route,
            'request_fingerprint' => $fingerprint,
            'status' => UserRequestIdempotencyKey::STATUS_IN_PROGRESS,
            'locked_at' => $now,
            'expires_at' => $now->copy()->addSeconds(UserRequestIdempotency::IN_PROGRESS_LEASE_SECONDS),
        ]);

        try {
            // savepoint: على PostgreSQL يُفسد انتهاك القيد الفريد المعاملة المحيطة كلها.
            DB::transaction(fn () => $record->save());

            return ['claimed', $record];
        } catch (QueryException $e) {
            if (! $this->isUniqueViolation($e)) {
                throw $e;
            }
        }

        $existing = UserRequestIdempotencyKey::query()
            ->where('user_id', $user->getKey())
            ->where('key_hash', $keyHash)
            ->first();

        if ($existing === null) {
            return $attempt + 1 >= self::MAX_CLAIM_ATTEMPTS
                ? ['in_progress', null]
                : $this->claim($request, $keyHash, $fingerprint, $route, $attempt + 1);
        }
        if ($existing->expires_at !== null && $existing->expires_at->isPast()) {
            $this->release($existing);

            return $attempt + 1 >= self::MAX_CLAIM_ATTEMPTS
                ? ['in_progress', null]
                : $this->claim($request, $keyHash, $fingerprint, $route, $attempt + 1);
        }
        if (! hash_equals((string) $existing->request_fingerprint, $fingerprint)) {
            return ['conflict', $existing];
        }
        if ($existing->status === UserRequestIdempotencyKey::STATUS_COMPLETED) {
            return ['completed', $existing];
        }

        return ['in_progress', $existing];
    }

    private function finalize(UserRequestIdempotencyKey $record, Response $response): void
    {
        $status = $response->getStatusCode();
        $body = $response->getContent();
        if ($status < 200 || $status >= 300 || $body === false || strlen($body) > UserRequestIdempotency::MAX_REPLAY_BYTES) {
            // غير ناجح، أو لا يسع التخزين: لا ضمان إعادة تشغيل. تُحرَّر المطالبة (الحالة الأخيرة تُعلَّم).
            if ($status >= 200 && $status < 300) {
                $response->headers->set('Idempotency-Stored', 'false');
            }
            $this->release($record);

            return;
        }

        try {
            $contentType = $response->headers->get('Content-Type');
            $record->forceFill([
                'status' => UserRequestIdempotencyKey::STATUS_COMPLETED,
                'response_status' => $status,
                'response_body' => $body,
                'response_headers' => is_string($contentType) && $contentType !== '' ? ['Content-Type' => $contentType] : [],
                'completed_at' => now(),
                'expires_at' => now()->addHours(UserRequestIdempotency::RETENTION_HOURS),
            ])->save();
        } catch (Throwable) {
            // تعذّر التخزين لا يبطل الاستجابة الناجحة؛ يُترك المفتاح ليُحرَّر بانقضاء الإيجار.
            $this->release($record);
        }
    }

    private function replay(UserRequestIdempotencyKey $record): Response
    {
        $response = new IlluminateResponse(
            (string) $record->response_body,
            (int) ($record->response_status ?? 200),
            is_array($record->response_headers) ? $record->response_headers : [],
        );
        $response->headers->set('Idempotency-Replayed', 'true');

        return $response;
    }

    private function release(UserRequestIdempotencyKey $record): void
    {
        try {
            $record->delete();
        } catch (Throwable) {
        }
    }

    private function isUniqueViolation(QueryException $e): bool
    {
        $state = (string) $e->getCode();
        if ($state === '23505' || $state === '23000') {
            return true;
        }
        $m = strtolower($e->getMessage());

        return str_contains($m, 'unique constraint') || str_contains($m, 'unique violation') || str_contains($m, 'duplicate');
    }
}
