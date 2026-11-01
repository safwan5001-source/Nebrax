<?php

namespace App\Support\Commerce;

use App\Support\Settings;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Builder;

/**
 * AD-09 / S08a — ترتيب `popularity` لقوائم منتجات التجارة (`commerce/v1`).
 *
 * التعريف: مجموع **وحدات الأساس** المباعة للمنتج (`quantity × unit_factor`) في سطور **فواتير مرحَّلة** (`status = posted`)
 * خلال نافذة أيام تنتهي اليوم. قراءة فقط: لا قيد ولا حركة مخزون ولا كتابة. لا يعيد أي رقم مبيعات — الترتيب وحده.
 *
 * الحدود المقصودة (سياسة معلنة، لا افتراض خفي):
 *  - يشمل كل القنوات والفروع (شعبية المنتج في المؤسسة)، ولا يطرح المرتجعات/الإشعارات الدائنة.
 *  - العزل: الاستعلام الفرعي مقيَّد صراحةً بـ`tenant_id` المنتج لخطّي الفاتورة والسطر، فلا تتسرّب مبيعات مستأجر آخر.
 *  - النافذة سياسة عمل قابلة للضبط لكل مستأجر (`sales.popularity_window_days`، 7..730، الافتراضي 90) — CLAUDE.md قاعدة 6.
 */
final class ProductPopularity
{
    public const DEFAULT_DAYS = 90;

    public const MIN_DAYS = 7;

    public const MAX_DAYS = 730;

    public static function windowDays(): int
    {
        $value = Settings::get('sales', 'popularity_window_days');

        return is_int($value) || (is_string($value) && ctype_digit($value))
            ? max(self::MIN_DAYS, min(self::MAX_DAYS, (int) $value))
            : self::DEFAULT_DAYS;
    }

    /** يُضاف `ORDER BY` بحسب الشعبية ثم الاسم ثم المعرّف (حتمي). `$direction` = `asc|desc`. */
    public static function apply(Builder $query, string $direction): void
    {
        $direction = strtolower($direction) === 'desc' ? 'desc' : 'asc';
        $since = CarbonImmutable::now('UTC')->subDays(self::windowDays())->toDateString();

        $query->orderByRaw(
            '(select coalesce(sum(il.quantity * coalesce(il.unit_factor, 1)), 0)'
            .' from invoice_lines il join invoices i on i.id = il.invoice_id'
            .' where il.product_id = products.id and il.tenant_id = products.tenant_id'
            .' and i.tenant_id = products.tenant_id and i.status = ? and i.invoice_date >= ?) '.$direction,
            ['posted', $since],
        )->orderBy('products.name')->orderBy('products.id');
    }
}
