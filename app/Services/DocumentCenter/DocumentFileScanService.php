<?php

namespace App\Services\DocumentCenter;

use App\Models\DocumentFile;
use App\Support\DocumentScanStatus;
use App\Support\DocumentWorkflowStatus;
use Illuminate\Support\Facades\DB;
use InvalidArgumentException;

/** نقطة التسجيل الوحيدة لقرار فاحص البرمجيات الضارة؛ سيستدعيها العامل في PR-3. */
class DocumentFileScanService
{
    public function __construct(private readonly DocumentWorkflowService $workflow)
    {
    }

    public function record(DocumentFile $file, DocumentScanStatus $decision, string $provider): DocumentFile
    {
        if ($decision === DocumentScanStatus::PENDING || $provider === '' || mb_strlen($provider) > 64) {
            throw new InvalidArgumentException('A final scan decision and bounded provider are required.');
        }

        return DB::transaction(function () use ($file, $decision, $provider): DocumentFile {
            $locked = DocumentFile::query()->whereKey($file->id)->lockForUpdate()->firstOrFail();
            $locked->fill([
                'scan_status' => $decision,
                'scan_provider' => $provider,
                'scanned_at' => now('UTC'),
            ])->save();

            if (in_array($decision, [DocumentScanStatus::INFECTED, DocumentScanStatus::FAILED], true)) {
                $batch = $locked->batch()->lockForUpdate()->firstOrFail();
                if (in_array($batch->status, [DocumentWorkflowStatus::RECEIVING, DocumentWorkflowStatus::RECEIVED], true)) {
                    $this->workflow->transition(
                        $batch,
                        DocumentWorkflowStatus::QUARANTINED,
                        'file_quarantined',
                        'system',
                        null,
                        $decision === DocumentScanStatus::INFECTED ? 'Malware detected.' : 'Safety scan failed closed.',
                        ['file_id' => $locked->id, 'scan_status' => $decision->value, 'scanner' => $provider],
                    );
                }
            }

            return $locked->fresh();
        }, 3);
    }
}
