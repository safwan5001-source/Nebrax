<?php

namespace App\Console\Commands;

use App\Models\ImportJob;
use App\Services\ImportJobFileStorage;
use App\Services\ImportPreviewService;
use App\Support\ImportJobStatus;
use Illuminate\Console\Command;

/**
 * تقليم تشغيلات الاستيراد الدائم المنتهية (PR-DUR-1) — احتفاظٌ حتميّ يمنع
 * نمو الجدول بلا حدّ، على غرار `webhooks:prune`. يمسّ `cancelled`/`failed`/
 * `completed` الأقدم من `purge_after`؛ لا يمسّ `uploaded`/`ready` مهما
 * تقادمت — التقليم ليس فحصاً لحالة نشطة.
 *
 * **`completed` مُضافة هنا (تصحيح مراجعة PR-DUR-2):** لم تكن قابلة للوصول
 * وقت PR-DUR-1 فاستُثنيت وقتها بحق؛ PR-DUR-2 جعلها حالة نهائية فعلية، وتشغيلة
 * `completed` تحمل `storage_path`/صفّاً كأي حالة نهائية أخرى — استثناؤها هنا
 * كان يسرّب الملف والصفّ إلى الأبد لكل استيراد ناجح.
 *
 * يتجاوز نطاق المستأجر عمداً (صيانة منصّة). `--dry-run` يَعُدّ فقط.
 */
class PruneImportJobs extends Command
{
    protected $signature = 'imports:prune {--dry-run : عُدّ المرشّح للحذف دون حذف}';

    protected $description = 'يقلّم تشغيلات الاستيراد الدائم المنتهية (ملغاة/فاشلة/مكتملة) الأقدم من نافذة الاحتفاظ';

    public function handle(ImportJobFileStorage $storage): int
    {
        $query = ImportJob::query()
            ->withoutGlobalScopes()
            ->whereIn('status', [ImportJobStatus::CANCELLED, ImportJobStatus::FAILED, ImportJobStatus::COMPLETED])
            ->where('purge_after', '<', now())
            // IMP-H1-S8b: أمٌّ لها تشغيلة إصلاح فرعية لم تنتهِ تُحفَظ — حذفها يمسح وحداتها (cascade) ويُنزع ربط الطفل (`nullOnDelete`) فيعمل بلا مطالبة.
            ->whereNotIn('id', ImportJob::query()->withoutGlobalScopes()->whereNotNull('parent_job_id')
                ->whereIn('status', ImportJobStatus::UNFINISHED)->select('parent_job_id'));

        if ((bool) $this->option('dry-run')) {
            $this->line('تشغيلات مرشّحة للتقليم: ' . $query->count());

            return self::SUCCESS;
        }

        $deleted = 0;
        $query->chunkById(200, function ($jobs) use ($storage, &$deleted) {
            foreach ($jobs as $job) {
                if ($job->storage_path !== null) {
                    $storage->delete($job->storage_path);
                }
                // IMP-H1-S1: أرشيف صور تشغيلة `completed` كان يبقى في التخزين الخاص إلى الأبد (الإلغاء وفشل الفحص
                // كانا ينظّفانه وحدهما)، فيتجاوز نافذة الاحتفاظ.
                if ($job->media_archive_storage_path !== null) {
                    $storage->delete($job->media_archive_storage_path);
                }
                $job->delete();
                $deleted++;
            }
        });

        $this->line('حُذفت تشغيلات استيراد: ' . $deleted);
        // IMP-H1-S3b: معاينات منتهية الصلاحية أو منفَقة قديمة لا قيمة لها بعد (لا ملفات، صفوف فقط).
        $this->line('حُذفت معاينات استيراد: ' . app(ImportPreviewService::class)->pruneStale());

        return self::SUCCESS;
    }
}
