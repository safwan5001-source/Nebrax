<?php
namespace App\Services\Commerce;

use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\StorefrontDomain;
use App\Models\Tenant;
use App\Support\Commerce\CatalogSlug;
use App\Support\ManagedStorefrontHostname;
use App\Tenancy\TenantContext;
use App\Tenancy\TenantScope;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * AWJ-MULTI-STORE-1 — إنشاء متجر ويب إضافي للمستأجر الحالي.
 *
 * هذه حالة استخدام منفصلة عمداً عن `provisionFirstStorefrontForCurrentTenant()`:
 * الهوية القديمة `web`/`main` وhostname المستأجر محفوظة حرفياً للمتجر الأول.
 * كل متجر إضافي يحصل على قناة وStorefront وhostname مستقلين في معاملة واحدة.
 */
final class CreateStorefrontForCurrentTenant
{
    /**
     * @return array{id: string, name: string, sales_channel_id: string, is_active: bool, preview_url: string, default_locale: string, created: bool}
     */
    public function create(string $displayName, string $defaultLocale = 'ar', ?bool $customerAccountsEnabled = null): array
    {
        $tenantId = app(TenantContext::class)->id();
        if ($tenantId === null) {
            throw new RuntimeException('لا سياق مستأجر نشط.');
        }
        $name = trim($displayName);
        if ($name === '') {
            throw new RuntimeException('اسم المتجر مطلوب.');
        }
        if (! in_array($defaultLocale, ['ar', 'en'], true)) {
            throw new RuntimeException('لغة المتجر غير مدعومة.');
        }
        $baseDomain = ManagedStorefrontHostname::configuredBaseDomain();

        return DB::transaction(function () use ($tenantId, $name, $defaultLocale, $baseDomain, $customerAccountsEnabled): array {
            $tenant = Tenant::query()->whereKey($tenantId)->lockForUpdate()->first();
            if ($tenant === null) {
                throw new RuntimeException('المستأجر غير موجود.');
            }

            // السلاج فريد لكل مستأجر (قيد القاعدة)، لكن المضيف الناتج
            // `{tenant}-{store}` فريد عالمياً: يُلحَق اللاحقة الرقمية (حتمياً) إن كان
            // المضيف محجوزاً لمتجر/مستأجر آخر — لا فشل ولا اختيار عشوائي.
            $availability = app(ManagedHostnameAvailability::class);
            $slug = CatalogSlug::derive(
                $name,
                fn (string $candidate): bool => Storefront::withTrashed()
                    ->where('tenant_id', $tenantId)
                    ->where('slug', $candidate)
                    ->exists()
                    || $availability->isTaken(
                        ManagedStorefrontHostname::forAdditionalStoreSlug($candidate, $tenant->slug, $baseDomain),
                        $baseDomain,
                    ),
                'store',
            );
            $channelSlug = CatalogSlug::derive(
                $slug,
                fn (string $candidate): bool => SalesChannel::withTrashed()
                    ->where('tenant_id', $tenantId)
                    ->where('slug', $candidate)
                    ->exists(),
                'store',
            );

            // B2C-DEFAULT: a NEW retail store starts with customer accounts ON unless the creator said otherwise;
            // the deployment gate stays authoritative (see NewRetailChannelDefaults).
            $channel = NewRetailChannelDefaults::createWebChannel([
                'tenant_id' => $tenantId,
                'slug' => $channelSlug,
                'name' => $name,
                'is_active' => true,
            ], $customerAccountsEnabled);
            $storefront = Storefront::create([
                'tenant_id' => $tenantId,
                'sales_channel_id' => $channel->id,
                'slug' => $slug,
                'name' => $name,
                'is_active' => true,
                'default_locale' => $defaultLocale,
            ]);

            // المتجر الأول يبقى `{tenant}.{base}`؛ الإضافي `{tenant}-{store}.{base}`
            // (شريحة واحدة — تغطيها شهادة wildcard)، مع تطبيع مركزي وعدم قبول hostname من العميل.
            $hostname = ManagedStorefrontHostname::forAdditionalStoreSlug(
                $slug,
                $tenant->slug,
                $baseDomain,
            );
            if (StorefrontDomain::withoutGlobalScope(TenantScope::class)->where('hostname', $hostname)->exists()) {
                throw new StorefrontHostnameConflictException('اسم النطاق المولَّد مستخدم بالفعل.');
            }
            $domain = StorefrontDomain::create([
                'tenant_id' => $tenantId,
                'storefront_id' => $storefront->id,
                'hostname' => $hostname,
                'type' => StorefrontDomain::TYPE_AWJ_SUBDOMAIN,
                'is_primary' => true,
                'is_active' => true,
                'verification_status' => StorefrontDomain::VERIFICATION_VERIFIED,
            ]);

            return [
                'id' => $storefront->id,
                'name' => $storefront->name,
                'sales_channel_id' => $channel->id,
                'is_active' => true,
                'preview_url' => 'https://'.$domain->hostname.'/',
                'default_locale' => $storefront->default_locale,
                'created' => true,
            ];
        });
    }
}
