<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\StoreDocumentBatchRequest;
use App\Http\Requests\StoreDocumentFileRequest;
use App\Http\Resources\DocumentBatchIntakeResource;
use App\Http\Resources\DocumentFileResource;
use App\Models\DocumentBatch;
use App\Models\DocumentFile;
use App\Services\DocumentCenter\DocumentFileIntakeService;
use App\Services\DocumentCenter\DocumentStorageService;
use App\Support\DocumentScanStatus;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\URL;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpFoundation\StreamedResponse;

class DocumentIntakeController extends Controller
{
    public function __construct(
        private readonly DocumentFileIntakeService $intake,
        private readonly DocumentStorageService $storage,
    ) {
    }

    public function storeBatch(StoreDocumentBatchRequest $request): JsonResponse
    {
        $batch = DocumentBatch::create([
            'document_type' => $request->validated('document_type'),
            'source_type' => 'manual',
            'created_by' => $request->user()?->id,
        ]);

        return (new DocumentBatchIntakeResource($batch->load('files')))
            ->response()
            ->setStatusCode(201);
    }

    public function storeFile(StoreDocumentFileRequest $request, DocumentBatch $batch): JsonResponse
    {
        $file = $this->intake->ingest($batch, $request->file('file'), $request->user()?->id);

        return (new DocumentFileResource($file))->response()->setStatusCode(201);
    }

    public function complete(Request $request, DocumentBatch $batch): JsonResponse
    {
        $completed = $this->intake->complete($batch, $request->user()?->id);

        return (new DocumentBatchIntakeResource($completed->load('files')))->response();
    }

    public function downloadUrl(DocumentFile $file): JsonResponse
    {
        $this->assertDownloadable($file);
        $minutes = max(1, min(15, (int) config('document_center.intake.download_url_minutes', 5)));

        return response()->json([
            'url' => URL::temporarySignedRoute(
                'document-files.download',
                now('UTC')->addMinutes($minutes),
                ['file' => $file->id],
            ),
            'expires_at' => now('UTC')->addMinutes($minutes)->toIso8601String(),
        ]);
    }

    public function download(DocumentFile $file): StreamedResponse
    {
        $this->assertDownloadable($file);
        if (! $this->storage->exists($file->storage_profile, $file->object_key)) {
            abort(404, 'ملف المستند غير موجود.');
        }

        return response()->streamDownload(function () use ($file): void {
            $stream = $this->storage->readStream($file->storage_profile, $file->object_key);
            try {
                fpassthru($stream);
            } finally {
                fclose($stream);
            }
        }, $file->original_name, [
            'Content-Type' => $file->detected_mime,
            'Cache-Control' => 'private, no-store, max-age=0',
            'X-Content-Type-Options' => 'nosniff',
        ]);
    }

    private function assertDownloadable(DocumentFile $file): void
    {
        if ($file->scan_status !== DocumentScanStatus::CLEAN || $file->purged_at !== null) {
            throw ValidationException::withMessages(['file' => 'الملف غير متاح قبل اجتياز الفحص الأمني.']);
        }
    }
}
