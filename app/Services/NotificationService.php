<?php

namespace App\Services;

use App\Models\Notification;
use App\Models\User;
use App\Support\NotificationActions;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * ═══════════════════════════════════════════════════════════════
 *  أساس الإشعارات (PR-NOTIF-1) — بدائية التسليم الوحيدة
 * ═══════════════════════════════════════════════════════════════
 *  كل مُنتِج (مخزون، مالية، ZATCA...) يمرّ عبر `deliver()` حصراً — ممنوع
 *  إنشاء صفّ `notifications` مباشرة من أي مكان آخر. هذا يضمن نفس عقد
 *  الأمان (عزل المستأجر/المستلم، تحقّق الفئة/الشدة/الإجراء، dedup) لكل
 *  مُنتِج حالي أو مستقبلي بلا استثناء.
 *
 *  انظر docs/plans/alerts-notifications/AWJ_ALERTS_NOTIFICATIONS_MASTER_PLAN.md §5.1.
 */
class NotificationService
{
    public const CATEGORIES = ['alert', 'update'];
    public const SEVERITIES = ['info', 'warning', 'critical'];

    private const MAX_DATA_KEYS = 10;

    /**
     * القيم الممنوعة في مفاتيح `data` — بحثاً جزئياً (case-insensitive) لصدّ
     * أي تسمية تحمل معنى حسّاساً (تكلفة/سعر/سرّ/رابط) لا بحصر أسماء بعينها.
     */
    private const BLOCKED_DATA_KEY_FRAGMENTS = [
        'cost', 'price', 'token', 'secret', 'password', 'credential', 'key', 'url', 'link', 'href',
    ];

    /**
     * التسليم الآمن الوحيد. يتحقق من كل عقد، ويُعيد الصفّ القائم دون تكرار
     * إذا سبق تسليم نفس (tenant, recipient, dedupe_key) — سواء بفحصٍ مسبق
     * أو بتصادم القيد الفريد تحت تزامن حقيقي.
     *
     * @param  array{
     *   tenant_id: string,
     *   recipient_id: string,
     *   category: string,
     *   type: string,
     *   severity: string,
     *   title: string,
     *   message: string,
     *   dedupe_key: string,
     *   source_type?: ?string,
     *   source_id?: ?string,
     *   action?: ?string,
     *   data?: ?array,
     * } $payload
     */
    public function deliver(array $payload): Notification
    {
        $tenantId = $payload['tenant_id'] ?? null;
        if (! is_string($tenantId) || $tenantId === '') {
            throw new RuntimeException('معرّف المستأجر مطلوب لتسليم الإشعار.');
        }

        $recipientId = $payload['recipient_id'] ?? null;
        if (! is_string($recipientId) || $recipientId === '') {
            throw new RuntimeException('معرّف المستلم مطلوب لتسليم الإشعار.');
        }

        // يرفض صراحةً مستلماً من مستأجر آخر — لا نثق بسياق tenant الضمني هنا،
        // فقد يُستدعى هذا من مهمة مجدولة تكرّر عبر عدة مستأجرين.
        $recipientExists = User::query()
            ->where('tenant_id', $tenantId)
            ->whereKey($recipientId)
            ->exists();
        if (! $recipientExists) {
            throw new RuntimeException('المستلم لا ينتمي إلى هذا المستأجر.');
        }

        $category = $payload['category'] ?? null;
        if (! in_array($category, self::CATEGORIES, true)) {
            throw new RuntimeException('فئة إشعار غير صالحة.');
        }

        $severity = $payload['severity'] ?? null;
        if (! in_array($severity, self::SEVERITIES, true)) {
            throw new RuntimeException('شدّة إشعار غير صالحة.');
        }

        $type = $payload['type'] ?? null;
        if (! is_string($type) || ! preg_match('/^[a-z0-9]+(\.[a-z0-9_]+)+$/', $type)) {
            throw new RuntimeException('نوع إشعار غير صالح — يجب أن يكون بصيغة منقطة مثل module.event.');
        }

        $title = trim((string) ($payload['title'] ?? ''));
        if ($title === '') {
            throw new RuntimeException('عنوان الإشعار مطلوب.');
        }

        $message = trim((string) ($payload['message'] ?? ''));
        if ($message === '') {
            throw new RuntimeException('نص الإشعار مطلوب.');
        }

        $dedupeKey = $payload['dedupe_key'] ?? null;
        if (! is_string($dedupeKey) || $dedupeKey === '') {
            throw new RuntimeException('مفتاح تفرّد الإشعار (dedupe_key) مطلوب.');
        }

        $sourceType = $payload['source_type'] ?? null;
        $sourceId = $payload['source_id'] ?? null;
        if (($sourceType === null) !== ($sourceId === null)) {
            throw new RuntimeException('مصدر الإشعار يجب أن يحمل النوع والمعرّف معاً أو لا شيء منهما.');
        }

        $action = $payload['action'] ?? null;
        if ($action !== null) {
            $requiredSourceType = NotificationActions::ALLOWED[$action] ?? null;
            if ($requiredSourceType === null || $sourceType !== $requiredSourceType || $sourceId === null) {
                throw new RuntimeException('إجراء الإشعار غير مسموح به.');
            }
        }

        $data = $payload['data'] ?? null;
        if ($data !== null) {
            $this->assertSafeMetadata($data);
        }

        $attributes = [
            'tenant_id' => $tenantId,
            'recipient_id' => $recipientId,
            'category' => $category,
            'type' => $type,
            'severity' => $severity,
            'title' => $title,
            'message' => $message,
            'source_type' => $sourceType,
            'source_id' => $sourceId,
            'action' => $action,
            'data' => $data,
            'dedupe_key' => $dedupeKey,
        ];

        return DB::transaction(function () use ($tenantId, $recipientId, $dedupeKey, $attributes) {
            $existing = $this->findByDedupeKey($tenantId, $recipientId, $dedupeKey);
            if ($existing !== null) {
                return $existing;
            }

            try {
                return Notification::create($attributes);
            } catch (QueryException $e) {
                // تصادم تزامني حقيقي على القيد الفريد: مُرسِل آخر سبقنا بين
                // الفحص والإدراج. لا نُعيد رمي الخطأ — الإشعار موجود فعلاً.
                if ($this->isUniqueConstraintViolation($e)) {
                    $existing = $this->findByDedupeKey($tenantId, $recipientId, $dedupeKey);
                    if ($existing !== null) {
                        return $existing;
                    }
                }

                throw $e;
            }
        });
    }

    private function findByDedupeKey(string $tenantId, string $recipientId, string $dedupeKey): ?Notification
    {
        return Notification::query()
            ->where('tenant_id', $tenantId)
            ->where('recipient_id', $recipientId)
            ->where('dedupe_key', $dedupeKey)
            ->first();
    }

    private function isUniqueConstraintViolation(QueryException $e): bool
    {
        return $e->getCode() === '23000' || str_contains(strtolower($e->getMessage()), 'unique');
    }

    private function assertSafeMetadata(array $data): void
    {
        if (count($data) > self::MAX_DATA_KEYS) {
            throw new RuntimeException('بيانات الإشعار الإضافية تتجاوز الحدّ المسموح.');
        }

        foreach ($data as $key => $value) {
            if (! is_string($key) || $key === '') {
                throw new RuntimeException('مفتاح بيانات إشعار غير صالح.');
            }

            $normalizedKey = strtolower($key);
            foreach (self::BLOCKED_DATA_KEY_FRAGMENTS as $fragment) {
                if (str_contains($normalizedKey, $fragment)) {
                    throw new RuntimeException("حقل بيانات إشعار غير مسموح: {$key}");
                }
            }

            if ($value !== null && ! is_scalar($value)) {
                throw new RuntimeException('بيانات الإشعار يجب أن تكون قيماً بسيطة فقط.');
            }

            if (is_string($value) && preg_match('#^https?://#i', $value)) {
                throw new RuntimeException('لا يجوز تضمين روابط في بيانات الإشعار.');
            }
        }
    }
}
