<?php

namespace App\Services;

use App\Models\PlatformAdministrator;
use App\Models\PlatformAdministratorAction;
use App\Models\StorefrontDomain;
use App\Models\Tenant;
use App\Services\Commerce\ManagedHostnameAvailability;
use App\Support\HostnameNormalizer;
use App\Support\ManagedHostNamespaceLock;
use App\Support\ManagedStorefrontHostname;
use App\Support\StorefrontBaseDomainMisconfiguredException;
use App\Tenancy\ReservedTenantSlugs;
use App\Tenancy\TenantHostnameResolver;
use App\Tenancy\TenantScope;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use RuntimeException;

/**
 * إصلاح تشغيلي: تغيير `tenants.slug` لمستأجر قائم معرّفه الحالي لا يصلح شريحة hostname
 * (مثل `nebras_flowers`) إلى معرّف صالح، دون المساس بأي بيانات أخرى.
 *
 * **نطاق ضيّق عمداً (إصلاح لا إعادة تسمية عامة):** يرفض التنفيذ إن كان المعرّف الحالي صالحاً
 * أصلاً، أو إن كان للمستأجر مضيف متجر مُدار (نسخة مشتقة من المعرّف القديم تحتاج ترحيلاً مخطَّطاً).
 *
 * **ما يُكتب:** عمودا `tenants.slug` و`tenants.updated_at` لصفّ واحد، وسطر تدقيق ثابت
 * `PlatformAdministratorAction::ACTION_SLUG_CHANGED`. لا شيء غيرهما: كل بيانات المستأجر
 * (مستخدمون، أدوار وصلاحيات، حسابات، أطراف، منتجات، قوالب، تصنيفات…) مفتاحها `tenant_id`
 * وليس السلاج، ويُثبَت ذلك داخل المعاملة بلقطة أعداد لكل جدول يحمل `tenant_id` قبل/بعد
 * (أي فرق = تراجع كامل).
 *
 * `plan()` قراءة فقط تماماً (لا كتابة ولا قفل). `apply()` يعيد تنفيذ كل الفحوص بعد أخذ
 * القفل الحصري لفضاء المضيفات المُدارة وقفل صف المستأجر، فلا سباق مع تسجيل/نطاق متزامن.
 */
final class TenantSlugChangeService
{
    /** عمود مقارنة صف المستأجر: كل شيء عدا ما نغيّره عمداً. */
    private const TENANT_ROW_MUTABLE = ['slug', 'updated_at'];

    /**
     * @return array{
     *   tenant: array<string, mixed>|null,
     *   old_slug: string|null,
     *   new_slug: string,
     *   checks: list<array{key: string, ok: bool, detail: string}>,
     *   blockers: list<string>,
     *   warnings: list<string>,
     *   urls: array<string, mixed>,
     *   preserved: array<string, int>,
     * }
     */
    public function plan(string $tenantRef, string $newSlug): array
    {
        $newSlug = mb_strtolower(trim($newSlug));
        $tenant = $this->findTenant($tenantRef);

        $checks = [];
        $warnings = [];
        $add = function (string $key, bool $ok, string $detail) use (&$checks): void {
            $checks[] = ['key' => $key, 'ok' => $ok, 'detail' => $detail];
        };

        $add('tenant_found', $tenant !== null, $tenant !== null
            ? "المستأجر {$tenant->id}"
            : 'لم يُعثر على مستأجر واحد مطابق (معرّف UUID أو السلاج الحالي بالضبط).');

        $old = $tenant?->slug;

        $add('new_slug_hostname_safe', ManagedStorefrontHostname::isHostnameSafeSlug($newSlug),
            'a-z وأرقام وشرطة داخلية فقط، حتى 63 حرفاً.');
        $add('new_slug_not_reserved', ! ReservedTenantSlugs::contains($newSlug), 'ليس ضمن الأسماء المحجوزة.');
        $add('differs_from_current', $old === null || mb_strtolower($old) !== $newSlug, 'يختلف عن المعرّف الحالي.');
        $add('current_slug_is_unsafe', $old !== null && ! ManagedStorefrontHostname::isHostnameSafeSlug($old),
            'الأداة إصلاحية: تعمل فقط حين يكون المعرّف الحالي غير صالح كـ hostname.');

        $taken = Tenant::withTrashed()
            ->whereRaw('lower(slug) = ?', [$newSlug])
            ->when($tenant !== null, fn ($q) => $q->where('id', '!=', $tenant->id))
            ->exists();
        $add('new_slug_unused_by_any_tenant', ! $taken, 'لا مستأجر آخر (ولو محذوفاً ناعماً، وبغض النظر عن حالة الأحرف) يستعمله.');

        // ERP: كل نطاق أساسي مُهيَّأ يجب أن ينتج مضيفاً يحسمه TenantHostnameResolver إلى السلاج نفسه.
        $erpUrls = [];
        $resolver = app(TenantHostnameResolver::class);
        $erpOk = true;
        foreach ((array) config('tenancy.base_domains', []) as $base) {
            $host = $newSlug.'.'.$base;
            $roundTrip = ManagedStorefrontHostname::isHostnameSafeSlug($newSlug) ? $resolver->extractSlug($host) : null;
            $erpOk = $erpOk && $roundTrip === $newSlug;
            $erpUrls[] = ['host' => $host, 'resolver_maps_to_slug' => $roundTrip === $newSlug];
        }
        $add('erp_host_resolves_to_slug', $erpOk && $erpUrls !== [], 'مضيف ERP الجديد يُحسم إلى السلاج نفسه لكل نطاق أساسي مُهيَّأ.');

        // المتجر: النطاق الأساسي مضبوط ومضيف المتجر الأول الجديد غير محجوز.
        $storefrontHost = null;
        try {
            $base = ManagedStorefrontHostname::configuredBaseDomain();
            $add('storefront_base_domain_valid', true, 'AWJ_STOREFRONT_BASE_DOMAIN صالح.');
            if (ManagedStorefrontHostname::isHostnameSafeSlug($newSlug)) {
                $storefrontHost = ManagedStorefrontHostname::forSlug($newSlug, $base);
                $add('storefront_host_free', ! app(ManagedHostnameAvailability::class)->isTaken($storefrontHost, $base),
                    "مضيف المتجر الأول {$storefrontHost} غير محجوز.");
            }
        } catch (StorefrontBaseDomainMisconfiguredException $e) {
            $add('storefront_base_domain_valid', false, 'النطاق الأساسي لمتاجر Commerce غير صالح: '.$e->getMessage());
        }

        $domains = $tenant === null ? 0 : StorefrontDomain::withoutGlobalScope(TenantScope::class)
            ->where('tenant_id', $tenant->id)->count();
        $add('tenant_has_no_storefront_domains', $domains === 0,
            'لا مضيفات متاجر للمستأجر (لا نسخة مشتقة من المعرّف القديم تحتاج ترحيلاً).');

        if ($tenant !== null) {
            if (! $tenant->is_active) {
                $warnings[] = 'المستأجر غير نشط (is_active=false) — لن يُحسم مضيفه حتى يُفعَّل.';
            }
            $pending = DB::table('auth_action_tokens')->where('tenant_id', $tenant->id)->whereNull('used_at')
                ->where('expires_at', '>', now())->count();
            if ($pending > 0) {
                $warnings[] = "{$pending} رمز استرداد/تفعيل غير مستعمل صدر بروابط المعرّف القديم؛ لن يعمل — يُطلب غيره بعد التغيير.";
            }
        }
        $warnings[] = 'جلسات المتصفح (localStorage) مرتبطة بالأصل (origin): الدخول على العنوان الجديد يحتاج تسجيل دخول جديداً، وجلسة العنوان القديم لا تتأثر.';

        $blockers = array_values(array_map(
            fn (array $c): string => $c['key'],
            array_filter($checks, fn (array $c): bool => ! $c['ok']),
        ));

        return [
            'tenant' => $tenant === null ? null : [
                'id' => $tenant->id, 'name' => $tenant->name, 'is_active' => (bool) $tenant->is_active,
                'users' => DB::table('users')->where('tenant_id', $tenant->id)->count(),
            ],
            'old_slug' => $old,
            'new_slug' => $newSlug,
            'checks' => $checks,
            'blockers' => $blockers,
            'warnings' => $warnings,
            'urls' => [
                'erp_old' => $old === null ? [] : array_map(fn ($b) => $old.'.'.$b, (array) config('tenancy.base_domains', [])),
                'erp_new' => $erpUrls,
                'storefront_preview_new' => $storefrontHost === null ? null : 'https://'.$storefrontHost.'/',
            ],
            'preserved' => $tenant === null ? [] : array_filter($this->snapshot($tenant->id)),
        ];
    }

    /**
     * ينفّذ التغيير ذرّياً. يرمي RuntimeException (والمعاملة تتراجع) عند أي مانع أو فرق في اللقطة.
     */
    public function apply(string $tenantRef, string $newSlug, PlatformAdministrator $administrator, string $reason): Tenant
    {
        if (! $administrator->is_active) {
            throw new RuntimeException('مدير المنصة غير نشط.');
        }
        if (mb_strlen(trim($reason)) < 8) {
            throw new RuntimeException('سبب التغيير إلزامي (8 أحرف على الأقل).');
        }

        $newSlug = mb_strtolower(trim($newSlug));

        return DB::transaction(function () use ($tenantRef, $newSlug, $administrator, $reason): Tenant {
            ManagedHostNamespaceLock::exclusive();

            $tenant = $this->findTenant($tenantRef);
            if ($tenant === null) {
                throw new RuntimeException('المستأجر غير موجود.');
            }
            // قفل صف المستأجر ثم إعادة تحميله: كل ما بعده يرى أحدث حالة.
            $tenant = Tenant::whereKey($tenant->id)->lockForUpdate()->firstOrFail();
            $old = $tenant->slug;

            $plan = $this->plan($tenant->id, $newSlug);
            if ($plan['blockers'] !== []) {
                throw new RuntimeException('موانع قائمة: '.implode(', ', $plan['blockers']));
            }

            $before = $this->snapshot($tenant->id);
            $rowBefore = collect($tenant->getAttributes())->except(self::TENANT_ROW_MUTABLE)->all();

            $affected = DB::table('tenants')
                ->where('id', $tenant->id)
                ->where('slug', $old)
                ->update(['slug' => $newSlug, 'updated_at' => now()]);
            if ($affected !== 1) {
                throw new RuntimeException('تغيّر صف المستأجر أثناء التنفيذ — لم يُكتب شيء.');
            }

            $fresh = Tenant::whereKey($tenant->id)->firstOrFail();
            $after = $this->snapshot($tenant->id);
            $rowAfter = collect($fresh->getAttributes())->except(self::TENANT_ROW_MUTABLE)->all();
            if ($before !== $after || $rowBefore != $rowAfter || $fresh->slug !== $newSlug) {
                throw new RuntimeException('فشل التحقق من سلامة البيانات بعد التغيير — تراجع كامل.');
            }

            PlatformAdministratorAction::create([
                'platform_administrator_id' => $administrator->id,
                'tenant_id' => $tenant->id,
                'action' => PlatformAdministratorAction::ACTION_SLUG_CHANGED,
                'from_value' => $old,
                'to_value' => $newSlug,
            ]);

            Log::notice('tenant.slug_changed', [
                'tenant_id' => $tenant->id, 'from' => $old, 'to' => $newSlug,
                'administrator_id' => $administrator->id, 'reason' => $reason,
            ]);

            return $fresh;
        });
    }

    private function findTenant(string $ref): ?Tenant
    {
        $ref = trim($ref);
        if ($ref === '') {
            return null;
        }

        $query = Tenant::query();
        $matches = preg_match('/\A[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\z/i', $ref) === 1
            ? $query->whereKey($ref)->limit(2)->get()
            : $query->where('slug', $ref)->limit(2)->get();

        return $matches->count() === 1 ? $matches->first() : null;
    }

    /**
     * عدد صفوف المستأجر في كل جدول يحمل `tenant_id` — مرجع إثبات أن التغيير لا يمسّ البيانات.
     *
     * @return array<string, int>
     */
    private function snapshot(string $tenantId): array
    {
        $counts = [];
        foreach (Schema::getTables() as $table) {
            $name = $table['name'];
            if ($name === 'migrations' || ! Schema::hasColumn($name, 'tenant_id')) {
                continue;
            }
            $counts[$name] = DB::table($name)->where('tenant_id', $tenantId)->count();
        }
        ksort($counts);

        return $counts;
    }
}
