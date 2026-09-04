<?php

namespace App\Services\DocumentCenter;

use App\Contracts\DocumentSafetyScanner;
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

    /**
     * يشغّل الفاحص الفعلي ويسجّل قراره. لا يعلّم الملف CLEAN دون قرار فاصل.
     */
    public function scanAndRecord(DocumentFile $file, DocumentStorageService $storage, DocumentSafetyScanner $scanner): DocumentFile
    {
        $stream = $storage->readStream($file->storage_profile, $file->object_key);
        try {
            $decision = $scanner->scan($stream);
        } finally {
            if (is_resource($stream)) {
                fclose($stream);
            }
        }

        return $this->record($file, $decision, $scanner->providerName());
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
