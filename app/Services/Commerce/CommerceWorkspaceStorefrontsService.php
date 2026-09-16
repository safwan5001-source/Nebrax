<?php

namespace App\Services\Commerce;

use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\StorefrontDomain;
use App\Support\HostnameNormalizer;
use App\Support\InvalidHostnameException;
use App\Tenancy\TenantContext;
use RuntimeException;

/**
 * COM-WS-2 — قائمة متاجر الويب للمستأجر الحالي فقط.
 *
 * مصدر سلطة المستأجر هو `TenantContext` الذي ضبطه `SetTenant` من
 * `$user->tenant_id`. لا يُقرأ مستأجر ولا متجر ولا نطاق من الاستعلام أو
 * الترويسات أو الـ Host. ليست هذه واجهة `GET store/v1/storefront`
 * المحسومة بالنطاق للعامة.
 *
 * `preview_url` يُبنى على الخادم من نطاق نشط ومُتحقق فقط، بمخطط https
 * ثابت — لا يُركَّب في المتصفح، ولا يُرجَع hostname خام، ولا يُكشف
 * `tenant_id`.
 */
final class CommerceWorkspaceStorefrontsService
{
    /**
     * @return list<array{id: string, name: string, sales_channel_id: string, is_active: bool, preview_url: ?string, default_locale: string}>
     */
    public function listForCurrentTenant(): array
    {
        $tenantId = app(TenantContext::class)->id();
        if ($tenantId === null) {
            throw new RuntimeException('لا سياق مستأجر نشط.');
        }

        $storefronts = Storefront::query()
            ->where('is_active', true)
            ->with([
                'salesChannel',
                'domains' => function ($query) {
                    $query->where('is_active', true)
                        ->where('verification_status', StorefrontDomain::VERIFICATION_VERIFIED)
                        ->orderByDesc('is_primary')
                        ->orderBy('hostname');
                },
            ])
            ->orderBy('name')
            ->orderBy('id')
            ->get();

        $stores = [];
        foreach ($storefronts as $storefront) {
            if ($storefront->tenant_id !== $tenantId) {
                continue;
            }

            $channel = $storefront->salesChannel;
            if (
                $channel === null
                || $channel->tenant_id !== $tenantId
                || $channel->type !== SalesChannel::TYPE_WEB
            ) {
                continue;
            }

            $stores[] = [
                'id' => $storefront->id,
                'name' => $storefront->name,
                'sales_channel_id' => $channel->id,
                'is_active' => true,
                'preview_url' => $channel->is_active
                    ? $this->authorizedPreviewUrl($storefront, $tenantId)
                    : null,
                'default_locale' => $storefront->default_locale,
            ];
        }

        return $stores;
    }

    /**
     * STORE-ADMIN-ADOPT-1B-1 — تحديث `name`/`default_locale` فقط لمتجر
     * قائم يخصّ المستأجر الحالي. لا كتابة على أي حقل آخر (لا `tenant_id`،
     * لا `sales_channel_id`، لا `slug`، لا `is_active`، لا أي نطاق).
     *
     * الملكية تُعاد التحقق منها صراحةً بعد الحلّ عبر `Storefront::query()`
     * (يخضع لـ`TenantScope` أصلاً) — دفاعٌ متعدد الطبقات يطابق نمط
     * `listForCurrentTenant()` أعلاه وفحص `Storefront::booted()`. صفٌّ غير
     * موجود أو يخصّ مستأجراً آخر يُترجَم دوماً إلى `null` (404 لا 403 على
     * مستوى المتحكم) — لا تسريب وجود.
     *
     * @param  array{name?: ?string, default_locale?: ?string}  $attributes
     * @return array{id: string, name: string, sales_channel_id: string, is_active: bool, preview_url: ?string, default_locale: string}|null
     */
    public function updateIdentityForCurrentTenant(string $storefrontId, array $attributes): ?array
    {
        $tenantId = app(TenantContext::class)->id();
        if ($tenantId === null) {
            throw new RuntimeException('لا سياق مستأجر نشط.');
        }

        $storefront = Storefront::query()->find($storefrontId);
        if ($storefront === null || $storefront->tenant_id !== $tenantId) {
            return null;
        }

        $update = [];
        if (array_key_exists('name', $attributes) && $attributes['name'] !== null) {
            $update['name'] = $attributes['name'];
        }
        if (array_key_exists('default_locale', $attributes) && $attributes['default_locale'] !== null) {
            $update['default_locale'] = $attributes['default_locale'];
        }

        if ($update !== []) {
            $storefront->forceFill($update)->save();
        }

        $storefront->load(['salesChannel', 'domains' => function ($query) {
            $query->where('is_active', true)
                ->where('verification_status', StorefrontDomain::VERIFICATION_VERIFIED)
                ->orderByDesc('is_primary')
                ->orderBy('hostname');
        }]);

        $channel = $storefront->salesChannel;
        if ($channel === null || $channel->tenant_id !== $tenantId || $channel->type !== SalesChannel::TYPE_WEB) {
            return null;
        }

        return [
            'id' => $storefront->id,
            'name' => $storefront->name,
            'sales_channel_id' => $channel->id,
            'is_active' => true,
            'preview_url' => $channel->is_active
                ? $this->authorizedPreviewUrl($storefront, $tenantId)
                : null,
            'default_locale' => $storefront->default_locale,
        ];
    }

    private function authorizedPreviewUrl(Storefront $storefront, string $tenantId): ?string
    {
        $candidates = $storefront->domains
            ->filter(function (StorefrontDomain $domain) use ($storefront, $tenantId) {
                return $domain->tenant_id === $tenantId
                    && $domain->storefront_id === $storefront->id
                    && $domain->is_active
                    && $domain->isVerified();
            })
            ->sortBy(fn (StorefrontDomain $domain) => ($domain->is_primary ? '0' : '1').$domain->hostname)
            ->values();

        foreach ($candidates as $domain) {
            try {
                $hostname = HostnameNormalizer::normalize((string) $domain->hostname);
            } catch (InvalidHostnameException) {
                continue;
            }

            return 'https://'.$hostname.'/';
        }

        return null;
    }
}
