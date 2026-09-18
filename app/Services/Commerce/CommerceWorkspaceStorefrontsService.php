<?php

namespace App\Services\Commerce;

use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\StorefrontDomain;
use App\Support\HostnameNormalizer;
use App\Support\InvalidHostnameException;
use App\Support\ManagedStorefrontHostname;
use App\Tenancy\TenantContext;
use App\Tenancy\TenantScope;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
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

    /**
     * STORE-ADMIN-ADOPT-1B-2 — رؤية نطاقات متجر قائم (قراءة فقط).
     *
     * نفس نمط `updateIdentityForCurrentTenant()` حرفياً: يُحلّ المتجر عبر
     * `Storefront::query()` (يخضع لـ`TenantScope` أصلاً) ثم يُعاد التحقق
     * صراحةً من `tenant_id === TenantContext::id()` — دفاع متعدد الطبقات.
     * صفٌّ غير موجود أو يخصّ مستأجراً آخر يُترجَم دوماً إلى `null` (404 لا
     * 403 على مستوى المتحكم) — لا تسريب وجود. النطاقات تُقرأ بعدها عبر
     * علاقة `storefront->domains()` فلا حاجة لفحص ملكية إضافي على كل صفّ
     * نطاق (هي أصلاً محصورة بالمتجر المتحقَّق من ملكيته أعلاه).
     *
     * @return list<array{id: string, hostname: string, type: string, is_primary: bool, is_active: bool, verification_status: string}>|null
     */
    public function listDomainsForCurrentTenant(string $storefrontId): ?array
    {
        $tenantId = app(TenantContext::class)->id();
        if ($tenantId === null) {
            throw new RuntimeException('لا سياق مستأجر نشط.');
        }

        $storefront = Storefront::query()->find($storefrontId);
        if ($storefront === null || $storefront->tenant_id !== $tenantId) {
            return null;
        }

        $domains = $storefront->domains()
            ->orderByDesc('is_primary')
            ->orderBy('hostname')
            ->get();

        return $domains
            ->filter(fn (StorefrontDomain $domain) => $domain->tenant_id === $tenantId)
            ->map(fn (StorefrontDomain $domain) => $this->presentDomain($domain))
            ->values()
            ->all();
    }

    /**
     * STORE-ADMIN-ADOPT-1B-3A — إضافة نطاق مخصَّص (`custom`) لمتجر قائم
     * يخصّ المستأجر الحالي، وبدء تحقّق DNS TXT (لا يُثبَّت `verified` هنا
     * أبداً — يبدأ `pending` دوماً، القرار §10).
     *
     * تسلسل الفحص مطابقٌ للتذكرة حرفياً: ملكية المتجر (404 لا كاشف) →
     * تطبيع/تحقّق hostname عبر `HostnameNormalizer::normalize()` حصراً →
     * حماية نطاق AWJ المُدار → فحص تفرّد عالمي (طبقة تطبيق UX + قفل صفّ داخل
     * معاملة → قيد `unique(hostname)` كسلطة نهائية ضد السباق، القرار §15).
     *
     * @throws InvalidHostnameException hostname غير صالح تركيبياً — 422.
     * @throws ManagedNamespaceHostnameException hostname ضمن نطاق AWJ المُدار — 422.
     * @throws StorefrontHostnameConflictException hostname مستخدم بالفعل (فحص مسبق أو سباق DB) — 409.
     *
     * @return array{id: string, hostname: string, type: string, is_primary: bool, is_active: bool, verification_status: string, verification: array{method: string, record_name: string, record_value: string, verified_at: ?string}|null}|null
     */
    public function addCustomDomainForCurrentTenant(string $storefrontId, string $rawHostname): ?array
    {
        $tenantId = app(TenantContext::class)->id();
        if ($tenantId === null) {
            throw new RuntimeException('لا سياق مستأجر نشط.');
        }

        $storefront = Storefront::query()->find($storefrontId);
        if ($storefront === null || $storefront->tenant_id !== $tenantId) {
            return null;
        }

        // يرمي InvalidHostnameException مباشرة — لا تقاط هنا، المتحكّم يحوّلها 422.
        $hostname = HostnameNormalizer::normalize($rawHostname);

        $baseDomain = ManagedStorefrontHostname::configuredBaseDomain();
        if ($hostname === $baseDomain || ManagedStorefrontHostname::isUnderBaseDomain($hostname, $baseDomain)) {
            throw new ManagedNamespaceHostnameException(
                'هذا الاسم ضمن نطاق أَوْج المُدار للمتاجر — لا يمكن إضافته كنطاق مخصَّص.'
            );
        }

        // طبقة تطبيق (UX أسرع، ليست السلطة النهائية) — نفس فحص `RegisterStorefrontDomainCommand`.
        if (StorefrontDomain::withoutGlobalScope(TenantScope::class)->where('hostname', $hostname)->exists()) {
            throw new StorefrontHostnameConflictException('اسم النطاق مستخدم بالفعل.');
        }

        $token = StorefrontDomainVerificationService::generateToken();

        try {
            $domain = DB::transaction(function () use ($storefront, $hostname, $token) {
                // نقطة تسلسل داخل المعاملة (بنفس نمط `StorefrontProvisioningService::ensureManagedDomain()`):
                // تمنع أغلب حالات السباق مبكراً، لكنها ليست السلطة النهائية
                // وحدها — إدراجان متزامنان حقيقيان بلا صفّ سابق أصلاً يتجاوزانها
                // معاً؛ القيد الفريد على `hostname` (خارج هذه المعاملة، في
                // catch أدناه) هو ما يحسم فعلياً حينها.
                $existing = StorefrontDomain::withoutGlobalScope(TenantScope::class)
                    ->where('hostname', $hostname)
                    ->lockForUpdate()
                    ->first();

                if ($existing !== null) {
                    throw new StorefrontHostnameConflictException('اسم النطاق مستخدم بالفعل.');
                }

                return StorefrontDomain::create([
                    'storefront_id' => $storefront->id,
                    'hostname' => $hostname,
                    'type' => StorefrontDomain::TYPE_CUSTOM,
                    'is_primary' => false,
                    'is_active' => true,
                    'verification_status' => StorefrontDomain::VERIFICATION_PENDING,
                    'verification_token' => $token,
                ]);
            });
        } catch (QueryException $e) {
            // القيد الفريد `storefront_domains.hostname` هو السلطة النهائية —
            // انظر تعليق أعلاه. يُلتقَط **خارج** `DB::transaction()` عمداً
            // (نفس نمط `InventoryReservationService::acquire()`): الالتقاط
            // داخلها يترك معاملة PostgreSQL «مُجهَضة» فتفشل أي قراءة تالية
            // بلا فائدة.
            if (! $this->isUniqueHostnameViolation($e)) {
                throw $e;
            }

            throw new StorefrontHostnameConflictException('اسم النطاق مستخدم بالفعل.');
        }

        return $this->presentDomain($domain);
    }

    /**
     * STORE-ADMIN-ADOPT-1B-3A — تشغيل تحقّق DNS TXT فعلي لنطاق مخصَّص قائم
     * يخصّ المستأجر الحالي والمتجر المحدَّد في المسار. مثاليّ التكرار: نطاق
     * `verified` بالفعل يُعاد حالته الحالية دون أي أثر جانبي (لا إعادة توليد
     * token، لا تغيير `verified_at`، لا استعلام DNS إضافي — القرار §25).
     *
     * `null` يعني «غير موجود/لا يخصّ هذا المستأجر أو هذا المتجر» (404 غير
     * كاشف) — نفس دلالة بقية طرق هذه الخدمة.
     *
     * @throws DomainNotEligibleForVerificationException النطاق ليس `custom` (مثال: `awj_subdomain`) — 422.
     * @throws \App\Support\Dns\DnsOperationalException فشل تشغيلي في استعلام DNS — 503 قابل لإعادة المحاولة.
     *
     * @return array{id: string, hostname: string, type: string, is_primary: bool, is_active: bool, verification_status: string, verification: array{method: string, record_name: string, record_value: string, verified_at: ?string}|null}|null
     */
    public function verifyCustomDomainForCurrentTenant(
        string $storefrontId,
        string $domainId,
        StorefrontDomainVerificationService $verifier,
    ): ?array {
        $tenantId = app(TenantContext::class)->id();
        if ($tenantId === null) {
            throw new RuntimeException('لا سياق مستأجر نشط.');
        }

        $storefront = Storefront::query()->find($storefrontId);
        if ($storefront === null || $storefront->tenant_id !== $tenantId) {
            return null;
        }

        $domain = StorefrontDomain::query()->find($domainId);
        if (
            $domain === null
            || $domain->tenant_id !== $tenantId
            || $domain->storefront_id !== $storefront->id
        ) {
            return null;
        }

        if ($domain->type !== StorefrontDomain::TYPE_CUSTOM) {
            throw new DomainNotEligibleForVerificationException(
                'هذا النطاق مُدار من أَوْج — لا يخضع لتحقّق DNS TXT الخاص بالنطاقات المخصَّصة.'
            );
        }

        // مثالي التكرار (القرار §25/§26): نطاق مُتحقَّق بالفعل لا يُعاد فحصه
        // DNS إطلاقاً — يعيد حالته الحالية فقط، فتبقى `verified_at` الأصلية
        // ولا يُستهلَك أي استعلام DNS إضافي بلا فائدة.
        if ($domain->isVerified()) {
            return $this->presentDomain($domain);
        }

        $result = $verifier->verify($domain);

        if ($result->operationalFailure) {
            throw new \App\Support\Dns\DnsOperationalException(
                'تعذّر التحقق من سجلات DNS حالياً — حاول مرة أخرى لاحقاً.'
            );
        }

        // إثبات ملكية ناجحٌ بالضبط: `verified` + `verified_at` خادمياً فقط.
        // إثبات غائب/غير مطابق: نُسجّل `failed` صراحةً (تمييز عن `pending`
        // الأولي — الطلب جرى فعلاً ولم ينجح) بلا مسّ `verification_token`،
        // فتبقى «تحقّق الآن» قابلة لإعادة المحاولة بلا حاجة لتوليد token جديد
        // (القرار §23-A/§27). لا `verified_at` تُكتب في هذا الفرع أبداً.
        $domain->forceFill([
            'verification_status' => $result->matched
                ? StorefrontDomain::VERIFICATION_VERIFIED
                : StorefrontDomain::VERIFICATION_FAILED,
            'verified_at' => $result->matched ? now() : $domain->verified_at,
        ])->save();

        return $this->presentDomain($domain->refresh());
    }

    private function isUniqueHostnameViolation(QueryException $e): bool
    {
        $sqlState = $e->errorInfo[0] ?? null;
        $driverCode = $e->errorInfo[1] ?? null;

        // PostgreSQL unique_violation = 23505 · SQLite constraint = 19
        return $sqlState === '23505' || $driverCode === 19 || str_contains(strtolower($e->getMessage()), 'unique');
    }

    /**
     * التمثيل الموحَّد لصفّ `StorefrontDomain` عبر القراءة (`listDomainsForCurrentTenant`)
     * والكتابة (`addCustomDomainForCurrentTenant`/`verifyCustomDomainForCurrentTenant`)
     * — حقل `verification` إضافيّ بحت فوق حقول 1B-2 الستة القائمة (لا حذف/
     * إعادة تسمية لأيٍّ منها، القرار §32). يظهر فقط لنطاق `custom` يحمل
     * `verification_token` فعلياً (كل نطاق `custom` أُنشئ عبر هذا المسار
     * يحمله دوماً)؛ `null` للنطاق المُدار من أَوْج أو أي صفّ تاريخي بلا token.
     *
     * @return array{id: string, hostname: string, type: string, is_primary: bool, is_active: bool, verification_status: string, verification: array{method: string, record_name: string, record_value: string, verified_at: ?string}|null}
     */
    private function presentDomain(StorefrontDomain $domain): array
    {
        $verification = null;
        if ($domain->type === StorefrontDomain::TYPE_CUSTOM && $domain->verification_token !== null) {
            $verification = [
                'method' => 'dns_txt',
                'record_name' => StorefrontDomainVerificationService::recordNameFor($domain->hostname),
                'record_value' => StorefrontDomainVerificationService::expectedValueFor($domain->verification_token),
                'verified_at' => $domain->verified_at?->toIso8601String(),
            ];
        }

        return [
            'id' => $domain->id,
            'hostname' => $domain->hostname,
            'type' => $domain->type,
            'is_primary' => $domain->is_primary,
            'is_active' => $domain->is_active,
            'verification_status' => $domain->verification_status,
            'verification' => $verification,
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
