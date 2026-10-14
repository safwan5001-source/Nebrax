<?php

namespace App\Services\Commerce;

use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\StorefrontDomain;
use App\Models\Tenant;
use App\Support\HostnameNormalizer;
use App\Support\InvalidHostnameException;
use App\Support\ManagedStorefrontHostname;
use App\Support\StorefrontBaseDomainMisconfiguredException;
use App\Tenancy\TenantScope;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;

/**
 * Backfill الخيار A لمضيفات المتاجر المتداخلة القديمة — **إدراج فقط**.
 *
 * لكل مضيف قديم `{store}.{tenant}.{base}` يُدرَج صفّ جديد `{tenant}-{store}.{base}` لنفس
 * (tenant, storefront). **لا UPDATE ولا DELETE** لأي صف قائم، ولا يُمسّ أي جدول آخر.
 *
 * الضمانات:
 *  - المعاملة واحدة لكل التشغيل: أي خطأ/تعارض في أي مضيف يُرجع الجميع (all-or-nothing).
 *  - مرساة التسلسل: قفل صفّ المستأجر (نفس مرساة `CreateStorefrontForCurrentTenant` و
 *    `StorefrontProvisioningService`) + قفل صف النطاق القديم، بترتيب ثابت لمنع deadlock.
 *    القيد الفريد `storefront_domains.hostname` خط الدفاع الأخير.
 *  - لا حالة «أكثر امتيازاً» من المصدر: الصف الجديد نشط **فقط** إن كان المستأجر ونطاق المصدر ومتجره
 *    نشطَين وموثَّقَين وغير محذوفَين؛ وإلا يُدرَج غير نشط (لا يُفعَّل متجر أو نطاق قديم أبداً).
 *  - `is_primary = false` دائماً: الفهرس الجزئي `(storefront_id) WHERE is_primary AND is_active`
 *    يمنع نطاقَين أساسيَّين نشطَين، والصف القديم يبقى أساسياً (لا نعدّله). تبديل الأساسي
 *    خطوة منفصلة تحتاج موافقة.
 *  - عدم الانتقال بين المستأجرين: المستأجر/المتجر/القناة تُقرأ من الصف القديم وتُتحقق
 *    ثلاثياً (نطاق = متجر = قناة)، ولا يُقبل أي معرّف من المدخلات.
 *  - Idempotent: هدف موجود مسبقاً لنفس (tenant, storefront, awj_subdomain) = `already_present`
 *    (بلا كتابة). إن اختلف التفعيل أو التوثيق أو `is_primary` عن المطلوب: dry-run يُبلّغ `drift`، و`--execute` يرمي
 *    `drift` فيُرجع المعاملة كلها (لا إدراج جزئي) — دون أي تعديل للصف.
 *  - روابط HTTPS القديمة لا تصبح صالحة: لا يُلمس شيء من DNS/الشهادة، والصفوف القديمة كما هي.
 */
final class FlatHostBackfillService
{
    public const MAX_HOSTS = 10;

    /**
     * @param  list<string>  $legacyHosts  مضيفات قديمة صريحة (لا وضع «الكل» عمداً)
     * @return array{executed: bool, base_domain: string, results: list<array<string,mixed>>, has_drift: bool}
     *
     * @throws FlatHostBackfillException
     */
    public function run(array $legacyHosts, bool $execute): array
    {
        $legacyHosts = array_values(array_unique(array_map(fn ($h) => $this->normalize($h), $legacyHosts)));
        if ($legacyHosts === []) {
            throw new FlatHostBackfillException('no_hosts', 'لا مضيفات محدَّدة.');
        }
        if (count($legacyHosts) > self::MAX_HOSTS) {
            throw new FlatHostBackfillException('too_many_hosts', 'عدد المضيفات يتجاوز الحد الأقصى ('.self::MAX_HOSTS.').');
        }

        try {
            $base = ManagedStorefrontHostname::configuredBaseDomain();
        } catch (StorefrontBaseDomainMisconfiguredException $e) {
            throw new FlatHostBackfillException('base_domain', $e->getMessage());
        }

        // dry-run: قراءة فقط — بلا معاملة ولا أقفال ولا كتابة.
        return $execute
            ? DB::transaction(fn (): array => $this->process($legacyHosts, $base, true))
            : $this->process($legacyHosts, $base, false);
    }

    /** @param list<string> $legacyHosts */
    private function process(array $legacyHosts, string $base, bool $execute): array
    {
        // 1) قراءة الصفوف القديمة والتحقق من شكلها، ثم قفل المستأجرين بترتيب ثابت.
        $sources = [];
        foreach ($legacyHosts as $host) {
            $sources[$host] = $this->loadLegacy($host, $base);
        }

        if ($execute) {
            $tenantIds = array_values(array_unique(array_map(fn ($s) => $s['tenant']->id, $sources)));
            sort($tenantIds);
            foreach ($tenantIds as $tenantId) {
                Tenant::query()->whereKey($tenantId)->lockForUpdate()->first();
            }
            foreach ($sources as $host => $s) {
                StorefrontDomain::withoutGlobalScope(TenantScope::class)
                    ->whereKey($s['domain']->id)->lockForUpdate()->first();
            }
            // إعادة تحميل بعد القفل: لا قرار على قراءة قديمة.
            foreach ($legacyHosts as $host) {
                $sources[$host] = $this->loadLegacy($host, $base);
            }
        }

        $results = [];
        $hasDrift = false;
        $targets = [];

        foreach ($sources as $host => $s) {
            try {
                $target = ManagedStorefrontHostname::forAdditionalStoreSlug($s['storefront']->slug, $s['tenant']->slug, $base);
            } catch (StorefrontBaseDomainMisconfiguredException $e) {
                // مثلاً شريحة مدمجة > 63 حرفاً: فشل متحكَّم به (كما يصنّفه المخطِّط invalid_target)
                throw new FlatHostBackfillException('invalid_target', "المضيف {$host}: تعذّر توليد هدف صالح — ".$e->getMessage());
            }
            if (isset($targets[$target])) {
                throw new FlatHostBackfillException('duplicate_target', "هدفان قديمان يشتركان في {$target}.");
            }
            $targets[$target] = true;

            $desiredActive = $this->desiredActive($s);

            // القفل في التنفيذ فقط: dry-run قراءة محضة (جلسات PostgreSQL للقراءة فقط ترفض FOR UPDATE).
            $existingQuery = StorefrontDomain::withoutGlobalScope(TenantScope::class)->where('hostname', $target);
            $existing = ($execute ? $existingQuery->lockForUpdate() : $existingQuery)->first();

            if ($existing !== null) {
                if ($existing->tenant_id !== $s['tenant']->id
                    || $existing->storefront_id !== $s['storefront']->id
                    || $existing->type !== StorefrontDomain::TYPE_AWJ_SUBDOMAIN) {
                    throw new FlatHostBackfillException('target_taken', "الهدف {$target} مسجَّل لصفٍّ آخر — لا كتابة.");
                }
                // drift = أي اختلاف في ما يحسم الحسم فعلاً: التفعيل أو التوثيق عن المصدر
                // (نطاق نشط غير موثَّق يرفضه ResolveStorefrontDomain رغم `new_row_active=true`).
                $drift = (bool) $existing->is_active !== $desiredActive
                    || $existing->verification_status !== $s['domain']->verification_status
                    || (bool) $existing->is_primary; // كل هدف يُنتجه الـbackfill غير أساسي دائماً
                $hasDrift = $hasDrift || $drift;
                if ($drift && $execute) {
                    // all-or-nothing: أي drift يُرجع المعاملة كلها (لا يبقى إدراج سابق لمضيف آخر).
                    throw new FlatHostBackfillException('drift', "الهدف {$target} موجود بحالة تخالف المطلوب (تفعيل/توثيق) — لا كتابة، ويحتاج قراراً.");
                }
                $results[] = $this->result($host, $target, 'already_present', $desiredActive, $s, $drift ? 'drift' : null);

                continue;
            }

            if (Tenant::withTrashed()->where('slug', ManagedStorefrontHostname::labelOf($target, $base))->exists()) {
                throw new FlatHostBackfillException('target_is_tenant_slug', "الهدف {$target} محجوز لسلاج مستأجر.");
            }

            if ($execute) {
                try {
                    StorefrontDomain::withoutGlobalScope(TenantScope::class)->create([
                        'tenant_id' => $s['tenant']->id,
                        'storefront_id' => $s['storefront']->id,
                        'hostname' => $target,
                        'type' => StorefrontDomain::TYPE_AWJ_SUBDOMAIN,
                        'is_primary' => false,
                        'is_active' => $desiredActive,
                        'verification_status' => $s['domain']->verification_status,
                    ]);
                } catch (QueryException|\RuntimeException $e) {
                    throw new FlatHostBackfillException('constraint', "تعذّر إدراج {$target}: رفضته قيود القاعدة.");
                }
            }

            $results[] = $this->result($host, $target, $execute ? 'inserted' : 'would_insert', $desiredActive, $s);
        }

        return ['executed' => $execute, 'base_domain' => $base, 'results' => $results, 'has_drift' => $hasDrift];
    }

    /** @return array{domain: StorefrontDomain, storefront: Storefront, channel: SalesChannel, tenant: Tenant} */
    private function loadLegacy(string $host, string $base): array
    {
        $domain = StorefrontDomain::withoutGlobalScope(TenantScope::class)->where('hostname', $host)->first();
        if ($domain === null) {
            throw new FlatHostBackfillException('not_found', "المضيف {$host} غير موجود.");
        }
        if ($domain->type !== StorefrontDomain::TYPE_AWJ_SUBDOMAIN) {
            throw new FlatHostBackfillException('not_managed', "المضيف {$host} ليس نطاقاً مُداراً (لا يُمسّ).");
        }

        $storefront = Storefront::withoutGlobalScope(TenantScope::class)->withTrashed()->find($domain->storefront_id);
        $tenant = Tenant::withTrashed()->find($domain->tenant_id);
        if ($storefront === null || $tenant === null) {
            throw new FlatHostBackfillException('orphan', "المضيف {$host} بلا متجر/مستأجر صالح.");
        }
        $channel = SalesChannel::withoutGlobalScope(TenantScope::class)->withTrashed()->find($storefront->sales_channel_id);
        if ($channel === null) {
            throw new FlatHostBackfillException('orphan', "المضيف {$host} بلا قناة بيع.");
        }

        // عدم الانتقال بين المستأجرين: نطاق = متجر = قناة = مستأجر.
        if ($storefront->tenant_id !== $tenant->id || $channel->tenant_id !== $tenant->id) {
            throw new FlatHostBackfillException('tenant_mismatch', "المضيف {$host}: تعارض في ملكية المستأجر بين النطاق والمتجر والقناة.");
        }
        if ($host !== $storefront->slug.'.'.$tenant->slug.'.'.$base) {
            throw new FlatHostBackfillException('not_legacy_shape', "المضيف {$host} لا يطابق الصيغة {store}.{tenant}.{$base}.");
        }

        return compact('domain', 'storefront', 'channel', 'tenant');
    }

    /** @param array{domain: StorefrontDomain, storefront: Storefront, channel: SalesChannel, tenant: Tenant} $s */
    private function desiredActive(array $s): bool
    {
        // مستأجر معطَّل/محذوف ناعماً ⇒ لا مضيف جديد نشط (لا يصبح عاماً بشهادة صالحة).
        return (bool) $s['tenant']->is_active
            && $s['tenant']->deleted_at === null
            && (bool) $s['domain']->is_active
            && $s['domain']->isVerified()
            && (bool) $s['storefront']->is_active
            && $s['storefront']->deleted_at === null
            && (bool) $s['channel']->is_active
            && $s['channel']->deleted_at === null;
    }

    private function normalize(string $host): string
    {
        try {
            return HostnameNormalizer::normalize($host);
        } catch (InvalidHostnameException) {
            throw new FlatHostBackfillException('invalid_host', 'مضيف غير صالح.');
        }
    }

    /** @param array{tenant: Tenant, storefront: Storefront} $s */
    private function result(string $legacy, string $target, string $status, bool $active, array $s, ?string $flag = null): array
    {
        return [
            'legacy_host' => $legacy,
            'target_host' => $target,
            'status' => $status,
            'new_row_active' => $active,
            'tenant_id' => $s['tenant']->id,
            'storefront_id' => $s['storefront']->id,
            'flag' => $flag,
        ];
    }
}
