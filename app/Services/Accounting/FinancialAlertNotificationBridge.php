<?php

namespace App\Services\Accounting;

use App\Models\FinancialControlAlert;
use App\Models\Notification;
use App\Models\User;
use App\Services\NotificationService;
use App\Tenancy\TenantContext;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * ═══════════════════════════════════════════════════════════════
 *  جسر إشعارات الرقابة المالية (PR-NOTIF-4) — ملاحظة فقط
 * ═══════════════════════════════════════════════════════════════
 *  لا يعدّل `FinancialControlService` ولا يستدعي `scan()` بنفسه ولا يكرّره؛
 *  يُستدعى من نقطتَي الاستدعاء القائمتين فقط (الأمر المجدول والتشغيل اليدوي)
 *  بعد انتهاء `scan()` تماماً، ويقرأ حصراً ما أعاده بالفعل. لا كتابة على
 *  `financial_control_alerts` ولا أي جدول محاسبي — الأثر الوحيد القابل
 *  للكتابة هنا هو صفّ إشعار عبر `NotificationService::deliver()`.
 *
 *  **كشف الانتقال بلا تعديل `synchronize()`:** كائنات `scan()['alerts']` هي
 *  نفسها التي نفّذت آخر `save()` داخل `synchronize()` — فتحمل أعلام Eloquent
 *  القياسية `wasRecentlyCreated` (تنبيه جديد) و`wasChanged('status')` (أعيد
 *  فتحه من resolved). فحصٌ متكرر بلا تغيّر لا يُحرّك أياً من العلمين، فلا
 *  إشعار له — تماماً كما يريد المخطط («لا للفحص المتكرر بلا جديد»).
 *
 *  **لا تصعيد شدّة:** قواعد `FinancialControlService` الأربع الحالية كلّها
 *  `critical` ثابتة؛ لا مفهوم تصعيد شدّة حقيقياً في النموذج اليوم، فلا يُبنى
 *  له مساراً إشعارياً وهمياً.
 *
 *  **النطاق مالي حصراً:** `scan()['alerts']` لا يحوي إطلاقاً تنبيهات الوقود
 *  المشتركة في نفس الجدول (`FuelStationAlertService` مصدرها المستقل) — لا
 *  حاجة لفلترة `rule` هنا لأن مصدر البيانات نفسه مُقيَّد ببنائه.
 */
class FinancialAlertNotificationBridge
{
    /**
     * @param  array<int, FinancialControlAlert>  $alerts  خرْج `scan()['alerts']` كما هو، بلا تعديل.
     */
    public function process(array $alerts): void
    {
        $tenantId = app(TenantContext::class)->id();
        if ($tenantId === null) {
            return;
        }

        foreach ($alerts as $alert) {
            if (! ($alert->wasRecentlyCreated || $alert->wasChanged('status'))) {
                continue;
            }

            try {
                $this->notify($tenantId, $alert);
            } catch (Throwable $e) {
                // فشل الإشعار لا يُفسد أبداً نتيجة الفحص المالي أو استجابته.
                Log::error('financial_alert_notification_failed', [
                    'tenant_id' => $tenantId,
                    'alert_id' => $alert->id,
                    'message' => $e->getMessage(),
                ]);
            }
        }
    }

    private function notify(string $tenantId, FinancialControlAlert $alert): void
    {
        // مفتاح التفرّد: عدد مرات الإشعار السابقة لهذا التنبيه، لا الطابع الزمني.
        // `first_detected_at` بدقّة ثانية واحدة في العمود (بلا كسور) قد يتطابق
        // فعلياً بين تفعيلٍ وإعادة فتحٍ سريعين ضمن نفس الثانية (أثبته اختبارٌ
        // فعلي) فيبتلع الثاني صامتاً. العدّ هنا يزداد فقط بعد إنشاء إشعارٍ فعلي،
        // فتُنشئ إعادة محاولة لنفس الحدث غير المتغيّر نفس المفتاح دوماً (العدّ
        // لم يتغيّر بعد)، بينما يحمل حدثٌ جديد فعلاً (بعد أن سبقه إشعارٌ محفوظ) عدّاً أكبر حتماً.
        $priorCount = Notification::query()
            ->where('tenant_id', $tenantId)
            ->where('source_type', 'financial_control_alert')
            ->where('source_id', $alert->id)
            ->count();
        $dedupeKey = "financial.alert_active:{$alert->id}:{$priorCount}";

        $notifications = app(NotificationService::class);

        foreach ($this->resolveRecipients($tenantId, $alert) as $recipient) {
            $notifications->deliver([
                'tenant_id' => $tenantId,
                'recipient_id' => $recipient->id,
                'category' => 'alert',
                'type' => 'financial.alert_active',
                'severity' => $alert->severity,
                'title' => $alert->title,
                'message' => $alert->description,
                'source_type' => 'financial_control_alert',
                'source_id' => $alert->id,
                'action' => 'view_financial_alert',
                'data' => ['rule' => $alert->rule],
                'dedupe_key' => $dedupeKey,
            ]);
        }
    }

    /**
     * مستلمون محافظون: من يملك `accounts.manage` فعلياً (نفس صلاحية إقرار/تشغيل
     * الفحص القائمة على هذا المورد بالذات) — لا `reports.view` الأوسع الذي
     * يشمل `staff` أيضاً. رؤية الفرع تتبع اصطلاح `branch_id IS NULL` القائم:
     * تنبيه بلا فرع محدَّد (أغلب القواعد المالية اليوم) يصل الجميع.
     *
     * @return Collection<int, User>
     */
    private function resolveRecipients(string $tenantId, FinancialControlAlert $alert): Collection
    {
        return User::query()
            ->where('tenant_id', $tenantId)
            ->where('is_active', true)
            ->get()
            ->filter(fn (User $user): bool => $user->hasPermission('accounts.manage')
                && ($alert->branch_id === null || $user->canAccessBranch($alert->branch_id)))
            ->values();
    }
}
