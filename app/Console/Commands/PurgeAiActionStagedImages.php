<?php

namespace App\Console\Commands;

use App\Services\AiActionStagedImageRetention;
use Illuminate\Console\Command;

/**
 * AI-ACTIONS-07: يحذف الصور المرحلية الخاصة (البايتات التي سمّتها المعاينة) التي انتهت حاجتها، وفق سياسة الاحتفاظ في
 * `AiActionStagedImageRetention`. لا يمسّ صور المنتج النهائية، ولا ما يحتاجه اعتمادٌ حيّ أو تنفيذٌ جارٍ أو نافذة إصلاح.
 * `--dry-run` يَعُدّ الملفات والحجم المرشّح دون حذف. آمن للتكرار. يتجاوز نطاق المستأجر عمداً (صيانة منصّة).
 *
 * المخرج سطرٌ واحد ثابت المفاتيح (`status=ok|attention`) ليُراقَب من سجل الخدمة؛ رمز الخروج ≠ 0 حين يوجد
 * `failed` أو `unsafe` أو `unverifiable` (انظر docs/engineering/AWJ_AI_ACTIONS_SCHEDULER_RUNBOOK.md).
 */
class PurgeAiActionStagedImages extends Command
{
    protected $signature = 'ai-actions:purge-staged-images
        {--dry-run : عُدّ المرشّح للحذف دون حذف}
        {--tenant= : اقتصر على مستأجر واحد}
        {--limit=500 : أقصى عدد إجراءات يُفحص في التشغيلة}
        {--max-seconds=240 : لا يبدأ إجراءً جديداً بعد هذا الزمن (0 = بلا حدّ)؛ ما تبقّى يُستكمل في التشغيلة التالية}';

    protected $description = 'يحذف الصور المرحلية الخاصة لإجراءات الذكاء الاصطناعي المنتهية حاجتها (يدعم --dry-run)';

    public function handle(AiActionStagedImageRetention $retention): int
    {
        $tenant = $this->option('tenant');
        $result = $retention->run(
            (bool) $this->option('dry-run'),
            is_string($tenant) && $tenant !== '' ? $tenant : null,
            max(1, (int) $this->option('limit')),
            max(0, (int) $this->option('max-seconds')),
        );
        $attention = $result['failed'] > 0 || $result['unsafe'] > 0 || $result['unverifiable'] > 0;

        $this->line(($result['dry_run'] ? '[dry-run] ' : '').'ai-actions:purge-staged-images status='.($attention ? 'attention' : 'ok')
            .' actions='.$result['actions'].' images='.$result['images'].' bytes='.$result['bytes']
            .' failed='.$result['failed'].' unsafe='.$result['unsafe'].' unverifiable='.$result['unverifiable']
            .' remaining='.$result['remaining'].' duration_ms='.$result['duration_ms']);
        foreach ($result['skipped'] as $reason => $count) {
            $this->line('  skipped.'.$reason.'='.$count);
        }

        return $attention ? self::FAILURE : self::SUCCESS;
    }
}
