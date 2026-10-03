<?php

namespace App\Services\Accounting;

use App\Models\DeliveryInvoiceContext;
use App\Models\DeliveryPlatformProfile;
use App\Models\DeliveryPlatformProfileVersion as Version;
use App\Models\Invoice;
use App\Models\User;
use App\Services\DeliveryPlatformConfigService;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * يثبّت سياق منصة توصيل على فاتورة — DLV-ACCOUNTING-1 (DG-2).
 *
 * **تسجيل فقط**: لا يُنشئ فاتورة ولا سند قبض ولا قيداً. يستهلك الإعداد
 * المعتمد فعلاً عبر `DeliveryPlatformConfigService::resolve()` (DLV-FOUNDATION-1)
 * فيثبّت لقطة الفرع/القناة/الملف/النسخة لحظة التسجيل — لا مرجعاً حيّاً.
 *
 * **idempotent**: `record()` لفاتورة تحمل سياقاً مسجَّلاً مسبقاً بنفس الملف
 * والنسخة تعيد الصف القائم (لا صفّ ثانٍ، لا خطأ) — إعادة محاولة بعد استجابة
 * ملتبسة آمنة. تعارض صريح (ملف/نسخة مختلفة) يُرفض؛ السياق لا يُعدَّل أبداً.
 */
class DeliveryInvoiceContextService
{
    public function __construct(private readonly DeliveryPlatformConfigService $configService) {}

    /**
     * @param  array{sales_channel_id?:string,version_id?:string,external_order_reference?:?string}  $options
     */
    public function record(
        Invoice $invoice,
        DeliveryPlatformProfile $profile,
        array $options = [],
        ?User $actor = null,
    ): DeliveryInvoiceContext {
        return DB::transaction(function () use ($invoice, $profile, $options, $actor) {
            $locked = Invoice::query()->whereKey($invoice->getKey())->lockForUpdate()->first();
            if ($locked === null) {
                throw new RuntimeException('الفاتورة يجب أن تخص المستأجر النشط.');
            }
            // مسودة قابلة للحذف (`InvoiceService::deleteDraft()`)؛ قيد FK المقيَّد
            // على `invoice_id` كان سيعطّل حذفها لو حملت سياقاً. السياق توثيقٌ
            // لمستندٍ نهائي، فيُسجَّل بعد الترحيل حصراً — لا حاجة لتنسيقٍ مع الحذف.
            if (! $locked->isPosted()) {
                throw new RuntimeException('سياق منصة التوصيل يُسجَّل على فاتورة مرحّلة فقط.');
            }

            $existing = DeliveryInvoiceContext::query()->where('invoice_id', $locked->id)->first();
            $explicitVersionId = $options['version_id'] ?? null;
            $providedReference = $this->normalizeReference($options['external_order_reference'] ?? null);

            // إعادة محاولة بلا نسخة صريحة لفاتورة مسجَّلة بالفعل لا تُعاد مقارنتها
            // بأحدث نسخة حالياً — تعديلٌ لاحق على الملف بين المحاولتين كان سيحوّل
            // إعادة المحاولة العادية (بلا نسخة محدَّدة) إلى تعارضٍ زائف رغم أن
            // الصف الثابت الموجود هو نفسه هوية العملية المكتملة فعلاً. تعارضٌ
            // حقيقي (ملف مختلف، أو نسخة مطلوبة صراحةً تخالف المسجَّل) يبقى مرفوضاً.
            if ($existing !== null) {
                if ((string) $existing->delivery_platform_profile_id !== (string) $profile->id) {
                    throw new RuntimeException('الفاتورة مرتبطة بسياق منصة توصيل مختلف مسبقاً — السياق لا يُعدَّل.');
                }
                if ($explicitVersionId !== null && (string) $existing->delivery_platform_profile_version_id !== (string) $explicitVersionId) {
                    throw new RuntimeException('الفاتورة مرتبطة بسياق نسخة تكوين مختلفة مسبقاً — السياق لا يُعدَّل.');
                }
                // مرجعٌ خارجي صريح يخالف المسجَّل تعارضٌ حقيقي — لا يُعامَل كتكرار
                // صامت يُبقي القديم بينما يظن المستدعي أن الجديد أُثبت. غياب المرجع
                // في إعادة المحاولة (لا رأي) يبقى كما كان أول مرة.
                if ($providedReference !== null && $providedReference !== (string) $existing->external_order_reference) {
                    throw new RuntimeException('الفاتورة مرتبطة بمرجع طلب خارجي مختلف مسبقاً — السياق لا يُعدَّل.');
                }

                return $existing;
            }

            // فاتورة "مدفوعة بالفعل" (`InvoiceService::settle()`) حُصِّلت بسند
            // قبض نقد/بنك عادي لحظة الترحيل — تسجيل سياق منصة **جديد** بعد ذلك
            // يناقض الواقع المحاسبي القائم فعلاً. يُفحص هنا بعد التحقق من وجود
            // سياق سابق لا قبله: تحصيل منصة لاحق لسياق مسجَّل مسبقاً صحيحٌ تماماً
            // ويرفع paid_amount فوق صفر — إعادة محاولة التسجيل حينها تكرارٌ مشروع
            // لا تناقض، ويجب أن تعيد الصف الثابت كما في أي إعادة محاولة أخرى.
            if ($locked->paid_amount > 0) {
                throw new RuntimeException('لا يمكن تسجيل سياق منصة توصيل جديد على فاتورة مُحصَّلة بالفعل.');
            }

            $resolved = $this->configService->resolve($profile, $locked->branch_id, $explicitVersionId);
            if ($resolved === null) {
                throw new RuntimeException('منصة التوصيل بلا نسخة تكوين فعّالة.');
            }

            // سياسة المرجع الخارجي الفعلية (الفرع يرثها من النسخة أو يتجاوزها) —
            // `required` بلا مرجع، أو `none` مع مرجع، تناقضٌ صريح مع الإعداد
            // المعتمد يُرفض قبل أي كتابة، لا تجاهلٌ صامت لسياسة التحصيل المثبّتة.
            if ($resolved['external_reference_policy'] === Version::REFERENCE_REQUIRED && $providedReference === null) {
                throw new RuntimeException('سياسة منصة التوصيل تتطلب مرجع طلب خارجي ولم يُرسَل أي مرجع.');
            }
            if ($resolved['external_reference_policy'] === Version::REFERENCE_NONE && $providedReference !== null) {
                throw new RuntimeException('سياسة منصة التوصيل لا تقبل مرجع طلب خارجي.');
            }

            try {
                return DeliveryInvoiceContext::create([
                    'invoice_id' => $locked->id,
                    // صريحاً: `BelongsToBranch` يملأ `branch_id` من الفرع النشط إن
                    // غاب — فسياقٌ يُسجَّل من سياق فرع يخالف فرع الفاتورة (مهمة
                    // خلفية لاحقة تعمل بفرع آخر) كان سيُرفض خطأً كـ«منتحَل» في
                    // حارس النموذج. تمريره هنا يمنع الـtrait من استبداله أصلاً.
                    'branch_id' => $locked->branch_id,
                    'sales_channel_id' => $resolved['sales_channel_id'],
                    'delivery_platform_profile_id' => $profile->id,
                    'delivery_platform_profile_version_id' => $resolved['version_id'],
                    'collection_mode' => $resolved['collection_mode'],
                    'external_order_reference' => $providedReference,
                    'created_by' => $actor?->id,
                ]);
            } catch (QueryException $e) {
                // سباق: سياق أُنشئ بين الفحص والإدراج (unique(invoice_id)) — يُعامَل كمتكرر إن لم يتعارض.
                $race = DeliveryInvoiceContext::query()->where('invoice_id', $locked->id)->first();
                if ($race !== null
                    && (string) $race->delivery_platform_profile_id === (string) $profile->id
                    && (string) $race->delivery_platform_profile_version_id === (string) $resolved['version_id']) {
                    return $race;
                }

                throw $e;
            }
        });
    }

    private function normalizeReference(mixed $value): ?string
    {
        $value = is_string($value) ? trim($value) : null;

        return $value === null || $value === '' ? null : $value;
    }
}
