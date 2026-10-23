<?php

namespace App\Services;

use App\Models\BarcodeRegistryEntry;
use App\Models\Brand;
use App\Models\Product;
use App\Models\ProductCategory;
use App\Models\ProductMedia;
use App\Support\ProductImportFields;
use App\Support\ProductImportValueNormalizer as Normalizer;
use Illuminate\Support\Str;

/**
 * AI-ACTIONS-04: turns the proposal rows into the final, read-only picture of
 * what an import *would* do. It reads live ERP state to match existing products
 * and detect conflicts, and writes nothing. Client-supplied `match`, stored
 * `violations` and `media` are deliberately ignored — except the single explicit
 * `media.existing_update_approved` decision — every verdict is recomputed here from the field values,
 * the live catalogue and the staged image evidence.
 */
final class AiActionProductPreviewBuilder
{
    public const SCHEMA_VERSION = 1;
    private const CHUNK = 400;
    /** Same ceiling the product gallery enforces (`ProductMediaService::MAX_PER_SCOPE`). */
    private const MAX_GALLERY = 8;
    /** Locked fields never change on an existing product; a difference is an error. */
    private const LOCKED = ['type', 'track_inventory'];
    private const MONEY = ['sale_price', 'purchase_price', 'min_sale_price'];
    /** Managed references resolved to ids in the preview; the approval binds those exact ids. */
    private const MANAGED = ['category' => 'التصنيف', 'brand' => 'العلامة التجارية'];
    private const ISSUE_MESSAGES = [
        'unknown_field' => 'حقل غير معروف.',
        'invalid_format' => 'قيمة الحقل لا تطابق الصيغة المتوقعة.',
        'too_long' => 'قيمة الحقل تتجاوز الحد المسموح.',
        'invalid_money' => 'المبلغ يجب أن يكون رقماً غير سالب بمنزلتين عشريتين على الأكثر.',
        'money_out_of_range' => 'المبلغ يتجاوز النطاق المالي الآمن.',
        'invalid_integer' => 'القيمة يجب أن تكون عدداً صحيحاً.',
        'integer_out_of_range' => 'القيمة خارج النطاق المسموح.',
        'invalid_boolean' => 'القيمة تقبل 1 أو 0 أو true أو false أو نعم/لا.',
        'invalid_enum' => 'القيمة يجب أن تكون سلعة (good) أو خدمة (service).',
    ];

    /**
     * @param  list<array<string,mixed>>  $rows
     * @param  array{action_id:string,version:int,branch_id:?string,proposal_hash:?string,manifest_hash:?string,file_sha256:?string}  $source
     * @return array<string,mixed> canonical preview (no volatile values, so its hash is stable)
     */
    public function build(array $rows, array $source, array $imageContext = []): array
    {
        usort($rows, static fn (array $a, array $b): int => [(int) ($a['source_row'] ?? 0), (string) ($a['row_id'] ?? '')] <=> [(int) ($b['source_row'] ?? 0), (string) ($b['row_id'] ?? '')]);

        $parsed = array_map(fn (array $row): array => $this->parse($row), $rows);
        $live = $this->liveIndex($parsed);
        $references = $this->referenceIndex($parsed);
        $ctx = $imageContext + ['catalog' => ['by_key' => [], 'archive' => []], 'failures' => []];
        $live['media'] = $this->mediaIndex($parsed, $live, $ctx);

        $seen = ['sku' => [], 'barcode' => [], 'nebrax_id' => [], 'target' => [], 'archive' => []];
        $out = [];
        foreach ($rows as $index => $row) {
            $out[] = $this->evaluate($row, $parsed[$index], $live, $references, $seen, $ctx);
        }

        $issues = [];
        if ($rows === []) {
            $issues[] = $this->issue('empty_proposal', null, 'error', 'لا توجد صفوف في المسودة لمعاينتها.');
        } elseif (count(array_filter($out, static fn (array $r): bool => in_array($r['operation'], ['create', 'update'], true))) === 0
            && count(array_filter($out, static fn (array $r): bool => $r['operation'] === 'blocked')) === 0) {
            $issues[] = $this->issue('nothing_to_apply', null, 'error', 'لا يوجد صف سيُنشأ أو يُحدَّث؛ كل الصفوف مُتخطّاة أو بلا تغيير.');
        }

        if (($ctx['catalog']['purged']['archive'] ?? 0) > 0) {
            $issues[] = $this->issue('image_archive_purged', null, 'warning', 'حُذف أرشيف الصور المرفوع سابقاً بعد انتهاء مدة الاحتفاظ؛ لن تُطابَق صوره مع الصفوف حتى تعيد رفعه.');
        }

        return [
            'schema_version' => self::SCHEMA_VERSION,
            'type' => AiActionRegistry::PRODUCT_IMPORT,
            'source' => $source,
            'totals' => $this->totals($out, $issues),
            'issues' => $issues,
            'images' => $this->archiveSummary($ctx['catalog']['archive'], $seen['archive']),
            'rows' => $out,
        ];
    }

    /** @param array<string,mixed> $row @return array<string,mixed> */
    private function parse(array $row): array
    {
        $decision = (string) ($row['decision'] ?? 'needs_review');
        $fields = is_array($row['fields'] ?? null) ? $row['fields'] : [];
        $values = [];
        $errors = [];
        if ($decision !== 'skip') {
            foreach (array_keys(ProductImportFields::all()) as $key) {
                [$value, $error] = Normalizer::normalize($key, $fields[$key]['value'] ?? null);
                if ($error !== null) {
                    $errors[$key] = $error;
                } elseif ($value !== null) {
                    $values[$key] = $value;
                }
            }
        }
        $text = static fn (string $key): ?string => isset($values[$key]) && is_string($values[$key]) && $values[$key] !== '' ? $values[$key] : null;
        $nebraxId = $text('nebrax_id');

        return [
            'decision' => $decision, 'values' => $values, 'errors' => $errors,
            'sku' => $text('sku'), 'barcode' => $text('barcode'),
            'nebrax_id' => $nebraxId === null ? null : mb_strtolower($nebraxId),
            'raw' => $fields,
        ];
    }

    /**
     * Prefetches every candidate product once per chunk. `Product::query()` carries the tenant and
     * branch scopes, so a product the actor cannot see in this branch never resolves — and its
     * existence is not described anywhere in the preview.
     *
     * @param  list<array<string,mixed>>  $parsed
     * @return array{by_id:array<string,Product>,by_sku:array<string,Product>,owner:array<string,string>,products:array<string,Product>}
     */
    private function liveIndex(array $parsed): array
    {
        $ids = $skus = $barcodes = [];
        foreach ($parsed as $row) {
            if ($row['decision'] === 'skip') {
                continue;
            }
            if ($row['nebrax_id'] !== null && Str::isUuid($row['nebrax_id'])) $ids[$row['nebrax_id']] = true;
            if ($row['sku'] !== null) $skus[$row['sku']] = true;
            if ($row['barcode'] !== null) $barcodes[$row['barcode']] = true;
        }

        $owner = [];
        foreach (array_chunk(array_keys($barcodes), self::CHUNK) as $chunk) {
            foreach (BarcodeRegistryEntry::query()->whereIn('code', $chunk)->get(['code', 'product_id']) as $entry) {
                $owner[(string) $entry->code] = (string) $entry->product_id;
            }
        }

        $products = [];
        $load = function (string $column, array $values) use (&$products): void {
            foreach (array_chunk($values, self::CHUNK) as $chunk) {
                foreach (Product::query()->with(['unitTemplate:id,name', 'productCategory:id,name', 'productBrand:id,name'])->whereIn($column, $chunk)->get() as $product) {
                    $products[(string) $product->id] = $product;
                }
            }
        };
        $load('id', array_keys($ids));
        $load('sku', array_keys($skus));
        $load('id', array_values(array_diff(array_unique(array_values($owner)), array_keys($products))));

        $bySku = [];
        foreach ($products as $product) {
            if ($product->sku !== null) $bySku[(string) $product->sku] = $product;
        }

        return ['by_id' => $products, 'by_sku' => $bySku, 'owner' => $owner, 'products' => $products];
    }

    /**
     * Managed category / brand lookup by normalised name. `Model::query()` carries the tenant and branch
     * scopes, so another tenant's (or an invisible branch's) record can never resolve. A name that matches
     * more than one record maps to `false` (ambiguous) — it is never guessed.
     *
     * @param  list<array<string,mixed>>  $parsed
     * @return array<string,array<string,array{id:string,name:string}|false>>
     */
    private function referenceIndex(array $parsed): array
    {
        $index = ['category' => [], 'brand' => []];
        foreach (['category' => ProductCategory::class, 'brand' => Brand::class] as $key => $model) {
            $needed = false;
            foreach ($parsed as $row) {
                $needed = $needed || isset($row['values'][$key]);
            }
            if (! $needed) {
                continue;
            }
            foreach ($model::query()->get(['id', 'name']) as $item) {
                $needle = mb_strtolower(trim((string) $item->name), 'UTF-8');
                $index[$key][$needle] = array_key_exists($needle, $index[$key]) ? false : ['id' => (string) $item->id, 'name' => (string) $item->name];
            }
        }

        return $index;
    }

    /**
     * @param  array<string,mixed>  $row
     * @param  array<string,mixed>  $p
     * @param  array<string,mixed>  $live
     * @param  array<string,array<string,bool>>  $references
     * @param  array<string,array<string,int>>  $seen
     * @param  array{catalog:array,failures:array}  $ctx
     * @return array<string,mixed>
     */
    private function evaluate(array $row, array $p, array $live, array $references, array &$seen, array $ctx): array
    {
        $fields = $p['raw'];
        $display = [
            'name' => $this->display($fields['name']['value'] ?? null),
            'sku' => $this->display($fields['sku']['value'] ?? null),
            'barcode' => $this->display($fields['barcode']['value'] ?? null),
        ];
        $base = ['row_id' => (string) $row['row_id'], 'source_row' => (int) $row['source_row'], 'decision' => $p['decision'], 'display' => $display];

        if ($p['decision'] === 'skip') {
            return $base + ['operation' => 'skip', 'skip_reason' => 'user_skip', 'match' => $this->matchInfo('none', null, null), 'changes' => [], 'references' => [], 'prices' => null, 'images' => null, 'issues' => []];
        }

        $issues = [];
        $values = $p['values'];
        foreach ($p['errors'] as $field => $code) {
            $issues[] = $this->issue($code, $field, 'error', $this->label($field).': '.(self::ISSUE_MESSAGES[$code] ?? self::ISSUE_MESSAGES['invalid_format']));
        }

        // — Matching: trusted identifiers only; the name is never an identifier. —
        $idProduct = $skuProduct = $barcodeProduct = null;
        $barcodeHidden = false;
        if ($p['nebrax_id'] !== null) {
            if (! Str::isUuid($p['nebrax_id'])) {
                $issues[] = $this->issue('invalid_nebrax_id', 'nebrax_id', 'error', 'معرّف نبراكس غير صالح؛ احذفه لتتم المطابقة برمز الصنف.');
            } else {
                $idProduct = $live['by_id'][$p['nebrax_id']] ?? null;
                if ($idProduct === null) {
                    $issues[] = $this->issue('target_not_found', 'nebrax_id', 'error', 'معرّف نبراكس لا يطابق أي منتج في نطاقك.');
                }
            }
        }
        if ($p['sku'] !== null) $skuProduct = $live['by_sku'][$p['sku']] ?? null;
        if ($p['barcode'] !== null) {
            $ownerId = $live['owner'][$p['barcode']] ?? null;
            $barcodeProduct = $ownerId === null ? null : ($live['products'][$ownerId] ?? null);
            $barcodeHidden = $ownerId !== null && $barcodeProduct === null;
        }
        if ($barcodeHidden) {
            $issues[] = $this->issue('barcode_taken', 'barcode', 'error', 'الباركود مستخدم بالفعل لمنتج آخر في المؤسسة.');
        }

        // The update target follows the identifier priority strictly: id, then SKU, then barcode.
        $kind = $p['nebrax_id'] !== null ? 'nebrax_id' : ($p['sku'] !== null ? 'sku' : ($p['barcode'] !== null ? 'barcode' : 'none'));
        $target = match ($kind) { 'nebrax_id' => $idProduct, 'sku' => $skuProduct, 'barcode' => $barcodeProduct, default => null };
        $matched = [];
        foreach (['nebrax_id' => $idProduct, 'sku' => $skuProduct, 'barcode' => $barcodeProduct] as $by => $product) {
            if ($product !== null && ! isset($matched[(string) $product->id])) $matched[(string) $product->id] = [$by, $product];
        }
        $candidate = $target !== null ? [$kind, $target] : (array_values($matched)[0] ?? null);
        $match = $candidate === null ? $this->matchInfo($kind, $this->identifierValue($kind, $p), null) : $this->matchInfo($candidate[0], $this->identifierValue($candidate[0], $p), $candidate[1]);

        if ($target !== null) {
            foreach ($matched as $id => [$by, $other]) {
                if ($id !== (string) $target->id) {
                    $issues[] = $this->issue('identifier_conflict', $by, 'error', 'المعرّفات في هذا الصف تشير إلى منتجات مختلفة؛ صحّح الصف أو تخطَّه.');
                    break;
                }
            }
        }

        // — Duplicates inside the file and rows aiming at one live product. —
        foreach (['sku' => $p['sku'], 'barcode' => $p['barcode'], 'nebrax_id' => $p['nebrax_id']] as $key => $value) {
            if ($value === null) continue;
            $needle = mb_strtolower($value, 'UTF-8');
            if (isset($seen[$key][$needle])) {
                $issues[] = $this->issue('duplicate_in_file', $key, 'error', $this->label($key).' مكرر داخل الملف (أول ظهور في الصف '.$seen[$key][$needle].').');
            } else {
                $seen[$key][$needle] = (int) $row['source_row'];
            }
        }
        if ($target !== null) {
            $tid = (string) $target->id;
            if (isset($seen['target'][$tid])) {
                $issues[] = $this->issue('duplicate_target', null, 'error', 'صف آخر يستهدف المنتج نفسه (الصف '.$seen['target'][$tid].').');
            } else {
                $seen['target'][$tid] = (int) $row['source_row'];
            }
        }

        // — Managed references: resolved here, to ids, so the approval binds exactly what execution will use.
        //   An unknown or ambiguous name is an error; it is never turned into free text or guessed. —
        $refs = [];
        if (in_array($p['decision'], ['create', 'update'], true)) {
            foreach (self::MANAGED as $key => $label) {
                if (! isset($values[$key])) {
                    continue;
                }
                $found = $references[$key][mb_strtolower(trim((string) $values[$key]), 'UTF-8')] ?? null;
                if ($found === null) {
                    $issues[] = $this->issue('reference_unresolved', $key, 'error', "«{$label}» بالقيمة «{$values[$key]}» غير موجود في بيانات المؤسسة؛ أنشئه أولاً أو صحّح القيمة (لا يُحفظ نصّاً حرّاً).");
                } elseif ($found === false) {
                    $issues[] = $this->issue('reference_ambiguous', $key, 'error', "«{$label}» بالقيمة «{$values[$key]}» يطابق أكثر من سجل؛ صحّح الأسماء المكرّرة أو القيمة.");
                } else {
                    $refs[$key] = $found;
                }
            }
        }

        // — Decision-specific verdicts. —
        $changes = [];
        $decision = $p['decision'];
        if ($decision === 'needs_review') {
            $issues[] = $this->issue('decision_required', null, 'error', 'يحتاج هذا الصف قراراً صريحاً: إنشاء أو تحديث أو تخطٍّ.');
        } elseif ($decision === 'create') {
            foreach (ProductImportFields::all() as $key => $definition) {
                if (($definition['required'] ?? false) && ! isset($values[$key]) && ! isset($p['errors'][$key])) {
                    $issues[] = $this->issue('required_missing', $key, 'error', $this->label($key).' مطلوب لإنشاء منتج جديد.');
                }
            }
            if ($matched !== []) {
                $found = array_values($matched)[0][1];
                $issues[] = $this->issue('existing_product_matches', null, 'error', 'يطابق منتجاً موجوداً: «'.$found->name.'». اختر «تحديث» أو «تخطٍّ» بدل الإنشاء.');
            }
            if (($values['type'] ?? null) === 'service' && ($values['track_inventory'] ?? false) === true) {
                $issues[] = $this->issue('service_tracks_inventory', 'track_inventory', 'error', 'الخدمة لا تتبع مخزوناً.');
            }
            // The AI Actions contract (architecture §6/§16.5): a created product's price, tax, unit and a
            // trusted identifier are resolved explicitly — never defaulted (the traditional importer
            // would write purchase price 0, the model default tax/unit, and a generated SKU).
            foreach (['purchase_price' => 'سعر الشراء', 'tax_rate' => 'نسبة الضريبة', 'unit' => 'الوحدة'] as $key => $label) {
                if (! isset($values[$key]) && ! isset($p['errors'][$key])) {
                    $issues[] = $this->issue($key.'_missing', $key, 'error', "«{$label}» مطلوب لإنشاء منتج جديد؛ لا تُستخدم قيمة افتراضية صامتة (أدخل القيمة صراحةً، ولو صفراً).");
                }
            }
            if ($p['sku'] === null && $p['barcode'] === null && ! isset($p['errors']['sku']) && ! isset($p['errors']['barcode'])) {
                $issues[] = $this->issue('trusted_identifier_missing', null, 'error', 'يلزم رمز صنف (SKU) أو باركود لإنشاء منتج جديد؛ لن يُولَّد واحد تلقائياً.');
            }
            foreach ($values as $key => $value) {
                // `unit_template` is not applied in this phase (see the warning below), so it is not a change.
                if (! in_array($key, ['nebrax_id', 'unit_template'], true) && ! in_array($key, ProductImportFields::mediaKeys(), true)) $changes[] = ['field' => $key, 'before' => null, 'after' => $refs[$key]['name'] ?? $value];
            }
        } else { // update
            if ($target === null) {
                $issues[] = $this->issue('update_target_missing', null, 'error', 'لا يوجد منتج مطابق بمعرّف موثوق (معرّف نبراكس أو SKU أو باركود)؛ لا يمكن التحديث.');
            } else {
                foreach (ProductImportFields::writableKeys() as $key) {
                    if (in_array($key, ProductImportFields::mediaKeys(), true) || $key === 'unit_template' || ! array_key_exists($key, $values)) continue;
                    if (isset(self::MANAGED[$key])) {
                        // Compared by id: the product either already points at the approved record or it changes.
                        if (isset($refs[$key]) && (string) $target->{$key.'_id'} !== $refs[$key]['id']) {
                            $changes[] = ['field' => $key, 'before' => $this->existing($target, $key), 'after' => $refs[$key]['name']];
                        }
                        continue;
                    }
                    $before = $this->existing($target, $key);
                    $after = $values[$key];
                    if (in_array($key, self::LOCKED, true)) {
                        if ($before !== $after) {
                            $issues[] = $this->issue('update_locked', $key, 'error', $key === 'type'
                                ? 'لا يغيّر الاستيراد نوع المنتج الموجود؛ أنشئ منتجاً جديداً بدلاً من إعادة تصنيفه.'
                                : 'لا يغيّر الاستيراد تتبع المخزون للمنتج الموجود؛ فهذا يؤثر في دورة الحركات والتكلفة.');
                        }
                        continue;
                    }
                    if ($key === 'sku' && $before === $after) continue;
                    if ($before !== $after) $changes[] = ['field' => $key, 'before' => $before, 'after' => $after];
                }
            }
        }

        // — Cross-field price rule (same rule as the traditional importer). —
        if ($decision !== 'needs_review' && ! isset($p['errors']['sale_price']) && ! isset($p['errors']['min_sale_price'])) {
            $sale = $values['sale_price'] ?? ($decision === 'update' && $target !== null ? (int) $target->sale_price : null);
            $min = $values['min_sale_price'] ?? ($decision === 'update' && $target !== null && $target->min_sale_price !== null ? (int) $target->min_sale_price : null);
            if ($sale !== null && $min !== null && $min > $sale) {
                $issues[] = $this->issue('min_sale_price_above_sale_price', 'min_sale_price', 'error', '«أقل سعر بيع» أعلى من «سعر البيع» في هذا الصف.');
            }
        }

        if (isset($values['unit_template'])) {
            // A template overrides the base unit and multiplies incoming stock quantities: never applied silently.
            $issues[] = $this->issue('unit_template_deferred', 'unit_template', 'warning', '«قالب الوحدات» لا يُطبَّق في هذه المرحلة؛ تبقى الوحدة المحدَّدة في الصف كما هي.');
        }

        [$images, $imageIssues] = $this->images($row, $p, $decision, $target, $live, $ctx, $seen);
        $issues = array_merge($issues, $imageIssues);

        $hasError = count(array_filter($issues, static fn (array $i): bool => $i['severity'] === 'error')) > 0;
        // An approved image addition is a real change even when no product field differs.
        $operation = $hasError ? 'blocked' : ($decision === 'create' ? 'create' : ($changes === [] && ! $images['will_apply'] ? 'skip' : 'update'));

        return $base + [
            'operation' => $operation,
            'skip_reason' => $operation === 'skip' ? 'no_changes' : null,
            'match' => $match,
            'changes' => $changes,
            'references' => $refs,
            'prices' => $this->prices($decision, $values, $target),
            'images' => $images,
            'issues' => $issues,
        ];
    }

    /** @param array<string,mixed> $values @return array<string,array{before:?int,after:?int}> */
    private function prices(string $decision, array $values, ?Product $target): array
    {
        $prices = [];
        foreach (['sale_price', 'purchase_price', 'min_sale_price'] as $key) {
            $before = $decision === 'update' && $target !== null ? $this->existing($target, $key) : null;
            if (array_key_exists($key, $values) || $before !== null) {
                $prices[$key] = ['before' => $before, 'after' => $values[$key] ?? null];
            }
        }
        if (array_key_exists('tax_rate', $values) || ($decision === 'update' && $target !== null)) {
            $prices['tax_rate'] = ['before' => $decision === 'update' && $target !== null ? (int) $target->tax_rate : null, 'after' => $values['tax_rate'] ?? null];
        }

        return $prices;
    }

    /**
     * Existing gallery of every update target (count + content hashes), loaded once per preview, and only
     * when the preview can mention an image at all — an ordinary catalogue preview adds no query.
     *
     * @param  list<array<string,mixed>>  $parsed
     * @return array<string,array{count:int,sha:array<string,bool>}>
     */
    private function mediaIndex(array $parsed, array $live, array $ctx): array
    {
        $wanted = $ctx['catalog']['archive'] !== [];
        foreach ($parsed as $row) {
            $wanted = $wanted || isset($row['values']['primary_image_url']) || isset($row['values']['additional_image_urls']);
        }
        if (! $wanted || $live['products'] === []) {
            return [];
        }
        $index = [];
        foreach (array_chunk(array_keys($live['products']), self::CHUNK) as $chunk) {
            foreach (ProductMedia::query()->whereIn('product_id', $chunk)->whereNull('product_option_value_id')->whereNull('product_variant_id')->get(['product_id', 'content_sha256']) as $media) {
                $id = (string) $media->product_id;
                $index[$id] ??= ['count' => 0, 'sha' => []];
                $index[$id]['count']++;
                if ($media->content_sha256 !== null) {
                    $index[$id]['sha'][(string) $media->content_sha256] = true;
                }
            }
        }

        return $index;
    }

    /**
     * Resolves a row's image sources — URLs in its cells and archive entries named after its SKU / barcode —
     * to the *staged* evidence (identity = content SHA-256). Nothing is fetched here; an image that is not
     * staged is reported as such, never assumed. An existing product's gallery is only ever appended to, and
     * only after an explicit row-level decision; it is never replaced or reordered.
     *
     * @param  array<string,mixed>  $row
     * @param  array<string,mixed>  $p
     * @param  array<string,mixed>  $live
     * @param  array{catalog:array,failures:array}  $ctx
     * @param  array<string,array<string,mixed>>  $seen
     * @return array{0:array<string,mixed>,1:list<array<string,mixed>>}
     */
    private function images(array $row, array $p, string $decision, ?Product $target, array $live, array $ctx, array &$seen): array
    {
        $fields = $p['raw'];
        $issues = [];
        $valid = static fn (string $url): bool => self::validUrl($url);
        [$primary, $additional] = self::rawUrls($fields);

        $sources = [];
        if ($primary !== '') {
            if ($valid($primary)) {
                $sources[] = ['kind' => 'url', 'role' => 'primary', 'order' => 1, 'url' => $primary, 'key' => AiActionProductImageStager::urlKey($primary), 'label' => $this->urlLabel($primary)];
            } else {
                $issues[] = $this->issue('invalid_image_url', 'primary_image_url', 'error', 'رابط الصورة الرئيسية غير صالح؛ لم يُطلب ولم يُنزّل.');
            }
        }
        foreach ($additional as $position => $url) {
            if ($valid($url)) {
                $sources[] = ['kind' => 'url', 'role' => 'additional', 'order' => 2 + $position, 'url' => $url, 'key' => AiActionProductImageStager::urlKey($url), 'label' => $this->urlLabel($url)];
            } else {
                $issues[] = $this->issue('invalid_image_url', 'additional_image_urls', 'error', 'رابط صورة إضافية غير صالح؛ لم يُطلب ولم يُنزّل.');
            }
        }

        // Archive entries are named `<SKU|barcode>.<ext>` (cover) and `<SKU|barcode>__2.<ext>`, `__3`, … (extras).
        $identifiers = array_values(array_unique(array_filter([
            $p['sku'] === null ? null : mb_strtolower($p['sku'], 'UTF-8'),
            $p['barcode'] === null ? null : mb_strtolower($p['barcode'], 'UTF-8'),
            $target?->sku === null ? null : mb_strtolower((string) $target->sku, 'UTF-8'),
        ], static fn ($v): bool => $v !== null && $v !== '')));
        foreach ($ctx['catalog']['archive'] as $entry) {
            foreach ($identifiers as $needle) {
                $order = null;
                if ($entry['lookup'] === $needle) {
                    $order = 1;
                } elseif (preg_match('/^'.preg_quote($needle, '/').'__(\d+)$/u', $entry['lookup'], $parts) === 1) {
                    $order = max(2, (int) $parts[1]);
                }
                if ($order === null) {
                    continue;
                }
                if (isset($seen['archive'][$entry['id']])) {
                    $issues[] = $this->issue('archive_image_ambiguous', null, 'error', "الصورة «{$entry['label']}» تطابق أكثر من صف (أول مطابقة في الصف {$seen['archive'][$entry['id']]}).");
                } else {
                    $seen['archive'][$entry['id']] = (int) $row['source_row'];
                    $sources[] = ['kind' => 'archive', 'role' => $order === 1 ? 'primary' : 'additional', 'order' => $order, 'entry' => $entry, 'key' => $entry['source_key'], 'label' => $entry['label']];
                }
                break;
            }
        }

        usort($sources, static fn (array $a, array $b): int => [($a['role'] === 'primary' ? 0 : 1), $a['order'], $a['label']] <=> [($b['role'] === 'primary' ? 0 : 1), $b['order'], $b['label']]);
        if (count(array_filter($sources, static fn (array $s): bool => $s['role'] === 'primary')) > 1) {
            $issues[] = $this->issue('multiple_primary_images', 'primary_image_url', 'error', 'حُدّدت أكثر من صورة رئيسية للصف (رابط وصورة أرشيف)؛ أبقِ مصدراً رئيسياً واحداً.');
        }

        // — Evidence: what each source actually is, from staging only. —
        $items = [];
        $hashes = [];
        foreach ($sources as $position => $source) {
            $item = [
                'key' => substr(hash('sha256', $source['role'].'|'.$source['key']), 0, 24), 'role' => $source['role'], 'position' => $position,
                'source' => ['kind' => $source['kind'], 'label' => $source['label']],
                'status' => 'ready', 'code' => null, 'message' => null, 'image' => null,
            ];
            $staged = $source['kind'] === 'archive' ? $source['entry'] : ($ctx['catalog']['by_key'][$source['key']] ?? null);
            if ($staged === null) {
                $failure = $ctx['failures'][$source['key']] ?? null;
                if ($failure !== null) {
                    $item['status'] = $failure['status'];
                    $item['code'] = $failure['code'];
                    $item['message'] = $failure['message'];
                } elseif (config('product_import_media.remote_enabled') !== true) {
                    $item['status'] = 'unavailable';
                    $item['code'] = 'remote_fetch_disabled';
                    $item['message'] = 'جلب الصور من روابط خارجية غير مفعّل على المنصة؛ لن تُطبَّق هذه الصورة.';
                } else {
                    $item['status'] = 'error';
                    $item['code'] = 'image_not_staged';
                    $item['message'] = 'لم تُجهَّز هذه الصورة للمعاينة بعد؛ أنشئ معاينة جديدة.';
                }
            } else {
                $item['image'] = ['id' => $staged['id'], 'sha256' => $staged['sha256'], 'mime_type' => $staged['mime_type'], 'size' => $staged['size'], 'width' => $staged['width'], 'height' => $staged['height']];
                if (isset($hashes[$staged['sha256']])) {
                    $item['status'] = 'skipped';
                    $item['code'] = 'duplicate_in_row';
                    $item['message'] = 'الصورة نفسها مكررة داخل الصف؛ تُرفق مرة واحدة.';
                }
                $hashes[$staged['sha256']] = true;
            }
            $items[] = $item;
        }

        // — Decision: an existing product's gallery is append-only and needs an explicit, row-level approval. —
        $existing = $target === null ? ['count' => 0, 'sha' => []] : ($live['media'][(string) $target->id] ?? ['count' => 0, 'sha' => []]);
        $approved = ($row['media']['existing_update_approved'] ?? false) === true;
        $mode = $decision === 'update' ? 'append_existing' : 'new_product';
        $readyCount = count(array_filter($items, static fn (array $i): bool => $i['status'] === 'ready'));
        if ($decision === 'update' && $readyCount > 0 && ! $approved) {
            foreach ($items as &$item) {
                if ($item['status'] === 'ready') {
                    $item['status'] = 'skipped';
                    $item['code'] = 'existing_product_needs_decision';
                    $item['message'] = 'منتج موجود: لا تُضاف صور إلا بقرار صريح لهذا الصف.';
                }
            }
            unset($item);
            $issues[] = $this->issue('media_update_not_approved', 'primary_image_url', 'warning', 'صور هذا الصف لمنتج موجود لم تُعتمد؛ سيُحدَّث المنتج دون صور (لا استبدال ولا حذف لصوره الحالية).');
        } elseif ($decision === 'update' && $approved) {
            foreach ($items as &$item) {
                if ($item['status'] === 'ready' && isset($existing['sha'][$item['image']['sha256']])) {
                    $item['status'] = 'skipped';
                    $item['code'] = 'already_attached';
                    $item['message'] = 'الصورة موجودة بالفعل ضمن صور المنتج؛ لن تُكرَّر.';
                }
            }
            unset($item);
        }
        $readyCount = count(array_filter($items, static fn (array $i): bool => $i['status'] === 'ready'));
        $capacity = self::MAX_GALLERY;
        if ($readyCount > 0 && ($decision === 'update' ? $existing['count'] : 0) + $readyCount > $capacity) {
            $issues[] = $this->issue('too_many_images', 'additional_image_urls', 'error', "الحد الأقصى لمعرض المنتج {$capacity} صور؛ ستتجاوزه صور هذا الصف.");
        }

        foreach ($items as $item) {
            $field = $item['role'] === 'primary' ? 'primary_image_url' : 'additional_image_urls';
            if ($item['status'] === 'error') {
                $issues[] = $this->issue((string) $item['code'], $field, 'error', "صورة «{$item['source']['label']}»: {$item['message']}");
            } elseif ($item['status'] === 'unavailable') {
                $issues[] = $this->issue((string) $item['code'], $field, 'warning', "صورة «{$item['source']['label']}»: {$item['message']}");
            }
        }

        $statuses = array_count_values(array_column($items, 'status'));
        $status = match (true) {
            $items === [] => 'none',
            ($statuses['error'] ?? 0) > 0 => 'error',
            $readyCount > 0 => 'ready',
            ($statuses['unavailable'] ?? 0) > 0 => 'unavailable',
            in_array('existing_product_needs_decision', array_column($items, 'code'), true) => 'needs_decision',
            default => 'skipped',
        };

        return [[
            // Raw URLs are deliberately not echoed: a signed link would otherwise be copied into every stored preview.
            'count' => count($items), 'ready' => $readyCount,
            'will_apply' => $readyCount > 0 && $status !== 'error', 'status' => $status, 'mode' => $mode,
            'existing' => ['count' => $existing['count'], 'update_approved' => $decision === 'update' ? $approved : null],
            'items' => $items,
        ], $issues];
    }

    /**
     * The syntactically valid image URLs of an undecided-or-decided row, in the order a preview will name them.
     * The approval service stages exactly these (and only these) before building the preview.
     *
     * @param  array<string,mixed>  $row
     * @return list<string>
     */
    public static function candidateUrls(array $row): array
    {
        if (! in_array($row['decision'] ?? null, ['create', 'update'], true) || ! is_array($row['fields'] ?? null)) {
            return [];
        }
        [$primary, $additional] = self::rawUrls($row['fields']);

        return array_values(array_filter(array_merge($primary === '' ? [] : [$primary], $additional), static fn (string $url): bool => self::validUrl($url)));
    }

    /** @param array<string,mixed> $fields @return array{0:string,1:list<string>} */
    private static function rawUrls(array $fields): array
    {
        $primary = trim((string) ($fields['primary_image_url']['value'] ?? ''));
        $additional = array_values(array_filter(array_map('trim', preg_split('/[;|\r\n]+/', (string) ($fields['additional_image_urls']['value'] ?? '')) ?: []), static fn (string $v): bool => $v !== ''));

        return [$primary, $additional];
    }

    private static function validUrl(string $url): bool
    {
        $parts = parse_url($url);

        return filter_var($url, FILTER_VALIDATE_URL) !== false && mb_strlen($url) <= 2048
            && in_array(strtolower((string) ($parts['scheme'] ?? '')), ['http', 'https'], true)
            && ($parts['host'] ?? '') !== '' && ! isset($parts['user']) && ! isset($parts['pass']);
    }

    private function urlLabel(string $url): string
    {
        $parts = parse_url($url) ?: [];

        return mb_substr(((string) ($parts['host'] ?? '')).((string) ($parts['path'] ?? '')), 0, 255);
    }

    /**
     * Archive-level summary: how many staged entries were used by a row and which were not (a typo in a file name
     * must be visible, not silently dropped).
     *
     * @param  list<array<string,mixed>>  $archive
     * @param  array<string,int>  $used
     * @return array{archive:array<string,mixed>}
     */
    private function archiveSummary(array $archive, array $used): array
    {
        $unmatched = array_values(array_map(static fn (array $e): array => ['id' => $e['id'], 'label' => $e['label']], array_filter($archive, static fn (array $e): bool => ! isset($used[$e['id']]))));

        return ['archive' => ['total' => count($archive), 'matched' => count($archive) - count($unmatched), 'unmatched' => $unmatched]];
    }

    private function existing(Product $product, string $key): mixed
    {
        return match ($key) {
            'sale_price', 'purchase_price' => (int) $product->{$key},
            'min_sale_price' => $product->min_sale_price === null ? null : (int) $product->min_sale_price,
            'tax_rate' => (int) $product->tax_rate,
            'reorder_level' => $product->reorder_level === null ? null : (int) $product->reorder_level,
            'track_inventory', 'is_active' => (bool) $product->{$key},
            'category' => $product->category_id !== null ? $product->productCategory?->name : ($product->category === null ? null : (string) $product->category),
            'brand' => $product->brand_id !== null ? $product->productBrand?->name : ($product->brand === null ? null : (string) $product->brand),
            'unit_template' => $product->unit_template_id === null ? null : ($product->unitTemplate?->name),
            default => $product->{$key} === null ? null : (string) $product->{$key},
        };
    }

    /** @return array<string,mixed> */
    private function matchInfo(string $kind, ?string $value, ?Product $product): array
    {
        return [
            'kind' => $kind, 'value' => $value,
            'target_product_id' => $product === null ? null : (string) $product->id,
            'target_version' => $product?->updated_at?->clone()->utc()->format('Y-m-d\TH:i:s.u\Z'),
            'target_name' => $product === null ? null : (string) $product->name,
            'target_sku' => $product?->sku === null ? null : (string) $product->sku,
        ];
    }

    private function identifierValue(string $kind, array $p): ?string
    {
        return match ($kind) { 'nebrax_id' => $p['nebrax_id'], 'sku' => $p['sku'], 'barcode' => $p['barcode'], default => null };
    }

    /** @param list<array<string,mixed>> $rows @param list<array<string,mixed>> $presentIssues @return array<string,int> */
    private function totals(array $rows, array $presentIssues): array
    {
        $count = static fn (string $operation): int => count(array_filter($rows, static fn (array $r): bool => $r['operation'] === $operation));
        $errors = count($presentIssues);
        $warnings = 0;
        $cost = false;
        $images = 0;
        foreach ($rows as $row) {
            $images += (int) ($row['images']['ready'] ?? 0);
            foreach ($row['issues'] as $issue) {
                $issue['severity'] === 'error' ? $errors++ : $warnings++;
            }
            foreach ($row['changes'] as $change) {
                $cost = $cost || ($change['field'] === 'purchase_price' && $change['after'] !== null);
            }
        }

        return [
            'rows' => count($rows), 'create' => $count('create'), 'update' => $count('update'), 'skip' => $count('skip'),
            'blocked' => $count('blocked'), 'errors' => $errors, 'warnings' => $warnings, 'has_cost_values' => $cost, 'images' => $images,
        ];
    }

    private function label(string $field): string
    {
        return '«'.((string) (ProductImportFields::get($field)['label_ar'] ?? $field)).'»';
    }

    private function display(mixed $value): ?string
    {
        return is_scalar($value) && trim((string) $value) !== '' ? mb_substr(trim((string) $value), 0, 255) : null;
    }

    /** @return array{code:string,field:?string,severity:string,message:string} */
    private function issue(string $code, ?string $field, string $severity, string $message): array
    {
        return ['code' => $code, 'field' => $field, 'severity' => $severity, 'message' => $message];
    }
}
