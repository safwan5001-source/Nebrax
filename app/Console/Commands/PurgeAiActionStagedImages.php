<?php

namespace App\Console\Commands;

use App\Services\AiActionStagedImageRetention;
use Illuminate\Console\Command;

/**
 * AI-ACTIONS-07: يحذف الصور المرحلية الخاصة (البايتات التي سمّتها المعاينة) التي انتهت حاجتها، وفق سياسة الاحتفاظ في
 * `AiActionStagedImageRetention`. لا يمسّ صور المنتج النهائية، ولا ما يحتاجه اعتمادٌ حيّ أو تنفيذٌ جارٍ أو نافذة إصلاح.
 * `--dry-run` يَعُدّ الملفات والحجم المرشّح دون حذف. آمن للتكرار. يتجاوز نطاق المستأجر عمداً (صيانة منصّة).
 */
class PurgeAiActionStagedImages extends Command
{
    protected $signature = 'ai-actions:purge-staged-images
        {--dry-run : عُدّ المرشّح للحذف دون حذف}
        {--tenant= : اقتصر على مستأجر واحد}
        {--limit=500 : أقصى عدد إجراءات يُفحص في التشغيلة}';

    protected $description = 'يحذف الصور المرحلية الخاصة لإجراءات الذكاء الاصطناعي المنتهية حاجتها (يدعم --dry-run)';

    public function handle(AiActionStagedImageRetention $retention): int
    {
        $tenant = $this->option('tenant');
        $result = $retention->run(
            (bool) $this->option('dry-run'),
            is_string($tenant) && $tenant !== '' ? $tenant : null,
            max(1, (int) $this->option('limit')),
        );

        $this->line(($result['dry_run'] ? '[dry-run] ' : '')
            .'actions='.$result['actions'].' images='.$result['images'].' bytes='.$result['bytes']
            .' failed='.$result['failed'].' unsafe='.$result['unsafe']);
        foreach ($result['skipped'] as $reason => $count) {
            $this->line('  skipped.'.$reason.'='.$count);
        }

        return $result['failed'] > 0 || $result['unsafe'] > 0 ? self::FAILURE : self::SUCCESS;
    }
}
