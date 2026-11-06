<?php

namespace App\Services;

use App\Models\AccessChangeEvent;
use App\Models\User;
use App\Tenancy\TenantContext;
use Closure;
use Illuminate\Auth\Access\AuthorizationException;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;
use Throwable;

/**
 * FUEL-B3: كاتب سجل تدقيق تغييرات الأدوار والصلاحيات ونطاق الوصول (مصدر وحيد) — `access_change_events`.
 *
 * - `record()` للتغيير **الفعلي**: يُستدعى **داخل معاملة** العملية فيُثبَّت الحدث والتغيير معاً أو يتراجعان. تعديل بلا تغيير فعلي لا يُنتج حدثاً.
 *   أي فشل في كتابته يُرمى (التغيير لا يُثبَّت بلا أثره في السجل).
 * - `guard()` للمحاولة **المرفوضة**: يلفّ العملية **خارج** معاملتها؛ حين تُرفض (403/422 من حراس الأدوار والمستخدمين، أو `AuthorizationException`)
 *   تكون المعاملة قد تراجعت فيُكتب `outcome = denied` في معاملة مستقلة ثم يُعاد رمي الاستثناء كما هو. تعذّر كتابة سجل الرفض **لا يغيّر** نتيجة
 *   الرفض (يبقى 403/422 لا 500) — السجل أثر لا بوّابة.
 * - لا سرّ في السجل: أي مفتاح يشبه كلمة مرور/رمز/سر يُحجب بأي عمق قبل التخزين؛ ولا يُخزَّن بريد ولا اسم مستخدم (المعرّف يكفي).
 * - المحاولة المرفوضة تحمل **رمز الرفض/نصه الثابت** من كودنا (لا مدخلات المستخدم) وما حاوله من مفاتيح صلاحيات/معرّفات فقط.
 */
class AccessChangeAuditor
{
    public const REDACTED = '[redacted]';

    private const SECRET_PATTERN = '/(password|passwd|secret|token|api[_-]?key|private[_-]?key|authorization|credential)/i';

    public const SUBJECT_ROLE = 'role';
    public const SUBJECT_USER = 'user';
    public const SUBJECT_FUEL_STAFF = 'fuel_staff';

    /**
     * @param  array<string,mixed>|null  $before  لقطة قبل أو null للإنشاء
     * @param  array<string,mixed>|null  $after   لقطة بعد أو null للحذف
     */
    public function record(
        string $action,
        string $subjectType,
        ?string $subjectId,
        ?string $targetUserId,
        ?array $before,
        ?array $after,
        ?User $actor,
        ?string $reason = null,
    ): ?AccessChangeEvent {
        if ($before !== null && $after !== null) {
            [$before, $after] = $this->changedOnly($before, $after);
            if ($before === [] && $after === []) {
                return null;
            }
        }

        return AccessChangeEvent::create([
            'tenant_id' => $this->tenantId($actor),
            'actor_id' => $actor?->id,
            'target_user_id' => $targetUserId,
            'subject_type' => $subjectType,
            'subject_id' => $subjectId,
            'action' => $action,
            'outcome' => AccessChangeEvent::OUTCOME_APPLIED,
            'before' => $before === null ? null : $this->redact($before),
            'after' => $after === null ? null : $this->redact($after),
            'reason' => $reason === null ? null : mb_substr($reason, 0, 500),
            'occurred_at' => now(),
        ]);
    }

    /**
     * ينفّذ `$operation` ويسجّل رفضها (إن رُفضت) خارج معاملتها ثم يعيد رمي الاستثناء نفسه.
     *
     * @template T
     *
     * @param  Closure(): T  $operation
     * @param  array<string,mixed>|null  $attempted  ما حاوله الفاعل (مفاتيح صلاحيات/معرّفات) — يُحجب فيه أي سرّ
     * @return T
     */
    public function guard(
        string $action,
        string $subjectType,
        ?string $subjectId,
        ?string $targetUserId,
        ?User $actor,
        ?array $attempted,
        Closure $operation,
    ): mixed {
        try {
            return $operation();
        } catch (AuthorizationException $e) {
            $this->recordDenied($action, $subjectType, $subjectId, $targetUserId, $actor, 403, $e->getMessage(), $attempted);
            throw $e;
        } catch (HttpExceptionInterface $e) {
            if (in_array($e->getStatusCode(), [403, 422], true)) {
                $this->recordDenied($action, $subjectType, $subjectId, $targetUserId, $actor, $e->getStatusCode(), $e->getMessage(), $attempted);
            }
            throw $e;
        }
    }

    /** @param array<string,mixed>|null $attempted */
    public function recordDenied(
        string $action,
        string $subjectType,
        ?string $subjectId,
        ?string $targetUserId,
        ?User $actor,
        int $status,
        string $message,
        ?array $attempted = null,
    ): void {
        try {
            AccessChangeEvent::create([
                'tenant_id' => $this->tenantId($actor),
                'actor_id' => $actor?->id,
                'target_user_id' => $targetUserId,
                'subject_type' => $subjectType,
                'subject_id' => $subjectId,
                'action' => $action,
                'outcome' => AccessChangeEvent::OUTCOME_DENIED,
                'before' => null,
                'after' => $attempted === null ? null : $this->redact($attempted),
                'denial_reason' => mb_substr("{$status}: {$message}", 0, 255),
                'occurred_at' => now(),
            ]);
        } catch (Throwable $e) {
            // السجل أثر لا بوّابة: تعذّره لا يحوّل الرفض إلى 500 ولا يُسقط الطلب.
            report($e);
        }
    }

    /** @return array<string,mixed>|array<int,mixed> */
    private function redact(array $data): array
    {
        foreach ($data as $key => $value) {
            // علم منطقي (مثل password_changed) ليس سراً ويبقى مقروءاً؛ أي قيمة أخرى تحت مفتاح يشبه سرّاً تُحجب.
            if (is_string($key) && preg_match(self::SECRET_PATTERN, $key) === 1 && ! is_bool($value)) {
                $data[$key] = self::REDACTED;
            } elseif (is_array($value)) {
                $data[$key] = $this->redact($value);
            }
        }

        return $data;
    }

    /**
     * @param  array<string,mixed>  $before
     * @param  array<string,mixed>  $after
     * @return array{0: array<string,mixed>, 1: array<string,mixed>}
     */
    private function changedOnly(array $before, array $after): array
    {
        $changedBefore = $changedAfter = [];
        foreach (array_unique([...array_keys($before), ...array_keys($after)]) as $key) {
            $left = $before[$key] ?? null;
            $right = $after[$key] ?? null;
            if ($left !== $right) {
                $changedBefore[$key] = $left;
                $changedAfter[$key] = $right;
            }
        }

        return [$changedBefore, $changedAfter];
    }

    private function tenantId(?User $actor): string
    {
        return $actor?->tenant_id ?? app(TenantContext::class)->id()
            ?? throw new \RuntimeException('سياق المستأجر مطلوب لتسجيل حدث تدقيق الصلاحيات.');
    }
}
