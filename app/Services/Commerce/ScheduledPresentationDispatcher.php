<?php

namespace App\Services\Commerce;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * CUST-H1-4 — مُرسِل دفعة النشر المجدول المستحقّ (`storefront-presentations:dispatch-due`).
 * مرجعها المعماري: `docs/plans/store/CUST-H1-ARCH-1-...md` §14.
 *
 * نمطٌ مطابق لـ`WebhookDeliveryProcessor` (PR-7) المُستقرّ فعلاً في هذا
 * المستودع: أمر Artisan متزامن — **بلا عامل خلفي** (الإنتاج `QUEUE_CONNECTION=sync`،
 * راجع قسم "تقرير أدلّة التشغيل" في تقرير التنفيذ) — يُطالب دفعةً محدودة
 * ويعالج كل عنصر بمعزلٍ عن غيره، ثم يخرج. آمنٌ للتشغيل المتكرّر: القاعدة هي
 * مصدر الحقيقة الوحيد، فتعطُّل المُجدوِل لفترة لا يفقد شيئاً — الدفعة
 * التالية تلتقط كل ما استحقّ منذ آخر تشغيل (استرداد ما بعد التعطّل).
 *
 * **لا مطالبة إيجار ذرّية منفصلة هنا** (خلافاً لـ`WebhookDeliveryProcessor`):
 * وحدة التنفيذ نفسها (`StorefrontPresentationVersionService::executeScheduledPublish()`)
 * ذرّية بالكامل تحت قفل صفٍّ + فحص جيل الجدولة — تشغيلان متزامنان لعنصرٍ
 * واحد يتسلسلان عبر قفل الصف، والخاسر يعود `OUTCOME_STALE_GENERATION`/
 * `OUTCOME_NOT_SCHEDULED` بأمان بدل الانتظار على إيجار. إضافة مطالبة منفصلة
 * كانت طبقة تزامن زائدة فوق طبقة موجودة أصلاً تكفي وحدها.
 *
 * الاستعلام: JOIN مباشر بمؤشر الرأس (`h.scheduled_version_id = v.id`) لا
 * مسحاً لكل صفوف الجدول — "مستحقّ" يعني حرفياً "هو المجدول الحالي فعلياً
 * ووقته حان"، لا مجرّد صفٍّ له `scheduled_for` قديم (لن يتبقّى مثله عادةً،
 * لكن الـJOIN مصدر الحقيقة الوحيد لا افتراضٌ عن نظافة البيانات). محدودٌ
 * بحجم دفعة ومُرتَّبٌ بالأقدم استحقاقاً أولاً.
 */
final class ScheduledPresentationDispatcher
{
    /** حجمٌ صريح لا إعدادٌ منفصل — لا وحدة تشغيلية أخرى تحتاج ضبطه بعد. */
    public const DEFAULT_BATCH_SIZE = 50;

    public function __construct(private readonly StorefrontPresentationVersionService $versions)
    {
    }

    /** @return array{due: int, published: int, skipped: int, failed: int} */
    public function dispatchDueBatch(?int $limit = null): array
    {
        $limit = $limit !== null ? max(1, $limit) : self::DEFAULT_BATCH_SIZE;
        $now = now();

        $due = DB::table('storefront_presentation_versions as v')
            ->join('storefront_presentations as h', 'h.scheduled_version_id', '=', 'v.id')
            ->whereNotNull('v.scheduled_for')
            ->where('v.scheduled_for', '<=', $now)
            ->orderBy('v.scheduled_for')
            ->limit($limit)
            ->select(['v.id as version_id', 'v.storefront_id', 'v.schedule_generation'])
            ->get();

        $summary = ['due' => 0, 'published' => 0, 'skipped' => 0, 'failed' => 0];

        foreach ($due as $row) {
            $summary['due']++;
            $summary[$this->dispatchOne((string) $row->storefront_id, (string) $row->version_id, (int) $row->schedule_generation)]++;
        }

        return $summary;
    }

    /** @return 'published'|'skipped'|'failed' كل عنصر بمعزلٍ تام — فشلٌ واحد لا يوقف الدفعة. */
    private function dispatchOne(string $storefrontId, string $versionId, int $expectedGeneration): string
    {
        $context = ['storefront_id' => $storefrontId, 'version_id' => $versionId];

        try {
            $outcome = $this->versions->executeScheduledPublish($storefrontId, $versionId, $expectedGeneration);

            if ($outcome === StorefrontPresentationVersionService::OUTCOME_PUBLISHED) {
                Log::info('storefront_presentations.schedule.published', $context);

                return 'published';
            }

            if ($outcome === StorefrontPresentationVersionService::OUTCOME_VALIDATION_REJECTED) {
                // يحتاج تصحيحاً من التاجر — نُظهره في السجلّ بمستوى تحذير لا معلومة عابرة.
                Log::warning('storefront_presentations.schedule.validation_rejected', $context);

                return 'skipped';
            }

            Log::info('storefront_presentations.schedule.skipped', $context + ['outcome' => $outcome]);

            return 'skipped';
        } catch (Throwable $e) {
            Log::error('storefront_presentations.schedule.failed', $context + ['error' => $e->getMessage()]);

            return 'failed';
        }
    }
}
