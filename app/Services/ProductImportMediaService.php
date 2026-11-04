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
    /** إضافة صور جديدة فقط (السلوك الأصلي — الافتراضي ولا يتغيّر). */
    public const MODE_ADD = 'add';

    /**
     * استبدال معرض الصور الموجود بصور الأرشيف المطابقة بـ SKU (وضع صريح). يمسّ معرض الصور فقط: لا اسم ولا سعر ولا مخزون
     * ولا أي بيانات مالية. المطابقة بـ SKU وحده داخل المستأجر الحالي، والمصدر أرشيف ZIP فقط.
     */
    public const MODE_REPLACE = 'replace';

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
        string $mode = self::MODE_ADD,
        bool $confirmReplacement = false,
    ): array {
        $planned = $this->plan($spreadsheet, $options, $archive, $maxRows, $approveExistingUpdates, [], $mode, $confirmReplacement);

        return $this->summarize($planned, $mode);
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
        string $mode = self::MODE_ADD,
        bool $confirmReplacement = false,
    ): array {
        if ($mode === self::MODE_REPLACE) {
            return $this->applyReplacement($spreadsheet, $options, $archive, $userId, $maxRows, $confirmReplacement);
        }

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
        string $mode = self::MODE_ADD,
        bool $confirmReplacement = false,
    ): array {
        if ($mode === self::MODE_REPLACE) {
            return $this->planReplacement($spreadsheet, $options, $archive, $maxRows, $confirmReplacement);
        }
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

    /**
     * يطبّق الاستبدال لكل منتج مخطَّط له `ready` فقط، بمعاملة فرعية مستقلة لكل منتج (savepoint): فشل منتجٍ لا يُسقط غيره ولا
     * يُبقي له أثراً جزئياً. لا يلمس إلا معرض الصور. إعادة تشغيل الأرشيف نفسه idempotent (الصور ذاتها البصمة تُبقى).
     *
     * @return array<string,mixed>
     */
    private function applyReplacement(
        UploadedFile $spreadsheet,
        array $options,
        ?UploadedFile $archive,
        string $userId,
        int $maxRows,
        bool $confirmReplacement,
    ): array {
        $planned = $this->plan($spreadsheet, $options, $archive, $maxRows, false, [], self::MODE_REPLACE, $confirmReplacement);
        // المعرض الذي اعتمده المستخدم في المعاينة (بصمة لكل صف) — إن وُجدت تُفرض قبل أي كتابة ثم تحت قفل كل منتج؛ فصورة رُفعت بعد
        // المعاينة لا تُحذف. تشغيلة بلا معاينة مربوطة تحمي نافذة القفل فقط (بصمة الخطة الحالية).
        $approved = is_array($options['expected_plan'] ?? null) ? $options['expected_plan'] : null;
        $expectedPlan = [];
        foreach ($planned['rows'] as $row) {
            if ($row['status'] !== 'ready' || $row['product_id'] === null) {
                continue;
            }
            if ($approved !== null) {
                if (($approved[$row['row']] ?? null) !== $row['gallery_plan']) {
                    throw new RuntimeException('تغيّر معرض صور أحد المنتجات بعد المعاينة؛ أعد المعاينة قبل الاستبدال.');
                }
                $expectedPlan[$row['row']] = substr((string) $row['gallery_plan'], (int) strrpos((string) $row['gallery_plan'], ':') + 1);
            }
        }
        $replaced = 0;
        $added = 0;
        $kept = 0;
        $removed = 0;
        $failed = 0;
        $skipped = 0;
        $unchanged = 0;
        $rows = [];

        foreach ($planned['rows'] as $row) {
            if ($row['sources'] === []) {
                $rows[] = $row;
                continue;
            }
            if ($row['status'] === 'unchanged') {
                $unchanged++;
                $rows[] = $row;
                continue;
            }
            if ($row['status'] !== 'ready' || $row['product_id'] === null) {
                $skipped++;
                $rows[] = $row;
                continue;
            }

            $files = [];
            try {
                $product = Product::query()->whereKey($row['product_id'])->first();
                if ($product === null) {
                    throw new RuntimeException('تعذّر العثور على المنتج عند استبدال الصور.');
                }
                foreach ($row['sources'] as $source) {
                    $files[] = $this->archives->materialize($archive, (int) $source['index'], (string) $source['name']);
                }
                $outcome = $this->media->replaceProductGallery($product, $files, $userId, $confirmReplacement, $expectedPlan[$row['row']] ?? $row['gallery_fingerprint']);
                $replaced++;
                $added += $outcome['added'];
                $kept += $outcome['kept'];
                $removed += $outcome['removed'];
                $row['status'] = 'replaced';
                $row['outcome'] = $outcome;
            } catch (\Throwable $exception) {
                $failed++;
                $row['status'] = 'partial_failure';
                $row['messages'][] = $exception->getMessage();
            } finally {
                foreach ($files as $file) {
                    if ($file instanceof UploadedFile && is_file((string) $file->getRealPath())) {
                        @unlink($file->getRealPath());
                    }
                }
            }
            unset($row['gallery_fingerprint'], $row['gallery_plan']);
            $rows[] = $row;
        }

        return [
            'mode' => self::MODE_REPLACE,
            'requested' => $planned['source_count'],
            'attached' => $added,
            'products_replaced' => $replaced,
            'images_added' => $added,
            'images_kept' => $kept,
            'images_removed' => $removed,
            'unchanged' => $unchanged,
            'skipped' => $skipped,
            'failed' => $failed,
            'window_rows' => $planned['window_rows'],
            'rows' => $rows,
            'unmatched_archive' => $planned['unmatched_archive'],
        ];
    }

    /**
     * خطة الاستبدال: صفّ الملف ← منتج بـ SKU **حصراً** داخل المستأجر ← صور الأرشيف المطابقة (`SKU.ext` رئيسية، `SKU__N.ext`
     * إضافية). مصدر الصور هنا الأرشيف وحده (أعمدة الروابط تُتجاهل). صفٌّ بلا صور مطابقة لا يُمسّ معرضه إطلاقاً.
     *
     * @return array<string,mixed>
     */
    private function planReplacement(
        UploadedFile $spreadsheet,
        array $options,
        ?UploadedFile $archive,
        int $maxRows,
        bool $confirmReplacement,
    ): array {
        if ($archive === null) {
            throw new RuntimeException('وضع استبدال الصور يتطلب رفع أرشيف ZIP للصور.');
        }
        $extension = strtolower((string) ($spreadsheet->getClientOriginalExtension() ?: $spreadsheet->extension()));
        $path = $spreadsheet->getRealPath();
        if ($path === false || ! SpreadsheetReader::isSupportedExtension($extension)) {
            throw new RuntimeException('ملف استيراد المنتجات غير صالح لتخطيط الصور.');
        }
        $raw = SpreadsheetReader::read($path, $extension, $maxRows, ProductImportService::MAX_COLUMNS);
        $headers = array_map(static fn ($value): string => trim((string) $value), array_shift($raw) ?? []);
        $mapping = $this->mapping($headers, $options['mapping'] ?? null);
        if (! in_array('sku', $mapping, true)) {
            throw new RuntimeException('وضع استبدال الصور يطابق المنتجات بـ SKU: اربط عموداً بحقل SKU.');
        }
        $manifest = $this->archives->manifest($archive);

        $usedArchive = [];
        $rows = [];
        $missingRows = [];
        $sourceCount = 0;
        $windowRows = 0;
        $dataIndex = 0;
        $batchOffset = max(0, (int) ($options['batch_offset'] ?? 0));
        $batchSize = isset($options['batch_size']) ? max(1, (int) $options['batch_size']) : null;
        $seenSkus = [];

        foreach ($raw as $offset => $values) {
            if (ProductImportService::isBlankRow($values)) {
                continue;
            }
            $dataIndex++;
            if ($batchSize !== null && ($dataIndex <= $batchOffset || $dataIndex > $batchOffset + $batchSize)) {
                continue;
            }
            $windowRows++;
            $rowNumber = $offset + 2;
            $sku = '';
            foreach ($mapping as $index => $key) {
                if ($key === 'sku') {
                    $sku = trim((string) ($values[$index] ?? ''));
                    break;
                }
            }
            $messages = [];
            $sources = [];
            $product = null;
            if ($sku === '') {
                $messages[] = 'SKU مطلوب لمطابقة الصور في وضع الاستبدال.';
            } else {
                $skuKey = mb_strtolower($sku, 'UTF-8');
                if (isset($seenSkus[$skuKey])) {
                    $messages[] = "SKU مكرر في الملف (الصف {$seenSkus[$skuKey]}).";
                } else {
                    $seenSkus[$skuKey] = $rowNumber;
                }
                foreach ($this->archiveSources($manifest, [$sku]) as $source) {
                    if (isset($usedArchive[$source['index']])) {
                        $messages[] = "الصورة {$source['name']} طابقت أكثر من صف.";
                        continue;
                    }
                    $usedArchive[$source['index']] = true;
                    $sources[] = $source;
                }
                // لا استعلام منتج لصفٍّ بلا صور مطابقة في الأرشيف (لا شيء سيُفعل به)؛ وصورٌ بلا منتج في المؤسسة = خطأ صريح.
                if ($sources !== []) {
                    $product = Product::query()->where('sku', $sku)->first();
                    if ($product === null) {
                        $messages[] = 'لا يوجد منتج بهذا الـ SKU في المؤسسة.';
                    }
                }
            }

            $seen = [];
            foreach ($sources as $source) {
                if (isset($seen[$source['sha256']])) {
                    $messages[] = "الصورة {$source['name']} مكررة بالمحتوى نفسه داخل صور المنتج.";
                }
                $seen[$source['sha256']] = true;
            }
            if (count($sources) > 8) {
                $messages[] = 'عدد صور المنتج يتجاوز حد المعرض البالغ 8 صور.';
            }

            $existing = $product === null ? collect() : $product->media()->orderBy('sort_order')->orderBy('id')->get();
            $newShas = array_column($sources, 'sha256');
            $existingShas = $existing->pluck('content_sha256')->filter()->all();
            $keepCount = count(array_intersect($newShas, $existingShas));
            $addCount = count($newShas) - $keepCount;
            $removeCount = $existing->count() - $keepCount;
            $sameOrder = $removeCount === 0 && $addCount === 0
                && $existing->pluck('content_sha256')->values()->all() === array_values($newShas);

            $status = 'ready';
            if ($messages !== []) {
                $status = 'error';
            } elseif ($sources !== [] && $sameOrder) {
                $status = 'unchanged';
                $messages[] = 'صور المنتج مطابقة لما في الأرشيف؛ لا تغيير.';
            } elseif ($sources !== [] && $removeCount > 0 && ! $confirmReplacement) {
                $status = 'needs_approval';
                $messages[] = 'استبدال الصور الموجودة يحتاج تأكيداً صريحاً.';
            }

            $sourceCount += count($sources);
            if ($sources === [] && $messages === []) {
                $missingRows[] = $rowNumber;
            }
            if ($sources !== [] || $messages !== []) {
                $rows[] = [
                    'row' => $rowNumber,
                    'sku' => $sku === '' ? null : $sku,
                    'barcode' => null,
                    'product_id' => $product?->id,
                    'product_action' => 'replace_images',
                    'status' => $status,
                    'sources' => array_values($sources),
                    'replacement' => $sources === [] ? null : [
                        'existing_count' => $existing->count(),
                        'new_count' => count($sources),
                        'keep_count' => $keepCount,
                        'add_count' => $addCount,
                        'remove_count' => $removeCount,
                        'existing_names' => $existing->pluck('original_name')->values()->all(),
                    ],
                    // داخلي: بصمة معرض المعاينة لفحص الانجراف — لا تُعرض خارج الخدمة (تُجرَّد في summarize/applyReplacement).
                    'gallery_fingerprint' => ProductMediaService::galleryFingerprint($existing->pluck('id')->all()),
                    'gallery_plan' => $product === null ? null : 'g:'.$product->id.':'.ProductMediaService::galleryFingerprint($existing->pluck('id')->all()),
                    'messages' => array_values(array_unique($messages)),
                ];
            }
        }

        return [
            'rows' => $rows,
            'source_count' => $sourceCount,
            'window_rows' => $windowRows,
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

    private function summarize(array $planned, string $mode = self::MODE_ADD): array
    {
        $ready = 0;
        $review = 0;
        $errors = 0;
        $unchanged = 0;
        $toAdd = 0;
        $toRemove = 0;
        $toKeep = 0;
        $affected = 0;
        $galleryPlan = [];
        foreach ($planned['rows'] as $row) {
            $ready += $row['status'] === 'ready' ? 1 : 0;
            $review += $row['status'] === 'needs_approval' ? 1 : 0;
            $errors += $row['status'] === 'error' ? 1 : 0;
            $unchanged += $row['status'] === 'unchanged' ? 1 : 0;
            $replacement = $row['replacement'] ?? null;
            if (($row['gallery_plan'] ?? null) !== null) {
                $galleryPlan[$row['row']] = $row['gallery_plan'];
            }
            if ($replacement !== null && in_array($row['status'], ['ready', 'needs_approval'], true)) {
                $affected++;
                $toAdd += $replacement['add_count'];
                $toRemove += $replacement['remove_count'];
                $toKeep += $replacement['keep_count'];
            }
        }

        $summary = [
            'source_count' => $planned['source_count'],
            'ready_rows' => $ready,
            'needs_approval_rows' => $review,
            'error_rows' => $errors,
            'rows' => array_map(static function (array $row): array {
                unset($row['gallery_fingerprint'], $row['gallery_plan']);

                return $row;
            }, $planned['rows']),
            'unmatched_archive' => $planned['unmatched_archive'],
            'missing_rows' => $planned['missing_rows'],
        ];
        if ($mode === self::MODE_REPLACE) {
            $summary += [
                'mode' => self::MODE_REPLACE,
                'unchanged_rows' => $unchanged,
                'affected_products' => $affected,
                'images_to_add' => $toAdd,
                'images_to_remove' => $toRemove,
                'images_kept' => $toKeep,
                'window_rows' => $planned['window_rows'],
                // يُسحب في المتحكّم ويُخزَّن مع المعاينة (لا يظهر في الاستجابة): رقم الصف ← بصمة معرضه المعتمد.
                'gallery_plan' => $galleryPlan,
            ];
        }

        return $summary;
    }
}
