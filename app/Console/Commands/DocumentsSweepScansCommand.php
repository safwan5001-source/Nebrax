<?php

namespace App\Console\Commands;

use App\Services\DocumentCenter\DocumentScanSweepService;
use Illuminate\Console\Command;

class DocumentsSweepScansCommand extends Command
{
    protected $signature = 'documents:sweep-scans
        {--older-than=15 : عمر الملف/التشغيل بالدقائق قبل اعتباره عالقاً}
        {--limit=100 : أقصى عدد ملفات في المرور الواحد}
        {--dry-run : عدّ فقط دون إرسال أو تغيير}';

    protected $description = 'يعيد إدخال ملفات مركز المستندات العالقة في pending إلى الفحص الأمني (لا يعلّم أي ملف CLEAN)، وينبّه على ما لا يُحلّ.';

    public function handle(DocumentScanSweepService $sweeper): int
    {
        $report = $sweeper->sweep((int) $this->option('older-than'), (int) $this->option('limit'), (bool) $this->option('dry-run'));

        $this->line('scanner_ready:     ' . ($report['scanner_ready'] ? 'yes' : 'NO'));
        $this->line('scanner_reachable: ' . ($report['scanner_reachable'] ? 'yes' : 'NO'));
        foreach (['examined', 'requeued', 'failed_closed', 'failed_runs', 'unattended'] as $key) {
            $this->line(str_pad($key . ':', 16) . $report[$key]);
        }

        $needsAttention = $report['failed_closed'] > 0 || $report['failed_runs'] > 0 || $report['unattended'] > 0;
        if ($needsAttention) {
            $this->warn('تنبيه تشغيلي: ملفات لم تُحَل آلياً (راجع document_scan_stuck في السجل ومسار retry).');
        }

        return $needsAttention ? self::FAILURE : self::SUCCESS;
    }
}
