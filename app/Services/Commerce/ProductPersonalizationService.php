<?php

namespace App\Services\Commerce;

use App\Models\CommerceProductPersonalizationField;
use App\Models\CommerceProductPersonalizationOption;
use App\Models\Product;
use App\Support\Commerce\PlainText;
use App\Tenancy\BranchScope;
use App\Tenancy\TenantContext;
use DomainException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use RuntimeException;

/**
 * FLOWERS-H4a / ADR-16 — تعريفات التخصيص لكل منتج.
 *
 * المنتج يبقى سيّد البيانات؛ لا سعر ولا مخزون ولا نشر ولا أثر محاسبي هنا (لا أثر
 * سعري للتخصيص في V1). الاستبدال ذرّي لمجموعة التعريفات كاملة بالمفتاح.
 */
final class ProductPersonalizationService
{
    public const MAX_FIELDS = 8;

    public const MAX_OPTIONS = 30;

    public const MAX_NEWLINES = 6;

    public const DEFAULT_TEXT_LENGTH = 60;

    public const DEFAULT_TEXTAREA_LENGTH = 250;

    /** @return list<array<string, mixed>> كل التعريفات (إدارية) */
    public function definitions(Product $product): array
    {
        $this->assertProductTenant($product);

        return $this->fieldsQuery($product->id, activeOnly: false)->map(fn ($f) => $this->present($f, includeInactive: true))->values()->all();
    }

    /** @return list<array<string, mixed>> الحقول **النشطة** فقط (عامة) */
    public function publicFields(string $productId): array
    {
        return $this->fieldsQuery($productId, activeOnly: true)->map(fn ($f) => $this->present($f, includeInactive: false))->values()->all();
    }

    /**
     * @param  list<array<string, mixed>>  $fields
     * @return list<array<string, mixed>>
     */
    public function replaceDefinitions(Product $product, array $fields): array
    {
        $this->assertProductTenant($product);

        if (count($fields) > self::MAX_FIELDS) {
            throw new DomainException('عدد مُدخَلات التخصيص يتجاوز الحد المسموح للمنتج.');
        }
        $keys = array_column($fields, 'key');
        if (count($keys) !== count(array_unique($keys))) {
            throw new DomainException('مفاتيح مُدخَلات التخصيص يجب أن تكون فريدة.');
        }

        return DB::transaction(function () use ($product, $fields) {
            // BranchScope وحده يُرفع؛ TenantScope وSoftDeletes يبقيان، فمنتجٌ حُذف بين تحميل المتحكّم
            // وهذا القفل يُرفض بـ404 بدل نجاحٍ فارغ أو 500 من قيد المفتاح الأجنبي.
            Product::withoutGlobalScope(BranchScope::class)->whereKey($product->id)->lockForUpdate()->firstOrFail();

            CommerceProductPersonalizationField::query()->where('product_id', $product->id)->delete();

            foreach (array_values($fields) as $position => $data) {
                $type = (string) $data['type'];
                $options = $data['options'] ?? [];

                if ($type === CommerceProductPersonalizationField::TYPE_SELECT) {
                    $this->assertOptions($data['key'], $options);
                } elseif ($options !== []) {
                    throw new DomainException("المُدخَل «{$data['key']}» ليس اختياراً فلا يقبل خيارات.");
                }

                $field = CommerceProductPersonalizationField::create([
                    'product_id' => $product->id,
                    'key' => $data['key'],
                    'type' => $type,
                    'label' => trim((string) $data['label']),
                    'label_en' => $this->nullable($data['label_en'] ?? null),
                    'help_text' => $this->nullable($data['help_text'] ?? null),
                    'is_required' => (bool) ($data['is_required'] ?? false),
                    'max_length' => $type === CommerceProductPersonalizationField::TYPE_SELECT
                        ? null
                        : (int) ($data['max_length'] ?? ($type === CommerceProductPersonalizationField::TYPE_TEXT ? self::DEFAULT_TEXT_LENGTH : self::DEFAULT_TEXTAREA_LENGTH)),
                    'sort_order' => $position,
                    'is_active' => (bool) ($data['is_active'] ?? true),
                ]);

                foreach (array_values($options) as $optionPosition => $option) {
                    CommerceProductPersonalizationOption::create([
                        'field_id' => $field->id,
                        'value_key' => $option['value_key'],
                        'label' => trim((string) $option['label']),
                        'label_en' => $this->nullable($option['label_en'] ?? null),
                        'sort_order' => $optionPosition,
                        'is_active' => (bool) ($option['is_active'] ?? true),
                    ]);
                }
            }

            return $this->fieldsQuery($product->id, activeOnly: false)->map(fn ($f) => $this->present($f, includeInactive: true))->values()->all();
        });
    }

    /**
     * H4b — يتحقق من مُدخَل العميل (خريطة مفتاح⇒قيمة) مقابل تعريفات المنتج **النشطة** الحالية
     * ويعيد صفوفاً مطبَّعة مع لقطة التسمية، أو يرفع 422. مفتاح مجهول/نوع خاطئ/طول زائد/خيار
     * غير موجود أو معطَّل/حقل إلزامي ناقص كلها مرفوضة. منتج بلا تعريفات نشطة يرفض أي مُدخَل.
     *
     * @param  array<string, mixed>|null  $input
     * @return list<array{field_key: string, field_type: string, label: string, label_en: ?string, value: string, value_label: ?string, sort_order: int}>
     *
     * @throws ValidationException
     */
    public function normalizeInput(Product $product, ?array $input): array
    {
        $input ??= [];
        if ($input !== [] && array_is_list($input)) {
            throw ValidationException::withMessages(['personalization' => 'صيغة مُدخَلات التخصيص غير صالحة.']);
        }

        $fields = $this->fieldsQuery($product->id, activeOnly: true);
        $known = $fields->pluck('key')->all();
        $unknown = array_values(array_diff(array_keys($input), $known));
        if ($unknown !== []) {
            throw ValidationException::withMessages(['personalization' => 'مُدخَلات تخصيص غير معروفة لهذا المنتج: '.implode(', ', $unknown)]);
        }

        $rows = [];
        $errors = [];
        foreach ($fields as $position => $field) {
            $raw = $input[$field->key] ?? null;
            if ($raw !== null && ! is_string($raw)) {
                $errors["personalization.{$field->key}"] = "قيمة «{$field->label}» غير صالحة.";

                continue;
            }

            $multiline = $field->type === CommerceProductPersonalizationField::TYPE_TEXTAREA;
            $value = $field->type === CommerceProductPersonalizationField::TYPE_SELECT
                ? ($raw === null ? null : trim($raw))
                : PlainText::normalize($raw, $multiline);
            if ($value === '' || $value === null) {
                if ($field->is_required) {
                    $errors["personalization.{$field->key}"] = "«{$field->label}» مطلوب.";
                }

                continue;
            }

            $valueLabel = null;
            if ($field->type === CommerceProductPersonalizationField::TYPE_SELECT) {
                $option = $field->options->firstWhere('value_key', $value);
                if ($option === null) {
                    $errors["personalization.{$field->key}"] = "اختيار غير متاح في «{$field->label}».";

                    continue;
                }
                $valueLabel = $option->label;
            } else {
                if (PlainText::length($value) > (int) $field->max_length) {
                    $errors["personalization.{$field->key}"] = "«{$field->label}» يتجاوز الحد الأقصى ({$field->max_length} حرفاً).";

                    continue;
                }
                if ($multiline && substr_count($value, "\n") > self::MAX_NEWLINES) {
                    $errors["personalization.{$field->key}"] = "«{$field->label}» يحتوي أسطراً أكثر من المسموح.";

                    continue;
                }
            }

            $rows[] = [
                'field_key' => $field->key,
                'field_type' => $field->type,
                'label' => $field->label,
                'label_en' => $field->label_en,
                'value' => $value,
                'value_label' => $valueLabel,
                'sort_order' => $position,
            ];
        }

        if ($errors !== []) {
            throw ValidationException::withMessages($errors);
        }

        return $rows;
    }

    /**
     * بصمة هوية السطر: فارغة بلا تخصيص ولا إضافات، وإلا SHA-256 للأزواج (مفتاح، قيمة)
     * مرتّبةً بالمفتاح — وعند وجود إضافات (ADR-18) تُضمَّن قائمتها المرتّبة (منتج، متغيّر، كمية
     * لكل أب) فيختلف «باقة + شوكولاتة» عن «باقة». بلا إضافات تبقى البصمة مطابقة لـH4 حرفياً.
     *
     * @param  list<array{field_key: string, value: string}>  $rows
     * @param  list<array{addon_product_id: string, addon_variant_id: ?string, per_parent_quantity: int}>  $addons
     */
    public static function signature(array $rows, array $addons = []): string
    {
        if ($rows === [] && $addons === []) {
            return '';
        }

        $pairs = array_map(static fn (array $r) => [$r['field_key'], $r['value']], $rows);
        usort($pairs, static fn (array $a, array $b) => strcmp($a[0], $b[0]));

        if ($addons === []) {
            return hash('sha256', json_encode($pairs, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR));
        }

        $triples = array_map(static fn (array $a) => [$a['addon_product_id'], $a['addon_variant_id'], $a['per_parent_quantity']], $addons);
        usort($triples, static fn (array $a, array $b) => strcmp($a[0], $b[0]));

        return hash('sha256', json_encode(['p' => $pairs, 'a' => $triples], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR));
    }

    /**
     * يعيد بناء خريطة المُدخَل من صفوف مخزَّنة (سلة/دمج/إعادة تحقق).
     *
     * @param  iterable<object|array>  $rows
     * @return array<string, string>
     */
    public static function inputFromRows(iterable $rows): array
    {
        $input = [];
        foreach ($rows as $row) {
            $row = (array) (is_object($row) && method_exists($row, 'toArray') ? $row->toArray() : $row);
            $input[$row['field_key']] = $row['value'];
        }

        return $input;
    }

    /** @param list<array<string, mixed>> $options */
    private function assertOptions(string $fieldKey, array $options): void
    {
        if ($options === []) {
            throw new DomainException("المُدخَل «{$fieldKey}» من نوع اختيار ويحتاج خياراً واحداً على الأقل.");
        }
        if (count($options) > self::MAX_OPTIONS) {
            throw new DomainException("خيارات المُدخَل «{$fieldKey}» تتجاوز الحد المسموح.");
        }
        $values = array_column($options, 'value_key');
        if (count($values) !== count(array_unique($values))) {
            throw new DomainException("مفاتيح خيارات المُدخَل «{$fieldKey}» يجب أن تكون فريدة.");
        }
    }

    private function fieldsQuery(string $productId, bool $activeOnly)
    {
        return CommerceProductPersonalizationField::query()
            ->where('product_id', $productId)
            ->when($activeOnly, fn ($q) => $q->where('is_active', true))
            ->with(['options' => fn ($q) => $activeOnly ? $q->where('is_active', true) : $q])
            ->orderBy('sort_order')
            ->orderBy('key')
            ->get();
    }

    /** @return array<string, mixed> */
    private function present(CommerceProductPersonalizationField $field, bool $includeInactive): array
    {
        $row = [
            'key' => $field->key,
            'type' => $field->type,
            'label' => $field->label,
            'label_en' => $field->label_en,
            'help_text' => $field->help_text,
            'is_required' => $field->is_required,
            'max_length' => $field->max_length,
            'options' => $field->options->map(function ($o) use ($includeInactive) {
                $option = ['value_key' => $o->value_key, 'label' => $o->label, 'label_en' => $o->label_en];
                if ($includeInactive) {
                    $option['is_active'] = $o->is_active;
                }

                return $option;
            })->values()->all(),
        ];
        if ($includeInactive) {
            $row['is_active'] = $field->is_active;
        }

        return $row;
    }

    private function assertProductTenant(Product $product): void
    {
        $tenantId = app(TenantContext::class)->id();
        if ($tenantId === null || $product->tenant_id !== $tenantId) {
            throw new RuntimeException('المنتج غير موجود لهذا المستأجر.');
        }
    }

    private function nullable(?string $value): ?string
    {
        return PlainText::normalize($value);
    }
}
