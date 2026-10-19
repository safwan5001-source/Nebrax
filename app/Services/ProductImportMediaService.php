<?php

namespace App\Services;

use App\Models\BarcodeRegistryEntry;
use App\Models\Product;
use App\Support\ProductImportFields;
use App\Support\SpreadsheetReader;
use Illuminate\Http\UploadedFile;
use RuntimeException;

final class ProductImportMediaService
{
    public function __construct(
        private readonly ProductImageArchiveService $archives,
        private readonly ProductImageRemoteFetcher $remote,
        private readonly ProductMediaService $media,
    ) {}

    /** @return array<string,mixed> */
    public function preview(
        UploadedFile $spreadsheet,
        array $options,
        ?UploadedFile $archive = null,
        int $maxRows = ProductImportService::MAX_ROWS,
        bool $approveExistingUpdates = false,
    ): array {
        $planned = $this->plan($spreadsheet, $options, $archive, $maxRows, $approveExistingUpdates);

        return $this->summarize($planned);
    }

    /**
     * Attaches only explicitly requested safe images. Existing-product rows
     * require the separate approval flag. No existing media is deleted or reordered.
     *
     * @param list<array<string,mixed>> $productResults
     * @return array<string,mixed>
     */
    public function apply(
        UploadedFile $spreadsheet,
        array $options,
        array $productResults,
        ?UploadedFile $archive,
        string $userId,
        int $maxRows = ProductImportService::MAX_ROWS,
        bool $approveExistingUpdates = false,
    ): array {
        $actionByRow = [];
        foreach ($productResults as $result) {
            if (isset($result['row'], $result['action'])) {
                $actionByRow[(int) $result['row']] = (string) $result['action'];
            }
        }
        $planned = $this->plan($spreadsheet, $options, $archive, $maxRows, $approveExistingUpdates, $actionByRow);
        $attached = 0;
        $failed = 0;
        $skipped = 0;
        $rows = [];

        foreach ($planned['rows'] as $row) {
            if ($row['sources'] === []) {
                continue;
            }
            if ($row['status'] !== 'ready' || $row['product_id'] === null) {
                $skipped += count($row['sources']);
                $rows[] = $row;
                continue;
            }
            $product = Product::query()->whereKey($row['product_id'])->first();
            if ($product === null) {
                $row['status'] = 'error';
                $row['messages'][] = 'تعذّر العثور على المنتج عند حفظ الصور.';
                $failed += count($row['sources']);
                $rows[] = $row;
                continue;
            }

            foreach ($row['sources'] as $source) {
                $file = null;
                try {
                    $file = $source['kind'] === 'archive'
                        ? $this->archives->materialize($archive, (int) $source['index'], (string) $source['name'])
                        : $this->remote->fetch((string) $source['value']);
                    $this->media->attachToProduct($product, [$file], $userId, true);
                    $attached++;
                } catch (\Throwable $exception) {
                    $failed++;
                    $row['status'] = 'partial_failure';
                    $row['messages'][] = $exception->getMessage();
                } finally {
                    if ($file instanceof UploadedFile && is_file((string) $file->getRealPath())) {
                        @unlink($file->getRealPath());
                    }
                }
            }
            $rows[] = $row;
        }

        return [
            'requested' => $planned['source_count'],
            'attached' => $attached,
            'skipped' => $skipped,
            'failed' => $failed,
            'rows' => $rows,
            'unmatched_archive' => $planned['unmatched_archive'],
        ];
    }

    /** @return array{rows:list<array<string,mixed>>,source_count:int,unmatched_archive:list<string>,missing_rows:list<int>} */
    private function plan(
        UploadedFile $spreadsheet,
        array $options,
        ?UploadedFile $archive,
        int $maxRows,
        bool $approveExistingUpdates,
        array $actionByRow = [],
    ): array {
        $extension = strtolower((string) ($spreadsheet->getClientOriginalExtension() ?: $spreadsheet->extension()));
        $path = $spreadsheet->getRealPath();
        if ($path === false || ! SpreadsheetReader::isSupportedExtension($extension)) {
            throw new RuntimeException('ملف استيراد المنتجات غير صالح لتخطيط الصور.');
        }
        $raw = SpreadsheetReader::read($path, $extension, $maxRows, ProductImportService::MAX_COLUMNS);
        $headers = array_map(static fn ($value): string => trim((string) $value), array_shift($raw) ?? []);
        $mapping = $this->mapping($headers, $options['mapping'] ?? null);
        $manifest = $archive === null ? [] : $this->archives->manifest($archive);
        $expectsMedia = $archive !== null
            || in_array('primary_image_url', $mapping, true)
            || in_array('additional_image_urls', $mapping, true);
        // The normal import path must remain entirely unchanged for legacy
        // files: do not resolve products or inspect galleries when no media
        // column/archive was supplied. Besides preserving behaviour, this
        // prevents an N+1 query pattern during ordinary catalog previews.
        if (! $expectsMedia) {
            return [
                'rows' => [],
                'source_count' => 0,
                'unmatched_archive' => [],
                'missing_rows' => [],
            ];
        }
        $usedArchive = [];
        $rows = [];
        $missingRows = [];
        $sourceCount = 0;
        $dataIndex = 0;
        $batchOffset = max(0, (int) ($options['batch_offset'] ?? 0));
        $batchSize = isset($options['batch_size']) ? max(1, (int) $options['batch_size']) : null;

        foreach ($raw as $offset => $values) {
            if (ProductImportService::isBlankRow($values)) {
                continue;
            }
            $dataIndex++;
            if ($batchSize !== null && ($dataIndex <= $batchOffset || $dataIndex > $batchOffset + $batchSize)) {
                continue;
            }
            $rowNumber = $offset + 2;
            $cells = [];
            foreach ($mapping as $index => $key) {
                $cells[$key] = trim((string) ($values[$index] ?? ''));
            }
            $messages = [];
            $sources = $this->urlSources($cells, $messages);
            $identifiers = array_values(array_filter([
                trim((string) ($cells['sku'] ?? '')),
                trim((string) ($cells['barcode'] ?? '')),
            ], static fn (string $value): bool => $value !== ''));
            foreach ($this->archiveSources($manifest, $identifiers) as $source) {
                if (isset($usedArchive[$source['index']])) {
                    $messages[] = "الصورة {$source['name']} طابقت أكثر من صف.";
                    continue;
                }
                $usedArchive[$source['index']] = true;
                $sources[] = $source;
            }

            if (count(array_filter($sources, static fn (array $source): bool => $source['role'] === 'primary')) > 1) {
                $messages[] = 'حُدّدت أكثر من صورة رئيسية للصف؛ أبقِ مصدراً رئيسياً واحداً.';
            }
            usort($sources, static fn (array $a, array $b): int => [($a['role'] === 'primary' ? 0 : 1), $a['name']] <=> [($b['role'] === 'primary' ? 0 : 1), $b['name']]);

            $product = $this->resolveProduct($cells, $messages);
            $originalAction = $actionByRow[$rowNumber] ?? ($product === null ? 'create' : 'update');
            $seen = [];
            $deduped = [];
            foreach ($sources as $source) {
                $identity = $source['sha256'] ?? ('url:'.mb_strtolower($source['value'], 'UTF-8'));
                if (isset($seen[$identity])) {
                    $messages[] = 'مصدر صورة مكرر في الصف نفسه.';
                    continue;
                }
                $seen[$identity] = true;
                if ($product !== null && isset($source['sha256'])
                    && $product->media()->where('content_sha256', $source['sha256'])->exists()) {
                    $messages[] = "الصورة {$source['name']} موجودة بالفعل لهذا المنتج.";
                    continue;
                }
                $deduped[] = $source;
            }
            $sources = $deduped;
            if (count($sources) > 8 || ($product !== null && $product->media()->count() + count($sources) > 8)) {
                $messages[] = 'ستتجاوز الصور حد معرض المنتج البالغ 8 صور.';
            }

            $status = $messages === [] ? 'ready' : 'error';
            if ($sources !== [] && $originalAction === 'update' && ! $approveExistingUpdates) {
                $status = 'needs_approval';
                $messages[] = 'إضافة صور إلى منتج موجود تحتاج موافقة صريحة.';
            }
            if ($sources !== [] && $product === null && $actionByRow !== []) {
                $status = 'error';
                $messages[] = 'لم يُنشأ المنتج المستهدف أو تعذّرت مطابقته بعد الاستيراد.';
            }

            $sourceCount += count($sources);
            if ($expectsMedia && $sources === [] && $messages === []) {
                $missingRows[] = $rowNumber;
            }
            if ($sources !== [] || $messages !== []) {
                $rows[] = [
                    'row' => $rowNumber,
                    'sku' => $cells['sku'] ?? null,
                    'barcode' => $cells['barcode'] ?? null,
                    'product_id' => $product?->id,
                    'product_action' => $originalAction,
                    'status' => $status,
                    'sources' => array_values($sources),
                    'messages' => array_values(array_unique($messages)),
                ];
            }
        }

        return [
            'rows' => $rows,
            'source_count' => $sourceCount,
            'missing_rows' => $missingRows,
            'unmatched_archive' => array_values(array_map(
                static fn (array $entry): string => $entry['name'],
                array_filter($manifest, static fn (array $entry): bool => ! isset($usedArchive[$entry['index']])),
            )),
        ];
    }

    private function mapping(array $headers, mixed $explicit): array
    {
        if (is_array($explicit)) {
            return array_filter(array_map(static fn ($value) => $value === 'ignore' ? null : $value, $explicit));
        }

        return array_filter(ProductImportFields::autoMap($headers), static fn ($value): bool => $value !== null);
    }

    /** @return list<array<string,mixed>> */
    private function urlSources(array $cells, array &$messages): array
    {
        $urls = [];
        $primary = trim((string) ($cells['primary_image_url'] ?? ''));
        if ($primary !== '') {
            if (mb_strlen($primary) > 2048) {
                $messages[] = 'رابط الصورة الرئيسية يتجاوز الحد المسموح.';
            } else {
                $urls[] = ['url' => $primary, 'role' => 'primary'];
            }
        }
        $additionalRaw = (string) ($cells['additional_image_urls'] ?? '');
        if (mb_strlen($additionalRaw) > 6000) {
            $messages[] = 'قائمة روابط الصور الإضافية تتجاوز الحد المسموح.';
            $additionalRaw = '';
        }
        $additional = preg_split('/[|;\r\n]+/u', $additionalRaw, -1, PREG_SPLIT_NO_EMPTY) ?: [];
        foreach ($additional as $url) {
            $url = trim($url);
            if (mb_strlen($url) > 2048) {
                $messages[] = 'أحد روابط الصور الإضافية يتجاوز الحد المسموح.';
            } elseif ($url !== '') {
                $urls[] = ['url' => $url, 'role' => 'additional'];
            }
        }
        if (count($urls) > 8) {
            $messages[] = 'عدد روابط الصور يتجاوز حد معرض المنتج البالغ 8 صور.';
            $urls = array_slice($urls, 0, 8);
        }
        $sources = [];
        foreach ($urls as $item) {
            try {
                $this->remote->validateUrl($item['url']);
                if (config('product_import_media.remote_enabled') !== true) {
                    throw new RuntimeException('جلب صور المنتجات من روابط خارجية غير مفعّل على المنصة.');
                }
                $sources[] = [
                    'kind' => 'url', 'value' => $item['url'], 'name' => basename((string) parse_url($item['url'], PHP_URL_PATH)) ?: 'remote-image',
                    'role' => $item['role'], 'sha256' => null,
                ];
            } catch (\Throwable $exception) {
                $messages[] = $exception->getMessage();
            }
        }

        return $sources;
    }

    /** @return list<array<string,mixed>> */
    private function archiveSources(array $manifest, array $identifiers): array
    {
        $matches = [];
        foreach ($manifest as $entry) {
            foreach ($identifiers as $identifier) {
                $needle = mb_strtolower($identifier, 'UTF-8');
                if ($entry['lookup'] === $needle || preg_match('/^'.preg_quote($needle, '/').'__(\d+)$/u', $entry['lookup'], $parts)) {
                    $order = $entry['lookup'] === $needle ? 1 : max(2, (int) ($parts[1] ?? 2));
                    $matches[] = [
                        'kind' => 'archive', 'value' => $entry['name'], 'name' => $entry['name'],
                        'index' => $entry['index'], 'role' => $order === 1 ? 'primary' : 'additional',
                        'order' => $order, 'sha256' => $entry['sha256'],
                    ];
                    break;
                }
            }
        }
        usort($matches, static fn (array $a, array $b): int => [$a['order'], $a['name']] <=> [$b['order'], $b['name']]);

        return $matches;
    }

    private function resolveProduct(array $cells, array &$messages): ?Product
    {
        $id = trim((string) ($cells['nebrax_id'] ?? ''));
        if ($id !== '') {
            $product = Product::query()->whereKey($id)->first();
            if ($product === null) {
                $messages[] = 'معرّف نبراكس لا يطابق منتجاً في المؤسسة.';
            }
            return $product;
        }
        $sku = trim((string) ($cells['sku'] ?? ''));
        if ($sku !== '') {
            $product = Product::query()->where('sku', $sku)->first();
            if ($product !== null) {
                return $product;
            }
        }
        $barcode = trim((string) ($cells['barcode'] ?? ''));
        if ($barcode !== '') {
            $productId = BarcodeRegistryEntry::query()->where('code', $barcode)->value('product_id');
            return $productId === null ? null : Product::query()->whereKey($productId)->first();
        }

        return null;
    }

    private function summarize(array $planned): array
    {
        $ready = 0;
        $review = 0;
        $errors = 0;
        foreach ($planned['rows'] as $row) {
            $ready += $row['status'] === 'ready' ? 1 : 0;
            $review += $row['status'] === 'needs_approval' ? 1 : 0;
            $errors += $row['status'] === 'error' ? 1 : 0;
        }

        return [
            'source_count' => $planned['source_count'],
            'ready_rows' => $ready,
            'needs_approval_rows' => $review,
            'error_rows' => $errors,
            'rows' => $planned['rows'],
            'unmatched_archive' => $planned['unmatched_archive'],
            'missing_rows' => $planned['missing_rows'],
        ];
    }
}
