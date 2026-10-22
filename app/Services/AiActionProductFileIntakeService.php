<?php

namespace App\Services;

use App\Models\AiAction;
use App\Models\AiActionEvent;
use App\Models\AiActionExtraction;
use App\Models\AiActionFile;
use App\Models\User;
use App\Services\DocumentCenter\DocumentStorageService;
use App\Support\AiActionCanonicalJson;
use App\Support\AiActionException;
use App\Support\ProductImportActionSchema;
use App\Support\ProductImportFields;
use App\Support\ProductImportValueNormalizer;
use App\Support\SpreadsheetReader;
use App\Tenancy\TenantContext;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use RuntimeException;

/**
 * AI-ACTIONS-02: accepts source spreadsheets only. It intentionally neither
 * invokes a model nor calls product/import writing services.
 */
final class AiActionProductFileIntakeService
{
    public function __construct(
        private readonly AiActionGateway $gateway,
        private readonly DocumentStorageService $storage,
        private readonly ProductImportActionSchema $schema,
        private readonly TenantContext $tenantContext,
    ) {}

    /** @return array{file:AiActionFile,extraction:AiActionExtraction,replayed:bool} */
    public function intake(User $requestActor, AiAction $action, int $expectedVersion, UploadedFile $upload): array
    {
        $actor = $this->gateway->authorizeFileIntake($requestActor, $action);
        $this->assertProductImport($action);
        [$extension, $path, $size, $sha256, $rows] = $this->inspect($upload);
        $manifest = $this->manifest($action, $expectedVersion, $upload, $extension, $sha256, $rows);
        $summary = $this->schema->validate(['schema_version' => 1, 'rows' => $manifest['rows']]);

        $existing = AiActionFile::query()
            ->where('ai_action_id', $action->id)->where('action_version', $expectedVersion)
            ->where('content_sha256', $sha256)->with('extraction')->first();
        if ($existing?->extraction !== null) {
            return ['file' => $existing, 'extraction' => $existing->extraction, 'replayed' => true];
        }

        $fileId = (string) Str::uuid();
        $profile = $this->storage->profile();
        $key = sprintf('ai-actions/%s/%s/%d/%s/source.%s', $this->tenantContext->id(), $action->id, $expectedVersion, $fileId, $extension);
        $stream = fopen($path, 'rb');
        if ($stream === false) {
            throw new AiActionException('file_unreadable', 'تعذر قراءة الملف المرفوع.', 422);
        }
        try {
            $this->storage->put($profile, $key, $stream);
        } finally {
            fclose($stream);
        }

        try {
            $result = DB::transaction(function () use ($action, $expectedVersion, $actor, $upload, $extension, $size, $sha256, $profile, $key, $fileId, $manifest, $summary): array {
                $locked = AiAction::query()->whereKey($action->id)->lockForUpdate()->firstOrFail();
                if (! in_array($locked->status, [AiAction::STATUS_CREATED, AiAction::STATUS_EDITING], true)) {
                    throw new AiActionException('state_conflict', 'لا تقبل العملية ملفات في حالتها الحالية.', 409);
                }
                if ($locked->version !== $expectedVersion) {
                    throw new AiActionException('version_conflict', 'تغيّرت المسودة. حدّثها قبل رفع ملف جديد.', 409);
                }
                $existing = AiActionFile::query()->where('ai_action_id', $locked->id)->where('action_version', $expectedVersion)
                    ->where('content_sha256', $sha256)->with('extraction')->first();
                if ($existing?->extraction !== null) {
                    return ['file' => $existing, 'extraction' => $existing->extraction, 'replayed' => true];
                }

                $file = new AiActionFile(['id' => $fileId]);
                $file->forceFill([
                    'ai_action_id' => $locked->id, 'action_version' => $expectedVersion,
                    'original_name' => mb_substr($upload->getClientOriginalName(), 0, 255), 'extension' => $extension,
                    'content_type' => $this->safeContentType($upload), 'size_bytes' => $size,
                    'content_sha256' => $sha256, 'storage_profile' => $profile, 'storage_key' => $key, 'uploaded_by' => $actor->id,
                ])->save();
                $extraction = AiActionExtraction::create([
                    'ai_action_file_id' => $file->id, 'ai_action_id' => $locked->id, 'action_version' => $expectedVersion,
                    'schema_version' => 1, 'manifest' => $manifest,
                    'manifest_hash' => AiActionCanonicalJson::hash((string) $this->tenantContext->id(), $locked->id, $expectedVersion, $manifest),
                    'created_by' => $actor->id, 'created_at' => now('UTC'),
                ]);
                AiActionEvent::create([
                    'ai_action_id' => $locked->id, 'version' => $expectedVersion, 'event' => 'product_file_extracted',
                    'from_status' => $locked->status, 'to_status' => $locked->status, 'actor_id' => $actor->id,
                    'metadata' => ['file_id' => $file->id, 'content_sha256' => $sha256, 'manifest_hash' => $extraction->manifest_hash, 'row_count' => $summary['row_count']],
                    'occurred_at' => now('UTC'),
                ]);

                return ['file' => $file, 'extraction' => $extraction, 'replayed' => false];
            }, 3);
            // Another request may have stored the same bytes while this one was
            // waiting on the action lock. Its database row wins; remove this
            // request's unreferenced private object before returning the replay.
            if ($result['replayed']) {
                try { $this->storage->delete($profile, $key); } catch (\Throwable) {}
            }

            return $result;
        } catch (\Throwable $e) {
            // A DB failure must not leave an accessible source object behind.
            try { $this->storage->delete($profile, $key); } catch (\Throwable) {}
            throw $e;
        }
    }

    public function extraction(User $requestActor, AiAction $action, AiActionFile $file): AiActionExtraction
    {
        $this->gateway->authorizeFileIntake($requestActor, $action);
        $file = $action->files()->whereKey($file->id)->with('extraction')->firstOrFail();
        if ($file->extraction === null) {
            throw new AiActionException('extraction_unavailable', 'نتيجة الاستخراج غير متاحة.', 404);
        }

        return $file->extraction;
    }

    /** @return array{0:string,1:string,2:int,3:string,4:array<int,array<int,string>>} */
    private function inspect(UploadedFile $upload): array
    {
        if (! $upload->isValid() || ($path = $upload->getRealPath()) === false) {
            throw new AiActionException('file_upload_invalid', 'الملف المرفوع غير صالح.', 422);
        }
        $extension = strtolower((string) $upload->getClientOriginalExtension());
        if (! in_array($extension, ['csv', 'xlsx'], true)) {
            throw new AiActionException('file_type_invalid', 'يسمح AI Actions بملفات CSV أو XLSX فقط.', 422);
        }
        $size = filesize($path);
        $max = max(1, (int) config('ai_actions.max_file_bytes'));
        if ($size === false || $size < 1 || $size > $max) {
            throw new AiActionException('file_size_invalid', 'حجم الملف خارج الحد الآمن المسموح.', 422);
        }
        if ($extension === 'csv') {
            $contents = file_get_contents($path);
            if ($contents === false || str_contains($contents, "\0") || preg_match('//u', $contents) !== 1) {
                throw new AiActionException('file_content_invalid', 'ملف CSV ليس نص UTF-8 آمناً.', 422);
            }
        }
        try {
            $rows = SpreadsheetReader::read($path, $extension, min((int) config('ai_actions.max_file_rows'), (int) config('ai_actions.max_product_rows')), ProductImportService::MAX_COLUMNS);
        } catch (RuntimeException $e) {
            throw new AiActionException('file_content_invalid', $e->getMessage(), 422);
        }
        if (count($rows) < 2) {
            throw new AiActionException('file_content_invalid', 'ملف المنتجات لا يحتوي صفوف بيانات.', 422);
        }

        return [$extension, $path, (int) $size, hash_file('sha256', $path), $rows];
    }

    /** @param array<int,array<int,string>> $sheet */
    private function manifest(AiAction $action, int $version, UploadedFile $upload, string $extension, string $sha256, array $sheet): array
    {
        $headers = array_map(static fn (string $value): string => trim($value), $sheet[0]);
        $mapping = ProductImportFields::autoMap($headers);
        if (array_filter($mapping) === []) {
            throw new AiActionException('columns_unmapped', 'لم تُعرَف أي ترويسة منتج عربية أو إنجليزية.', 422);
        }
        $mapped = [];
        foreach ($mapping as $index => $field) {
            if ($field !== null) $mapped[(int) $index] = $field;
        }
        $rows = [];
        foreach (array_slice($sheet, 1) as $offset => $cells) {
            $fields = []; $violations = [];
            foreach ($mapped as $index => $field) {
                $value = trim((string) ($cells[$index] ?? ''));
                $fields[$field] = ['value' => $value === '' ? null : $value, 'origin' => $value === '' ? 'missing' : 'extracted', 'confidence' => $value === '' ? null : 100];
            }
            foreach (ProductImportFields::all() as $field => $definition) {
                if (($definition['required'] ?? false) && (($fields[$field]['value'] ?? null) === null)) {
                    $fields[$field] ??= ['value' => null, 'origin' => 'missing', 'confidence' => null];
                    $violations[] = $this->violation('required', $field, 'error', 'الحقل المطلوب مفقود من الملف أو من هذا الصف.');
                }
            }
            foreach ($fields as $field => $value) {
                if ($value['value'] !== null && ! $this->valueLooksValid($field, (string) $value['value'])) {
                    $violations[] = $this->violation('invalid_format', $field, 'error', 'قيمة الحقل لا تطابق الصيغة المتوقعة.');
                }
            }
            if (($fields['sku']['value'] ?? null) === null && ($fields['barcode']['value'] ?? null) === null) {
                $violations[] = $this->violation('trusted_identifier_missing', null, 'warning', 'لا يوجد SKU أو باركود موثوق للمطابقة؛ لن يُنشأ واحد تلقائياً.');
            }
            $media = $this->media($fields, $violations);
            $rows[] = [
                'row_id' => 'source-'.($offset + 2), 'source_row' => $offset + 2,
                'match' => ['kind' => 'none', 'value' => null, 'target_product_id' => null, 'target_version' => null],
                'decision' => $violations === [] ? 'create' : 'needs_review', 'fields' => $fields,
                'violations' => $violations, 'media' => $media,
            ];
        }

        return [
            'schema_version' => 1,
            'source' => ['original_name' => mb_substr($upload->getClientOriginalName(), 0, 255), 'extension' => $extension, 'content_sha256' => $sha256],
            'action' => ['id' => $action->id, 'version' => $version],
            'columns' => array_map(fn (int $index, string $header) => ['index' => $index, 'header' => $header, 'field' => $mapping[$index] ?? null], array_keys($headers), $headers),
            'rows' => $rows,
        ];
    }

    /** @param array<string,array{value:mixed,origin:string,confidence:?int}> $fields @param array<int,array<string,mixed>> $violations */
    private function media(array $fields, array &$violations): ?array
    {
        $primary = $this->urlSource($fields['primary_image_url']['value'] ?? null, 'primary_image_url', $violations);
        $additional = [];
        $raw = $fields['additional_image_urls']['value'] ?? null;
        foreach ($raw === null ? [] : preg_split('/[;|\r\n]+/', (string) $raw) as $url) {
            $source = $this->urlSource(trim($url), 'additional_image_urls', $violations);
            if ($source !== null) $additional[] = $source;
        }
        if ($primary === null && $additional === []) return null;
        if (count($additional) + ($primary === null ? 0 : 1) > 8) {
            $violations[] = $this->violation('too_many_images', 'additional_image_urls', 'error', 'الحد الأقصى للصور هو ثماني صور.');
            $additional = array_slice($additional, 0, max(0, 8 - ($primary === null ? 0 : 1)));
        }
        return ['primary' => $primary, 'additional' => $additional, 'existing_update_approved' => false];
    }

    private function urlSource(mixed $value, string $field, array &$violations): ?array
    {
        if (! is_string($value) || trim($value) === '') return null;
        $value = trim($value);
        if (! filter_var($value, FILTER_VALIDATE_URL) || ! in_array(strtolower((string) parse_url($value, PHP_URL_SCHEME)), ['http', 'https'], true)) {
            $violations[] = $this->violation('invalid_image_url', $field, 'error', 'رابط الصورة غير صالح؛ لم يُطلب ولم يُنزّل.');
        }
        return ['kind' => 'url', 'value' => $value, 'sha256' => null];
    }

    /** IMP-H2-S2: حكمٌ واحد مشترك مع المراجعة والمعاينة (`ProductImportValueNormalizer`) بدل نسخة regex خاصة بهذه الخطوة. */
    private function valueLooksValid(string $field, string $value): bool
    {
        return ProductImportValueNormalizer::isValid($field, $value);
    }

    private function violation(string $code, ?string $field, string $severity, string $message): array
    {
        return compact('code', 'field', 'severity', 'message');
    }

    private function assertProductImport(AiAction $action): void
    {
        if ($action->type !== AiActionRegistry::PRODUCT_IMPORT) throw new AiActionException('action_type_invalid', 'الملف مدعوم لاستيراد المنتجات فقط.', 422);
    }

    private function safeContentType(UploadedFile $upload): ?string
    {
        $type = $upload->getMimeType();
        return is_string($type) ? mb_substr($type, 0, 127) : null;
    }
}
