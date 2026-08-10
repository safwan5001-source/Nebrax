<?php

namespace App\Support;

use App\Models\Tenant;
use App\Tenancy\TenantContext;

/**
 * ═══════════════════════════════════════════════════════════════
 *  تفضيلات المستأجر — قراءة موحّدة من `tenants.settings[$group]`
 * ═══════════════════════════════════════════════════════════════
 *  مصدر واحد تقرأ منه **الخدماتُ** الإعدادات، لا المتحكّمات وحدها. بلا هذا
 *  المصدر يبقى الإعداد محفوظاً ولا يقرؤه أحد — شاشةٌ تَعِد ولا تفعل، وهو
 *  أسوأ من غياب الشاشة أصلاً.
 *
 *  التخزين في عمود `settings` من نوع json على `tenants` — لا جدول ولا هجرة.
 */
class Settings
{
    /** الافتراضات لكل مجموعة. المفتاح غير المعرَّف هنا لا يُقرأ ولا يُكتب. */
    public const DEFAULTS = [
        'sales' => [
            'default_tax_rate'     => 15,
            'default_payment_type' => 'credit',
            'quote_validity_days'  => 14,
            'invoice_prefix'       => 'INV',
            'default_terms'        => '',
        ],
        'purchases' => [
            'default_tax_rate'      => 15,
            'default_payment_type'  => 'credit',
            'default_tax_inclusive' => false,
            'purchase_prefix'       => 'BILL',
        ],
    ];

    /** كل إعدادات مجموعة، مدموجةً فوق افتراضاتها. */
    public static function group(string $group, ?Tenant $tenant = null): array
    {
        $defaults = self::DEFAULTS[$group] ?? [];
        $tenant ??= self::tenant();

        if (! $tenant) {
            return $defaults;
        }

        // المفاتيح المجهولة تُهمَل: الافتراضات هي العقد.
        $stored = array_intersect_key($tenant->settings[$group] ?? [], $defaults);

        return array_merge($defaults, $stored);
    }

    /** قيمة إعداد واحد. */
    public static function get(string $group, string $key): mixed
    {
        return self::group($group)[$key] ?? null;
    }

    /** دمج المُدخل فوق القائم وحفظه. المفاتيح غير المرسلة تبقى كما هي. */
    public static function put(string $group, array $values, ?Tenant $tenant = null): array
    {
        $tenant ??= self::tenant();
        if (! $tenant) {
            return self::group($group);
        }

        $merged  = array_merge(self::group($group, $tenant), array_filter(
            array_intersect_key($values, self::DEFAULTS[$group] ?? []),
            fn ($v) => $v !== null
        ));

        $settings          = $tenant->settings ?? [];
        $settings[$group]  = $merged;
        $tenant->update(['settings' => $settings]);

        return $merged;
    }

    /** المستأجر النشط، أو null خارج سياق مستأجر (أوامر artisan). */
    private static function tenant(): ?Tenant
    {
        $id = app(TenantContext::class)->id();

        return $id ? Tenant::find($id) : null;
    }
}
