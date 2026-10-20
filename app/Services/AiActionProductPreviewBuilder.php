<?php

namespace App\Services;

use App\Models\BarcodeRegistryEntry;
use App\Models\Brand;
use App\Models\Product;
use App\Models\ProductCategory;
use App\Models\UnitTemplate;
use App\Support\ProductImportFields;
use App\Support\ProductImportValueNormalizer as Normalizer;
use Illuminate\Support\Str;

/**
 * AI-ACTIONS-04: turns the proposal rows into the final, read-only picture of
 * what an import *would* do. It reads live ERP state to match existing products
 * and detect conflicts, and writes nothing. Client-supplied `match`, stored
 * `violations` and `media` are deliberately ignored: every verdict is recomputed
 * here from the field values and the live catalogue.
 */
final class AiActionProductPreviewBuilder
{
    public const SCHEMA_VERSION = 1;
    private const CHUNK = 400;
    /** Locked fields never change on an existing product; a difference is an error. */
    private const LOCKED = ['type', 'track_inventory'];
    private const MONEY = ['sale_price', 'purchase_price', 'min_sale_price'];
    private const REFERENCES = ['category' => 'التصنيف', 'brand' => 'العلامة التجارية', 'unit_template' => 'قالب الوحدات'];
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
    public function build(array $rows, array $source): array
    {
        usort($rows, static fn (array $a, array $b): int => [(int) ($a['source_row'] ?? 0), (string) ($a['row_id'] ?? '')] <=> [(int) ($b['source_row'] ?? 0), (string) ($b['row_id'] ?? '')]);

        $parsed = array_map(fn (array $row): array => $this->parse($row), $rows);
        $live = $this->liveIndex($parsed);
        $references = $this->referenceIndex($parsed);

        $seen = ['sku' => [], 'barcode' => [], 'nebrax_id' => [], 'target' => []];
        $out = [];
        foreach ($rows as $index => $row) {
            $out[] = $this->evaluate($row, $parsed[$index], $live, $references, $seen);
        }

        $issues = [];
        if ($rows === []) {
            $issues[] = $this->issue('empty_proposal', null, 'error', 'لا توجد صفوف في المسودة لمعاينتها.');
        } elseif (count(array_filter($out, static fn (array $r): bool => in_array($r['operation'], ['create', 'update'], true))) === 0
            && count(array_filter($out, static fn (array $r): bool => $r['operation'] === 'blocked')) === 0) {
            $issues[] = $this->issue('nothing_to_apply', null, 'error', 'لا يوجد صف سيُنشأ أو يُحدَّث؛ كل الصفوف مُتخطّاة أو بلا تغيير.');
        }

        return [
            'schema_version' => self::SCHEMA_VERSION,
            'type' => AiActionRegistry::PRODUCT_IMPORT,
            'source' => $source,
            'totals' => $this->totals($out, $issues),
            'issues' => $issues,
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
                foreach (Product::query()->with('unitTemplate:id,name')->whereIn($column, $chunk)->get() as $product) {
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

    /** @param list<array<string,mixed>> $parsed @return array<string,array<string,bool>> name => true (managed) | false (ambiguous) */
    private function referenceIndex(array $parsed): array
    {
        $needed = array_fill_keys(array_keys(self::REFERENCES), false);
        foreach ($parsed as $row) {
            foreach (array_keys($needed) as $key) {
                $needed[$key] = $needed[$key] || isset($row['values'][$key]);
            }
        }
        $build = static function (iterable $rows): array {
            $names = [];
            foreach ($rows as $item) {
                $needle = mb_strtolower(trim((string) $item->name), 'UTF-8');
                $names[$needle] = ! isset($names[$needle]);
            }

            return $names;
        };

        return [
            'category' => $needed['category'] ? $build(ProductCategory::query()->get(['id', 'name'])) : [],
            'brand' => $needed['brand'] ? $build(Brand::query()->get(['id', 'name'])) : [],
            'unit_template' => $needed['unit_template'] ? $build(UnitTemplate::query()->get(['id', 'name'])) : [],
        ];
    }

    /**
     * @param  array<string,mixed>  $row
     * @param  array<string,mixed>  $p
     * @param  array<string,mixed>  $live
     * @param  array<string,array<string,bool>>  $references
     * @param  array<string,array<string,int>>  $seen
     * @return array<string,mixed>
     */
    private function evaluate(array $row, array $p, array $live, array $references, array &$seen): array
    {
        $fields = $p['raw'];
        $display = [
            'name' => $this->display($fields['name']['value'] ?? null),
            'sku' => $this->display($fields['sku']['value'] ?? null),
            'barcode' => $this->display($fields['barcode']['value'] ?? null),
        ];
        $base = ['row_id' => (string) $row['row_id'], 'source_row' => (int) $row['source_row'], 'decision' => $p['decision'], 'display' => $display];

        if ($p['decision'] === 'skip') {
            return $base + ['operation' => 'skip', 'skip_reason' => 'user_skip', 'match' => $this->matchInfo('none', null, null), 'changes' => [], 'prices' => null, 'images' => null, 'issues' => []];
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
                if ($key !== 'nebrax_id' && ! in_array($key, ProductImportFields::mediaKeys(), true)) $changes[] = ['field' => $key, 'before' => null, 'after' => $value];
            }
        } else { // update
            if ($target === null) {
                $issues[] = $this->issue('update_target_missing', null, 'error', 'لا يوجد منتج مطابق بمعرّف موثوق (معرّف نبراكس أو SKU أو باركود)؛ لا يمكن التحديث.');
            } else {
                foreach (ProductImportFields::writableKeys() as $key) {
                    if (in_array($key, ProductImportFields::mediaKeys(), true) || ! array_key_exists($key, $values)) continue;
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

        foreach (self::REFERENCES as $key => $label) {
            if (isset($values[$key])) {
                $known = $references[$key][mb_strtolower(trim((string) $values[$key]), 'UTF-8')] ?? null;
                if ($known !== true) {
                    $issues[] = $this->issue('reference_unmanaged', $key, 'warning', "«{$label}» بالقيمة «{$values[$key]}» غير موجود (أو غامض) في بيانات المؤسسة ولن يُنشأ تلقائياً.");
                }
            }
        }

        [$images, $imageIssues] = $this->images($fields);
        $issues = array_merge($issues, $imageIssues);
        if ($decision === 'update' && $images['count'] > 0) {
            $images['will_apply'] = false;
            $issues[] = $this->issue('media_update_not_approved', 'primary_image_url', 'warning', 'لم تُعتمد صور المنتج الموجود؛ لن تُطبَّق صور هذا الصف.');
        }

        $hasError = count(array_filter($issues, static fn (array $i): bool => $i['severity'] === 'error')) > 0;
        $operation = $hasError ? 'blocked' : ($decision === 'create' ? 'create' : ($changes === [] ? 'skip' : 'update'));

        return $base + [
            'operation' => $operation,
            'skip_reason' => $operation === 'skip' ? 'no_changes' : null,
            'match' => $match,
            'changes' => $changes,
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

    /** @param array<string,mixed> $fields @return array{0:array<string,mixed>,1:list<array<string,mixed>>} */
    private function images(array $fields): array
    {
        $issues = [];
        $valid = static function (string $url): bool {
            $parts = parse_url($url);

            return filter_var($url, FILTER_VALIDATE_URL) !== false && mb_strlen($url) <= 2048
                && in_array(strtolower((string) ($parts['scheme'] ?? '')), ['http', 'https'], true)
                && ($parts['host'] ?? '') !== '' && ! isset($parts['user']) && ! isset($parts['pass']);
        };
        $primary = trim((string) ($fields['primary_image_url']['value'] ?? ''));
        $additional = array_values(array_filter(array_map('trim', preg_split('/[;|\r\n]+/', (string) ($fields['additional_image_urls']['value'] ?? '')) ?: []), static fn (string $v): bool => $v !== ''));
        $good = ['primary' => null, 'additional' => []];
        if ($primary !== '') {
            if ($valid($primary)) $good['primary'] = $primary;
            else $issues[] = $this->issue('invalid_image_url', 'primary_image_url', 'error', 'رابط الصورة الرئيسية غير صالح؛ لم يُطلب ولم يُنزّل.');
        }
        foreach ($additional as $url) {
            if ($valid($url)) $good['additional'][] = $url;
            else $issues[] = $this->issue('invalid_image_url', 'additional_image_urls', 'error', 'رابط صورة إضافية غير صالح؛ لم يُطلب ولم يُنزّل.');
        }
        $count = ($good['primary'] === null ? 0 : 1) + count($good['additional']);
        if ($count > 8) {
            $issues[] = $this->issue('too_many_images', 'additional_image_urls', 'error', 'الحد الأقصى للصور هو ثماني صور.');
        }

        // URLs are shown as proposed; nothing is fetched or attached at preview time.
        return [$good + ['count' => $count, 'will_apply' => $count > 0, 'fetched' => false], $issues];
    }

    private function existing(Product $product, string $key): mixed
    {
        return match ($key) {
            'sale_price', 'purchase_price' => (int) $product->{$key},
            'min_sale_price' => $product->min_sale_price === null ? null : (int) $product->min_sale_price,
            'tax_rate' => (int) $product->tax_rate,
            'reorder_level' => $product->reorder_level === null ? null : (int) $product->reorder_level,
            'track_inventory', 'is_active' => (bool) $product->{$key},
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
        foreach ($rows as $row) {
            foreach ($row['issues'] as $issue) {
                $issue['severity'] === 'error' ? $errors++ : $warnings++;
            }
            foreach ($row['changes'] as $change) {
                $cost = $cost || ($change['field'] === 'purchase_price' && $change['after'] !== null);
            }
        }

        return [
            'rows' => count($rows), 'create' => $count('create'), 'update' => $count('update'), 'skip' => $count('skip'),
            'blocked' => $count('blocked'), 'errors' => $errors, 'warnings' => $warnings, 'has_cost_values' => $cost,
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
