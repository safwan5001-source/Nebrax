<?php

namespace App\Services;

use App\Models\ImportPreview;
use App\Support\ImportChunk;
use App\Support\ImportChunkResult;
use App\Support\ImportJobDomain;
use App\Support\Settings;
use Illuminate\Http\UploadedFile;

/**
 * محوّل `purchase_import` (IMP-H5-S4a): استيراد فواتير المشتريات مسوداتٍ، **وحدته الفاتورة كلها** (`UNIT_DOCUMENT`) عبر `PurchaseImportService` وحده. مربوط بمعاينة فقط
 * (`PREVIEW_BOUND_ONLY`)، فلا تُنفَّذ نافذةٌ دون أن يقابلها حكم المعاينة غير المتجاوَز على الملف كله. بوابة الكتابة المباشرة المقابلة (`POST /purchases`) هي
 * `purchases.manage` + `EnsureApplicationActive:purchases.cycle` + (إن حُدِّد مستودع) صلاحية الفاعل على المخزن وفرعه.
 *
 * **`row_count` وحدات لا صفوف:** وقت الفحص لا مطابقة أعمدة ولا خيارات بعد، فيبقى العدّ تقديرياً (صفوف البيانات = حدّ أعلى للفواتير)، ويُعاد حسابه بالخيارات
 * المجمَّدة عند أول ترحيل (`recountOnFirstApply`) فيبلغ `processed_rows` (فواتير منجَزة) `row_count` بالضبط. نافذة القطعة تُحسب بالفواتير (لا تُجزَّأ فاتورة).
 *
 * الوحدات الفاشلة لا تُسجَّل في جدول الوحدات ولا ملف إصلاح لهذا المجال بعد (وحدة المستند ليست صفاً): رسالة التشغيلة الفاشلة تحمل أول الفواتير المعطوبة بصفّها ورقمها.
 */
class PurchaseImportAdapter extends SpreadsheetImportAdapter
{
    public const DOMAIN = ImportJobDomain::PURCHASE_IMPORT;

    public function domain(): string
    {
        return self::DOMAIN;
    }

    public function unit(): string
    {
        return self::UNIT_DOCUMENT;
    }

    public function maxRows(): int
    {
        return PurchaseImportService::DURABLE_MAX_ROWS;
    }

    public function canonicalOptions(array $raw): array
    {
        // لا تحويل مُسقِط للقيم الفاسدة: القيمة غير الصالحة تبقى كما وردت ليرفضها `PurchaseImportService::options()` (التحويل الصامت يجمّد خياراً مالياً خاطئاً).
        $lower = static fn (mixed $value): mixed => $value === null || $value === '' ? null : (is_scalar($value) ? strtolower(trim((string) $value)) : $value);
        $integer = static fn (mixed $value): mixed => match (true) {
            $value === null || $value === '' => null,
            is_string($value) && preg_match('/^\d{1,12}$/', $value) === 1 => (int) $value,
            is_float($value) && floor($value) === $value && abs($value) < 1e12 => (int) $value,
            default => $value,
        };
        $payment = $raw['default_payment_type'] ?? null;
        $inclusive = $raw['tax_inclusive'] ?? null;
        $rate = $integer($raw['default_tax_rate'] ?? null);

        // الغياب يعني «تفضيل المؤسسة» — يُحسَم **هنا** فيدخل بصمة المعاينة ويُجمَّد على التشغيلة: تفضيلٌ يتبدّل بين معاينة وقطعة لاحقة لا يغيّر ضريبة/إجمالي/نوع دفع فواتير
        // التشغيلة الواحدة صامتاً، وتبدّله بين المعاينة وإنشاء التشغيلة يُظهر اختلاف الخيارات فتُعاد المعاينة.
        $options = [
            'default_supplier_id' => $lower($raw['default_supplier_id'] ?? null),
            'default_payment_type' => $payment === null || $payment === '' ? (string) Settings::get('purchases', 'default_payment_type') : (is_scalar($payment) ? (string) $payment : $payment),
            'default_tax_rate' => $rate ?? (int) Settings::get('purchases', 'default_tax_rate'),
            'tax_inclusive' => $inclusive === null || $inclusive === '' ? (bool) Settings::get('purchases', 'default_tax_inclusive') : (is_bool($inclusive) ? $inclusive : (filter_var($inclusive, FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE) ?? $inclusive)),
            'warehouse_id' => $lower($raw['warehouse_id'] ?? null),
        ];

        return $this->withMapping($options, $raw);
    }

    public function recountOnFirstApply(string $tmpPath, string $extension, array $frozenOptions = []): ?int
    {
        $file = new UploadedFile($tmpPath, 'purchases.'.$extension, null, null, true);

        try {
            return app(PurchaseImportService::class)->unitCount($file, $frozenOptions, PurchaseImportService::DURABLE_MAX_ROWS);
        } catch (\RuntimeException) {
            // التعداد يحلّ المراجع من قاعدة البيانات (مورّد افتراضي عُطِّل، مستودع، …). فشله هنا خارج معاملة القطعة كان يُبقي التشغيلة `ready` للأبد (كل ترحيل 422 دون
            // انتقال حالة). نُبقي التقدير، فتفشل القطعة الأولى بالسبب نفسه برسالتها فتصير التشغيلة `failed` بوضوح.
            return null;
        }
    }

    public function applyChunk(ImportChunk $chunk): ImportChunkResult
    {
        $job = $chunk->job;
        // عدّ النافذة بالفواتير: `batch_offset` = فواتير منجَزة، `batch_size` = فواتير القطعة (الدفعة المقيَّدة بسقف المحرك).
        $chunkOptions = array_merge($chunk->options, ['batch_offset' => $chunk->offset, 'batch_size' => $chunk->batchSize]);
        // تشغيلةٌ مربوطةٌ بمعاينة: كل قطعة تتحقق أن فواتير نافذتها ما زالت تفعل ما اعتُمد (plan_drift).
        $plan = ImportPreviewService::decodePlan(
            $job->preview_id === null ? null : ImportPreview::query()->whereKey($job->preview_id)->value('plan')
        );
        if ($plan !== null) {
            $chunkOptions['expected_plan'] = $plan;
        }

        $result = app(PurchaseImportService::class)->apply($chunk->file, $chunkOptions, $chunk->userId, PurchaseImportService::DURABLE_MAX_ROWS);

        // قائمة الفواتير تُشتقّ حيّةً في كل قطعة (مراجع المورّد/المنتج من القاعدة). تغيّر عددها منذ بدء التشغيلة (تعديل مراجع متزامن) يُقصي فواتير بصمت أو يُبقي التشغيلة
        // `processing` للأبد: نفشل مغلقين — الاستثناء يتراجع بمعاملة القطعة كلها (لا فواتير جزئية من هذه القطعة).
        if ((int) $result['total_units'] !== (int) $job->row_count) {
            throw new \RuntimeException('تغيّر عدد الفواتير في الملف منذ بدء التشغيلة (تعديل متزامن لمراجع المورّدين أو المنتجات). أعد المعاينة وأنشئ تشغيلة جديدة.');
        }

        return new ImportChunkResult($result['created'] + $result['updated'] + $result['skipped'], $result);
    }
}
