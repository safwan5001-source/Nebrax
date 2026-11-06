<?php

namespace App\Services;

use App\Models\FuelDelivery;
use App\Models\FuelDeliveryAttachment;
use App\Models\User;
use App\Services\DocumentCenter\DocumentFileInspector;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use RuntimeException;
use Throwable;

/**
 * FUEL-B5.1: مرفقات سند المورد لاستلام الوقود — فوق `AttachmentStorage` (R2/محلي) و`DocumentFileInspector` القائمين؛ لا تخزين موازٍ.
 *
 * - الفحص على **المحتوى الفعلي** (finfo + مطابقة الامتداد + سلامة الصورة/PDF) لا على ما يدّعيه العميل، ثم حصر الأنواع في PDF/JPG/PNG
 *   (لا WebP) وحجم ≤ `MAX_BYTES`، وعدد ≤ `MAX_PER_DELIVERY` للاستلام الواحد.
 * - **idempotent بالمحتوى:** SHA-256 فريد لكل استلام (فهرس في القاعدة)؛ إعادة رفع ملف مرفوع سابقاً (بعد انقطاع الرد) تُعيد الصف الموجود
 *   ولا تكتب ملفاً ثانياً.
 * - **ذرّية:** الملفات تُكتب أولاً (`putMany` كلها أو لا شيء) ثم تُدرج الصفوف في معاملة بعد قفل صف الاستلام؛ أي فشل لاحق يحذف ما كُتب.
 * - الحذف للمسودة فقط (المعتمد يحتفظ بدليله)، والملف يُحذف بعد الالتزام النهائي.
 * - لا أثر مخزني أو محاسبي ولا تغيير لأي حقل من الاستلام نفسه.
 */
class FuelDeliveryAttachmentService
{
    public const MAX_BYTES = 10 * 1024 * 1024;
    public const MAX_PER_DELIVERY = 10;
    public const MAX_PER_REQUEST = 5;

    /** @var list<string> */
    private const ALLOWED_MIME = ['application/pdf', 'image/jpeg', 'image/png'];

    public function __construct(
        private readonly AttachmentStorage $storage,
        private readonly DocumentFileInspector $inspector,
    ) {}

    /**
     * @param  array<int, UploadedFile>  $files
     * @return list<FuelDeliveryAttachment>
     */
    public function add(FuelDelivery $delivery, array $files, User $actor): array
    {
        if ($files === [] || count($files) > self::MAX_PER_REQUEST) {
            throw ValidationException::withMessages(['attachments' => 'أرفق من ملف إلى '.self::MAX_PER_REQUEST.' ملفات في الطلب الواحد.']);
        }

        $inspected = [];
        foreach ($files as $file) {
            if (! $file instanceof UploadedFile) {
                throw ValidationException::withMessages(['attachments' => 'ملف غير صالح.']);
            }
            $info = $this->inspector->inspect($file);
            if (! in_array($info->detectedMime, self::ALLOWED_MIME, true)) {
                throw ValidationException::withMessages(['attachments' => 'الأنواع المسموحة: PDF وJPG وPNG.']);
            }
            if ($info->sizeBytes > self::MAX_BYTES) {
                throw ValidationException::withMessages(['attachments' => 'حجم الملف يتجاوز 10 ميغابايت.']);
            }
            $inspected[] = [$file, $info];
        }

        // ملفات مكررة داخل الطلب نفسه تُدمج بمحتواها.
        $unique = [];
        foreach ($inspected as [$file, $info]) {
            $unique[$info->sha256] ??= [$file, $info];
        }

        $existing = FuelDeliveryAttachment::where('fuel_delivery_id', $delivery->id)->get()->keyBy('sha256');
        $fresh = array_filter($unique, fn ($pair, $hash) => ! $existing->has($hash), ARRAY_FILTER_USE_BOTH);
        if ($existing->count() + count($fresh) > self::MAX_PER_DELIVERY) {
            throw ValidationException::withMessages(['attachments' => 'الحد الأقصى '.self::MAX_PER_DELIVERY.' مرفقات للاستلام الواحد.']);
        }

        $stored = $fresh === [] ? [] : $this->storage->putMany(
            AttachmentStorage::DOMAIN_FUEL_DELIVERY,
            (string) $delivery->id,
            array_map(fn ($pair) => $pair[0], array_values($fresh)),
            "fuel-deliveries/{$delivery->id}",
        );

        try {
            return DB::transaction(function () use ($delivery, $fresh, $stored, $existing, $unique, $actor) {
                FuelDelivery::lockForUpdate()->findOrFail($delivery->id);
                $rows = [];
                $index = 0;
                foreach ($unique as $hash => [, $info]) {
                    if ($existing->has($hash)) {
                        $rows[] = $existing->get($hash);
                        continue;
                    }
                    $file = $stored[$index++];
                    $rows[] = FuelDeliveryAttachment::create([
                        'branch_id' => $delivery->branch_id,
                        'fuel_delivery_id' => $delivery->id,
                        'disk' => $file['disk'],
                        'path' => $file['path'],
                        'original_name' => $info->originalName,
                        'mime_type' => $info->detectedMime,
                        'size' => $info->sizeBytes,
                        'sha256' => $hash,
                        'uploaded_by' => $actor->id,
                    ]);
                }

                return $rows;
            });
        } catch (Throwable $e) {
            $this->storage->discard($stored);
            // سباق نادر: رفعٌ متزامن لنفس المحتوى سبقنا إلى الفهرس الفريد ⇒ نعيد الصفوف الفائزة بدل خطأ خام.
            if ($e instanceof \Illuminate\Database\UniqueConstraintViolationException) {
                $winners = FuelDeliveryAttachment::where('fuel_delivery_id', $delivery->id)->whereIn('sha256', array_keys($unique))->get();
                if ($winners->count() === count($unique)) {
                    return $winners->values()->all();
                }
            }

            throw $e;
        }
    }

    public function delete(FuelDelivery $delivery, FuelDeliveryAttachment $attachment): void
    {
        DB::transaction(function () use ($delivery, $attachment) {
            $locked = FuelDelivery::lockForUpdate()->findOrFail($delivery->id);
            if ($locked->status !== FuelDelivery::STATUS_DRAFT) {
                throw new RuntimeException('لا يمكن حذف مرفق استلام معتمد.');
            }
            $attachment->delete();
            DB::afterCommit(fn () => $this->storage->discard([['disk' => $attachment->disk, 'path' => $attachment->path]]));
        });
    }
}
