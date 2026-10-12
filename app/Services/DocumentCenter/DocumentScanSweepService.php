<?php

namespace App\Services\DocumentCenter;

use App\Contracts\DocumentSafetyScanner;
use App\Models\DocumentFile;
use App\Models\DocumentProcessingRun;
use App\Services\PlatformIntegrationResolver;
use App\Support\DocumentProcessingStatus;
use App\Support\DocumentScanStatus;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * يلتقط ملفات `pending` العالقة ولا يُعلّم أيّاً منها CLEAN أبداً: كل ما يفعله إعادة
 * الإدخال في مسار الفحص الأمني القائم (أو إغلاقه FAILED عند استنفاد المحاولات).
 *
 *  - بلا تشغيل فحص: ملف استُقبل قبل إعداد الفاحص ⇒ ينشأ له تشغيل ويُرسل.
 *  - تشغيل QUEUED/RUNNING أقدم من العتبة ⇒ يُعاد إرساله حتى `max_attempts` ثم FAILED.
 *  - تشغيل FAILED ⇒ يُعدّ ويُنبَّه عنه فقط؛ إعادته قرار بشري عبر مسار retry القائم.
 *  - فاحص غير مُعدّ ⇒ لا يمكن فعل شيء: يُنبَّه به ولا يُمسّ شيء.
 *
 * التنبيه التشغيلي سجلّ `document_scan_stuck` (warning) ويعكسه رمز خروج الأمر.
 */
final class DocumentScanSweepService
{
    public function __construct(
        private readonly PlatformIntegrationResolver $settings,
        private readonly DocumentProcessingService $processing,
        private readonly DocumentSafetyScanner $scanner,
        private readonly TenantContext $tenant,
        private readonly BranchContext $branch,
    ) {
    }

    /**
     * @return array{scanner_ready:bool,scanner_reachable:bool,examined:int,requeued:int,failed_closed:int,failed_runs:int,unattended:int,dry_run:bool}
     */
    public function sweep(int $olderThanMinutes = 15, int $limit = 100, bool $dryRun = false): array
    {
        $report = [
            'scanner_ready' => $this->scannerReady(),
            'scanner_reachable' => false,
            'examined' => 0,
            'requeued' => 0,
            'failed_closed' => 0,
            'failed_runs' => 0,
            'unattended' => 0,
            'dry_run' => $dryRun,
        ];

        // لا نُحرق ميزانية محاولات الملفات بينما الفاحص نفسه معطّل: نتحقق أولاً ونُنبّه.
        $report['scanner_reachable'] = $report['scanner_ready'] && $this->reachable();

        $cutoff = now('UTC')->subMinutes(max(1, $olderThanMinutes));
        $files = DocumentFile::withoutGlobalScopes()
            ->where('scan_status', DocumentScanStatus::PENDING->value)
            ->whereNull('purged_at')
            ->where('created_at', '<=', $cutoff)
            ->orderBy('created_at')
            ->limit(max(1, min(500, $limit)))
            ->get();

        foreach ($files as $stub) {
            $report['examined']++;
            if (! $report['scanner_ready'] || ! $report['scanner_reachable']) {
                $report['unattended']++;
                continue;
            }

            $this->tenant->forget();
            $this->branch->forget();
            try {
                $this->tenant->set($stub->tenant_id);
                $this->branch->set($stub->branch_id);
                $file = DocumentFile::query()->whereKey($stub->id)->first();
                if ($file === null || $file->scan_status !== DocumentScanStatus::PENDING) {
                    continue;
                }

                $run = DocumentProcessingRun::query()
                    ->where('document_file_id', $file->id)
                    ->where('stage', DocumentProcessingService::STAGE_SAFETY_SCAN)
                    ->first();

                if ($run === null) {
                    if ($dryRun) {
                        $report['requeued']++;
                    } elseif ($this->processing->queueSafetyScans($file->batch) > 0) {
                        $report['requeued']++;
                    } else {
                        $report['unattended']++;
                    }
                } elseif ($run->status === DocumentProcessingStatus::FAILED) {
                    $report['failed_runs']++;
                } elseif (in_array($run->status, [DocumentProcessingStatus::QUEUED, DocumentProcessingStatus::RUNNING], true)
                    && ($run->updated_at === null || $run->updated_at->lte($cutoff))) {
                    if ($dryRun) {
                        $report['requeued']++;
                    } else {
                        $outcome = $this->processing->redispatchStaleSafetyScan($run, $file);
                        if ($outcome === 'requeued') {
                            $report['requeued']++;
                        } elseif ($outcome === 'failed_closed') {
                            $report['failed_closed']++;
                        }
                    }
                }
            } catch (Throwable $exception) {
                $report['unattended']++;
                Log::error('document_scan_sweep_error', ['file_id' => $stub->id, 'exception' => $exception::class]);
            } finally {
                $this->branch->forget();
                $this->tenant->forget();
            }
        }

        if (! $dryRun && $report['scanner_ready'] && ! $report['scanner_reachable']) {
            Log::error('document_scanner_unreachable', ['pending_examined' => $report['examined']]);
        }
        if (! $dryRun && ($report['failed_closed'] > 0 || $report['failed_runs'] > 0 || $report['unattended'] > 0)) {
            Log::warning('document_scan_stuck', $report);
        }

        return $report;
    }

    private function reachable(): bool
    {
        try {
            return $this->scanner->ping();
        } catch (Throwable) {
            return false;
        }
    }

    private function scannerReady(): bool
    {
        return ! $this->settings->documentProcessingIsAuthoritativelyDisabled()
            && $this->settings->activeConfiguration('malware_scanner') !== [];
    }
}
