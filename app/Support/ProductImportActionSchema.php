<?php

namespace App\Support;

use Illuminate\Validation\ValidationException;

final class ProductImportActionSchema
{
    private const DECISIONS = ['create', 'update', 'skip', 'needs_review'];
    private const ORIGINS = ['extracted', 'user', 'ai_suggested', 'erp_existing', 'missing'];
    private const MATCH_KINDS = ['nebrax_id', 'sku', 'barcode', 'none'];
    private const SEVERITIES = ['error', 'warning'];

    /** @return array{row_count:int,error_count:int,needs_review_count:int} */
    public function validate(array $proposal): array
    {
        $this->exactKeys($proposal, ['schema_version', 'rows'], 'proposal');
        $encoded = json_encode($proposal, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        if ($encoded === false || strlen($encoded) > max(1024, (int) config('ai_actions.max_proposal_bytes'))) {
            $this->invalid('proposal', 'حجم مسودة AI Action يتجاوز الحد الآمن.');
        }
        if (($proposal['schema_version'] ?? null) !== 1 || ! is_array($proposal['rows'] ?? null) || ! array_is_list($proposal['rows'])) {
            $this->invalid('proposal', 'صيغة مسودة استيراد المنتجات غير صالحة.');
        }

        $max = max(1, (int) config('ai_actions.max_product_rows', 2000));
        if (count($proposal['rows']) > $max) {
            $this->invalid('rows', "تتجاوز المسودة الحد الأقصى ({$max} صفاً).");
        }

        $ids = [];
        $errors = 0;
        $needsReview = 0;
        foreach ($proposal['rows'] as $index => $row) {
            $path = "rows.{$index}";
            if (! is_array($row)) {
                $this->invalid($path, 'يجب أن يكون الصف كائناً منظماً.');
            }
            $this->exactKeys($row, ['row_id', 'source_row', 'match', 'decision', 'fields', 'violations', 'media'], $path);

            $rowId = $row['row_id'] ?? null;
            if (! is_string($rowId) || $rowId === '' || mb_strlen($rowId) > 128 || isset($ids[$rowId])) {
                $this->invalid("{$path}.row_id", 'معرّف الصف مطلوب وفريد ومحدود.');
            }
            $ids[$rowId] = true;
            if (! is_int($row['source_row'] ?? null) || $row['source_row'] < 1) {
                $this->invalid("{$path}.source_row", 'رقم صف المصدر غير صالح.');
            }
            if (! in_array($row['decision'] ?? null, self::DECISIONS, true)) {
                $this->invalid("{$path}.decision", 'قرار الصف غير معروف.');
            }
            $needsReview += $row['decision'] === 'needs_review' ? 1 : 0;
            $this->validateMatch($row['match'] ?? null, "{$path}.match");
            $this->validateFields($row['fields'] ?? null, "{$path}.fields");
            $errors += $this->validateViolations($row['violations'] ?? null, "{$path}.violations");
            $this->validateMedia($row['media'] ?? null, "{$path}.media");
        }

        return ['row_count' => count($proposal['rows']), 'error_count' => $errors, 'needs_review_count' => $needsReview];
    }

    private function validateMatch(mixed $match, string $path): void
    {
        if (! is_array($match)) {
            $this->invalid($path, 'بيانات المطابقة مطلوبة.');
        }
        $this->exactKeys($match, ['kind', 'value', 'target_product_id', 'target_version'], $path);
        if (! in_array($match['kind'] ?? null, self::MATCH_KINDS, true)) {
            $this->invalid("{$path}.kind", 'نوع المطابقة غير موثوق.');
        }
        foreach (['value', 'target_product_id', 'target_version'] as $key) {
            if (($match[$key] ?? null) !== null && (! is_string($match[$key]) || mb_strlen($match[$key]) > 255)) {
                $this->invalid("{$path}.{$key}", 'قيمة المطابقة غير صالحة.');
            }
        }
        if ($match['kind'] === 'none' && (($match['target_product_id'] ?? null) !== null || ($match['target_version'] ?? null) !== null)) {
            $this->invalid($path, 'المطابقة الفارغة لا تقبل منتجاً مستهدفاً.');
        }
    }

    private function validateFields(mixed $fields, string $path): void
    {
        if (! is_array($fields) || array_is_list($fields)) {
            $this->invalid($path, 'حقول الصف يجب أن تكون خريطة.');
        }
        foreach ($fields as $key => $field) {
            if (! is_string($key) || ProductImportFields::get($key) === null || ! is_array($field)) {
                $this->invalid("{$path}.{$key}", 'حقل منتج غير معروف.');
            }
            $this->exactKeys($field, ['value', 'origin', 'confidence'], "{$path}.{$key}");
            $value = $field['value'];
            if (! is_null($value) && ! is_string($value) && ! is_int($value) && ! is_float($value) && ! is_bool($value)) {
                $this->invalid("{$path}.{$key}.value", 'قيمة الحقل يجب أن تكون قيمة أولية أو null.');
            }
            $definition = ProductImportFields::get($key);
            $maxLength = max(1, (int) ($definition['max'] ?? 10000));
            if (is_string($value) && mb_strlen($value) > $maxLength) {
                $this->invalid("{$path}.{$key}.value", 'قيمة الحقل تتجاوز الحد المسموح.');
            }
            if (! in_array($field['origin'] ?? null, self::ORIGINS, true)) {
                $this->invalid("{$path}.{$key}.origin", 'مصدر القيمة غير معروف.');
            }
            $confidence = $field['confidence'] ?? null;
            if ($confidence !== null && (! is_int($confidence) || $confidence < 0 || $confidence > 100)) {
                $this->invalid("{$path}.{$key}.confidence", 'الثقة يجب أن تكون عدداً صحيحاً من 0 إلى 100.');
            }
            if (($field['origin'] ?? null) === 'missing' && ($field['value'] ?? null) !== null) {
                $this->invalid("{$path}.{$key}", 'القيمة المفقودة يجب أن تبقى null.');
            }
        }
    }

    private function validateViolations(mixed $violations, string $path): int
    {
        if (! is_array($violations) || ! array_is_list($violations) || count($violations) > 100) {
            $this->invalid($path, 'قائمة المخالفات غير صالحة.');
        }
        $errors = 0;
        foreach ($violations as $index => $violation) {
            if (! is_array($violation)) {
                $this->invalid("{$path}.{$index}", 'المخالفة يجب أن تكون كائناً منظماً.');
            }
            $this->exactKeys($violation, ['code', 'field', 'severity', 'message'], "{$path}.{$index}");
            if (! is_string($violation['code'] ?? null) || ! preg_match('/^[a-z0-9_.-]{1,64}$/', $violation['code'])) {
                $this->invalid("{$path}.{$index}.code", 'رمز المخالفة غير صالح.');
            }
            if (($violation['field'] ?? null) !== null && ProductImportFields::get((string) $violation['field']) === null) {
                $this->invalid("{$path}.{$index}.field", 'حقل المخالفة غير معروف.');
            }
            if (! in_array($violation['severity'] ?? null, self::SEVERITIES, true)) {
                $this->invalid("{$path}.{$index}.severity", 'شدة المخالفة غير صالحة.');
            }
            if (! is_string($violation['message'] ?? null) || mb_strlen($violation['message']) > 500) {
                $this->invalid("{$path}.{$index}.message", 'رسالة المخالفة غير صالحة.');
            }
            $errors += $violation['severity'] === 'error' ? 1 : 0;
        }

        return $errors;
    }

    private function validateMedia(mixed $media, string $path): void
    {
        if ($media === null) {
            return;
        }
        if (! is_array($media)) {
            $this->invalid($path, 'بيانات الصور غير صالحة.');
        }
        $this->exactKeys($media, ['primary', 'additional', 'existing_update_approved'], $path);
        if (! is_bool($media['existing_update_approved'] ?? null)) {
            $this->invalid("{$path}.existing_update_approved", 'قرار تحديث الصور الموجودة مطلوب.');
        }
        $sources = array_merge([$media['primary'] ?? null], is_array($media['additional'] ?? null) ? $media['additional'] : []);
        if (! is_array($media['additional'] ?? null) || count($sources) > 8) {
            $this->invalid($path, 'معرض المنتج يقبل ثماني صور كحد أقصى.');
        }
        foreach ($sources as $index => $source) {
            if ($source === null) {
                continue;
            }
            if (! is_array($source)) {
                $this->invalid("{$path}.{$index}", 'مصدر الصورة غير صالح.');
            }
            $this->exactKeys($source, ['kind', 'value', 'sha256'], "{$path}.{$index}");
            if (! in_array($source['kind'] ?? null, ['url', 'archive'], true)
                || ! is_string($source['value'] ?? null) || mb_strlen($source['value']) > 2048
                || (($source['sha256'] ?? null) !== null && (! is_string($source['sha256']) || ! preg_match('/^[a-f0-9]{64}$/', $source['sha256'])))) {
                $this->invalid("{$path}.{$index}", 'عقد مصدر الصورة غير صالح.');
            }
        }
    }

    private function exactKeys(array $value, array $allowed, string $path): void
    {
        $missing = array_diff($allowed, array_keys($value));
        if ($missing !== []) {
            $this->invalid($path, 'حقول مطلوبة مفقودة: '.implode('، ', $missing).'.');
        }
        $unknown = array_diff(array_keys($value), $allowed);
        if ($unknown !== []) {
            $this->invalid($path, 'حقول غير معروفة: '.implode('، ', $unknown).'.');
        }
    }

    private function invalid(string $path, string $message): never
    {
        throw ValidationException::withMessages([$path => $message]);
    }
}
