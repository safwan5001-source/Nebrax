<?php
namespace App\Services\DocumentCenter;
use App\Models\DocumentFile;
use App\Models\DocumentFileScanExceptionAdmission;
use App\Models\PlatformDocumentFileScanException;
use App\Services\PlatformIntegrationResolver;
use App\Support\DocumentScanStatus;
use App\Support\DocumentWorkflowStatus;
use Illuminate\Support\Facades\DB;
final class DocumentFileScanAdmissionService
{
    public function __construct(private readonly PlatformIntegrationResolver $settings) {}

    public function authorize(DocumentFile $file): bool
    {
        return DB::transaction(function () use ($file): bool {
            $locked = DocumentFile::query()->whereKey($file->id)->lockForUpdate()->first();
            if ($locked === null) {
                return false;
            }

            $batch = $locked->batch()->lockForUpdate()->first();
            if ($batch === null || $batch->tenant_id !== $locked->tenant_id || $batch->branch_id !== $locked->branch_id) {
                return false;
            }

            if ($locked->purged_at !== null
                || in_array($locked->scan_status, [DocumentScanStatus::INFECTED, DocumentScanStatus::FAILED], true)
                || in_array($batch->status, [DocumentWorkflowStatus::QUARANTINED, DocumentWorkflowStatus::DUPLICATE, DocumentWorkflowStatus::CANCELLED, DocumentWorkflowStatus::ARCHIVED], true)) {
                return false;
            }

            if ($locked->scan_status === DocumentScanStatus::CLEAN) {
                return true;
            }

            $existing = DocumentFileScanExceptionAdmission::withoutGlobalScopes()
                ->where('document_file_id', $locked->id)
                ->first();
            if ($existing !== null) {
                return $existing->tenant_id === $locked->tenant_id
                    && $existing->document_batch_id === $batch->id
                    && $existing->branch_id === $locked->branch_id
                    && PlatformDocumentFileScanException::query()
                        ->whereKey($existing->platform_document_file_scan_exception_id)
                        ->where('tenant_id', $locked->tenant_id)
                        ->exists();
            }

            if ($locked->scan_status !== DocumentScanStatus::PENDING
                || ! $this->settings->malwareScannerIsAuthoritativelyDisabledOrUnconfigured()) {
                return false;
            }

            $at = now('UTC');
            $exception = PlatformDocumentFileScanException::query()
                ->where('tenant_id', $locked->tenant_id)
                ->whereNull('revoked_at')
                ->where(fn ($query) => $query->whereNull('expires_at')->orWhere('expires_at', '>', $at))
                ->latest('granted_at')
                ->lockForUpdate()
                ->first();
            if ($exception === null) {
                return false;
            }

            DocumentFileScanExceptionAdmission::query()->firstOrCreate(
                ['document_file_id' => $locked->id],
                [
                    'document_batch_id' => $batch->id,
                    'tenant_id' => $locked->tenant_id,
                    'branch_id' => $locked->branch_id,
                    'platform_document_file_scan_exception_id' => $exception->id,
                    'admitted_at' => now('UTC'),
                ],
            );

            return true;
        }, 3);
    }
}
