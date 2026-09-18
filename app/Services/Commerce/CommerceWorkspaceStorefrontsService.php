<?php

namespace App\Services\Commerce;

use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\StorefrontDomain;
use App\Services\Commerce\Edge\EdgeSnapshot;
use App\Services\Commerce\Edge\StorefrontEdgeClient;
use App\Support\HostnameNormalizer;
use App\Support\IcannRegistrableDomain;
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
    public function __construct(private readonly StorefrontEdgeClient $edge) {}

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

    /**
     * STORE-ADMIN-ADOPT-1B-3B / CUSTOM-DOMAIN-EDGE-3 — جعل نطاق مؤهل هو الأساسي.
     *
     * نطاق `custom`: لا يُوثَق بـ `edge_status = ready` المخزَّن. يُعاد سؤال
     * المزوّد حيّاً خارج قفل DB، ثم تُعاد التحققات المحلية داخل المعاملة قبل
     * `makePrimary()`. فشل النقل → 503 دون ترقية.
     * نطاق `awj_subdomain` موثَّق ونشط يُحوَّل عبر `StorefrontDomain::makePrimary()`
     * دون أي متطلب Railway.
     *
     * `null` = غير موجود / لا يخص هذا المستأجر أو هذا المتجر → 404 غير كاشف.
     *
     * @throws CustomDomainNotReadyForPrimaryException نطاق مخصَّص غير جاهز — 422.
     * @throws DomainNotEligibleForPrimaryException نطاق غير مؤهل — 422.
     * @throws StorefrontEdgeUnavailableException|StorefrontEdgeMisconfiguredException نقل المزوّد — 503.
     *
     * @return array{id: string, hostname: string, type: string, is_primary: bool, is_active: bool, verification_status: string, verification: array{method: string, record_name: string, record_value: string, verified_at: ?string}|null}|null
     */
    public function makePrimaryForCurrentTenant(string $storefrontId, string $domainId): ?array
    {
        $tenantId = app(TenantContext::class)->id();
        if ($tenantId === null) {
            throw new RuntimeException('لا سياق مستأجر نشط.');
        }

        $storefront = Storefront::query()->find($storefrontId);
        if ($storefront === null || $storefront->tenant_id !== $tenantId) {
            return null;
        }

        $inspection = DB::transaction(function () use ($storefront, $domainId, $tenantId) {
            $domain = $this->lockedDomainForStorefront($storefront->id, $domainId, $tenantId);
            if ($domain === null) {
                return ['kind' => 'missing'];
            }

            if ($domain->type !== StorefrontDomain::TYPE_CUSTOM) {
                if (! $domain->isVerified() || ! $domain->is_active) {
                    throw new DomainNotEligibleForPrimaryException(
                        'هذا النطاق غير مؤهل ليكون النطاق الأساسي.'
                    );
                }

                if (! $domain->is_primary) {
                    $domain->makePrimary();
                }

                return ['kind' => 'awj', 'presented' => $this->presentDomain($domain->refresh())];
            }

            if (! $domain->isVerified()) {
                throw new CustomDomainNotReadyForPrimaryException(
                    'لا يمكن جعل هذا النطاق أساسياً قبل اكتمال التحقّق وتفعيل HTTPS.'
                );
            }
            if (! $domain->is_active) {
                throw new DomainNotEligibleForPrimaryException(
                    'هذا النطاق غير مؤهل ليكون النطاق الأساسي.'
                );
            }

            $provider = is_string($domain->edge_provider) ? $domain->edge_provider : '';
            if ($provider !== '' && $provider !== 'railway') {
                throw new CustomDomainNotReadyForPrimaryException(
                    'تم التحقق من ملكية النطاق، لكن تفعيل HTTPS/النطاق لم يكتمل بعد.'
                );
            }

            $providerId = is_string($domain->edge_provider_id) && $domain->edge_provider_id !== ''
                ? $domain->edge_provider_id
                : null;

            return [
                'kind' => 'custom',
                'hostname' => $domain->hostname,
                'provider_id' => $providerId,
            ];
        });

        if (($inspection['kind'] ?? null) === 'missing') {
            return null;
        }
        if (($inspection['kind'] ?? null) === 'awj') {
            return $inspection['presented'];
        }

        $observation = $this->observeLiveCustomEdge(
            $inspection['hostname'],
            $inspection['provider_id'],
        );

        DB::transaction(function () use ($storefront, $domainId, $tenantId, $observation) {
            $domain = $this->lockedDomainForStorefront($storefront->id, $domainId, $tenantId);
            if ($domain === null) {
                return;
            }
            if ($domain->type !== StorefrontDomain::TYPE_CUSTOM) {
                return;
            }
            $applyId = $observation['provider_id'] ?? '';
            if ($applyId === '') {
                $applyId = is_string($domain->edge_provider_id) ? $domain->edge_provider_id : '';
            }
            $this->applyEdgeSnapshot($domain, $observation['snapshot'], $applyId);
        });

        return DB::transaction(function () use ($storefront, $domainId, $tenantId, $observation) {
            $domain = $this->lockedDomainForStorefront($storefront->id, $domainId, $tenantId);
            if ($domain === null) {
                return null;
            }

            if ($domain->type !== StorefrontDomain::TYPE_CUSTOM || ! $domain->isVerified() || ! $domain->is_active) {
                throw new CustomDomainNotReadyForPrimaryException(
                    'تم التحقق من ملكية النطاق، لكن تفعيل HTTPS/النطاق لم يكتمل بعد.'
                );
            }

            if (
                $observation['snapshot']->missing
                || $observation['provider_id'] === null
                || $observation['provider_id'] === ''
                || $domain->edge_status !== StorefrontDomain::EDGE_READY
            ) {
                throw new CustomDomainNotReadyForPrimaryException(
                    'تم التحقق من ملكية النطاق، لكن تفعيل HTTPS/النطاق لم يكتمل بعد.'
                );
            }

            if (! $domain->is_primary) {
                $domain->makePrimary();
            }

            return $this->presentDomain($domain->refresh());
        });
    }

    /**
     * STORE-ADMIN-ADOPT-1B-3B / CUSTOM-DOMAIN-EDGE-3 — فصل نطاق مخصَّص غير
     * أساسي. إطلاق المزوّد أولاً (أو تأكيد الغياب السلطوي عبر hostname داخل
     * خدمة المتجر المضبوطة)، ثم حذف الصف المحلي. فشل النقل يُبقي الصف.
     *
     * نطاق AWJ مُدار أو نطاق أساسي حالي → رفض فشلٍ مغلق قبل أي استدعاء مزوّد.
     *
     * `null` = غير موجود / لا يخص هذا المستأجر أو هذا المتجر → 404 غير كاشف.
     *
     * @throws DomainNotDisconnectableException نطاق غير قابل للفصل — 422.
     * @throws StorefrontEdgeUnavailableException|StorefrontEdgeMisconfiguredException نقل المزوّد — 503.
     */
    public function disconnectCustomDomainForCurrentTenant(string $storefrontId, string $domainId): ?bool
    {
        $tenantId = app(TenantContext::class)->id();
        if ($tenantId === null) {
            throw new RuntimeException('لا سياق مستأجر نشط.');
        }

        $storefront = Storefront::query()->find($storefrontId);
        if ($storefront === null || $storefront->tenant_id !== $tenantId) {
            return null;
        }

        $inspection = DB::transaction(function () use ($storefront, $domainId, $tenantId) {
            $domain = $this->lockedDomainForStorefront($storefront->id, $domainId, $tenantId);
            if ($domain === null) {
                return ['kind' => 'missing'];
            }

            if ($domain->type !== StorefrontDomain::TYPE_CUSTOM) {
                throw new DomainNotDisconnectableException(
                    'لا يمكن فصل نطاق مُدار من أَوْج.'
                );
            }

            if ($domain->is_primary) {
                throw new DomainNotDisconnectableException(
                    'لا يمكن فصل النطاق الأساسي الحالي — حوّل النطاق الأساسي أولاً.'
                );
            }

            return [
                'kind' => 'custom',
                'hostname' => $domain->hostname,
            ];
        });

        if (($inspection['kind'] ?? null) === 'missing') {
            return null;
        }

        $this->releaseCustomEdgeBinding($inspection['hostname']);

        return DB::transaction(function () use ($storefront, $domainId, $tenantId) {
            $domain = $this->lockedDomainForStorefront($storefront->id, $domainId, $tenantId);
            if ($domain === null) {
                return null;
            }

            if ($domain->type !== StorefrontDomain::TYPE_CUSTOM) {
                throw new DomainNotDisconnectableException(
                    'لا يمكن فصل نطاق مُدار من أَوْج.'
                );
            }

            if ($domain->is_primary) {
                throw new DomainNotDisconnectableException(
                    'لا يمكن فصل النطاق الأساسي الحالي — حوّل النطاق الأساسي أولاً.'
                );
            }

            $domain->delete();

            return true;
        });
    }

    /**
     * CUSTOM-DOMAIN-EDGE-1 — تسجيل نطاق مخصَّص موثَّق لدى Railway.
     * Make Primary يبقى مرفوضاً للنطاق المخصَّص في هذه الشريحة.
     *
     * @return array{id: string, hostname: string, type: string, is_primary: bool, is_active: bool, verification_status: string, verification: array{method: string, record_name: string, record_value: string, verified_at: ?string}|null, edge: ?array}|null
     */
    public function activateEdgeForCurrentTenant(string $storefrontId, string $domainId): ?array
    {
        $tenantId = app(TenantContext::class)->id();
        if ($tenantId === null) {
            throw new RuntimeException('لا سياق مستأجر نشط.');
        }

        $storefront = Storefront::query()->find($storefrontId);
        if ($storefront === null || $storefront->tenant_id !== $tenantId) {
            return null;
        }

        return DB::transaction(function () use ($storefront, $domainId, $tenantId) {
            $domain = $this->lockedDomainForStorefront($storefront->id, $domainId, $tenantId);
            if ($domain === null) {
                return null;
            }

            $this->assertEligibleForEdgeActivation($domain);

            if (is_string($domain->edge_provider_id) && $domain->edge_provider_id !== '') {
                $snapshot = $this->edge->fetch($domain->edge_provider_id);
                if (! $snapshot->missing) {
                    $this->applyEdgeSnapshot($domain, $snapshot, $domain->edge_provider_id);

                    return $this->presentDomain($domain->refresh());
                }
                // المزوّد حذف الكائن خارجياً — نُعيد الاكتشاف/الإنشاء بدل تجميد failed.
            }

            $existing = $this->edge->findByHostname($domain->hostname);
            if ($existing !== null) {
                $this->applyEdgeSnapshot($domain, $existing->snapshot, $existing->providerId);

                return $this->presentDomain($domain->refresh());
            }

            try {
                $binding = $this->edge->provision($domain->hostname);
            } catch (StorefrontEdgeConflictException $e) {
                $recovered = $this->edge->findByHostname($domain->hostname);
                if ($recovered === null) {
                    throw $e;
                }
                $this->applyEdgeSnapshot($domain, $recovered->snapshot, $recovered->providerId);

                return $this->presentDomain($domain->refresh());
            } catch (StorefrontEdgeUnavailableException $e) {
                $recovered = $this->edge->findByHostname($domain->hostname);
                if ($recovered === null) {
                    throw $e;
                }
                $this->applyEdgeSnapshot($domain, $recovered->snapshot, $recovered->providerId);

                return $this->presentDomain($domain->refresh());
            }

            $this->applyEdgeSnapshot($domain, $binding->snapshot, $binding->providerId);

            return $this->presentDomain($domain->refresh());
        });
    }

    /**
     * CUSTOM-DOMAIN-EDGE-1 — مزامنة حالة Railway إلى الصف.
     *
     * @return array{id: string, hostname: string, type: string, is_primary: bool, is_active: bool, verification_status: string, verification: array{method: string, record_name: string, record_value: string, verified_at: ?string}|null, edge: ?array}|null
     */
    public function refreshEdgeForCurrentTenant(string $storefrontId, string $domainId): ?array
    {
        $tenantId = app(TenantContext::class)->id();
        if ($tenantId === null) {
            throw new RuntimeException('لا سياق مستأجر نشط.');
        }

        $storefront = Storefront::query()->find($storefrontId);
        if ($storefront === null || $storefront->tenant_id !== $tenantId) {
            return null;
        }

        return DB::transaction(function () use ($storefront, $domainId, $tenantId) {
            $domain = $this->lockedDomainForStorefront($storefront->id, $domainId, $tenantId);
            if ($domain === null) {
                return null;
            }

            if ($domain->type !== StorefrontDomain::TYPE_CUSTOM) {
                throw new DomainNotEligibleForEdgeException(
                    'نطاقات أَوْج المُدارة لا تحتاج تفعيل حافة.'
                );
            }

            $providerId = is_string($domain->edge_provider_id) && $domain->edge_provider_id !== ''
                ? $domain->edge_provider_id
                : null;

            if ($providerId === null) {
                $existing = $this->edge->findByHostname($domain->hostname);
                if ($existing === null) {
                    throw new DomainNotActivatedForEdgeException(
                        'هذا النطاق لم يُفعَّل لدى مزوّد الحافة بعد.'
                    );
                }
                $this->applyEdgeSnapshot($domain, $existing->snapshot, $existing->providerId);

                return $this->presentDomain($domain->refresh());
            }

            $snapshot = $this->edge->fetch($providerId);
            $this->applyEdgeSnapshot($domain, $snapshot, $providerId);

            return $this->presentDomain($domain->refresh());
        });
    }

    private function assertEligibleForEdgeActivation(StorefrontDomain $domain): void
    {
        if ($domain->type !== StorefrontDomain::TYPE_CUSTOM) {
            throw new DomainNotEligibleForEdgeException(
                'نطاقات أَوْج المُدارة لا تحتاج تفعيل حافة.'
            );
        }
        if (! $domain->isVerified() || ! $domain->is_active) {
            throw new DomainNotEligibleForEdgeException(
                'لا يمكن تفعيل الحافة قبل اكتمال تحقّق ملكية النطاق.'
            );
        }
        if (! IcannRegistrableDomain::isSubdomain($domain->hostname)) {
            throw new DomainNotEligibleForEdgeException(
                'تفعيل النطاق الجذري غير مدعوم في هذه المرحلة — استخدم نطاقاً فرعياً مثل shop.example.com.'
            );
        }

        $base = ManagedStorefrontHostname::configuredBaseDomain();
        if ($domain->hostname === $base || ManagedStorefrontHostname::isUnderBaseDomain($domain->hostname, $base)) {
            throw new DomainNotEligibleForEdgeException(
                'لا يمكن تفعيل نطاق يقع ضمن نطاق أَوْج المُدار.'
            );
        }
    }

    private function applyEdgeSnapshot(StorefrontDomain $domain, EdgeSnapshot $snapshot, string $providerId): void
    {
        $status = $snapshot->missing ? StorefrontDomain::EDGE_FAILED : $snapshot->status;
        $readyAt = $domain->edge_ready_at;
        if ($status === StorefrontDomain::EDGE_READY && $readyAt === null) {
            $readyAt = now();
        }
        if ($status !== StorefrontDomain::EDGE_READY) {
            // Keep first ready_at as historical cache; EDGE-3 re-queries live cert.
        }

        $domain->forceFill([
            'edge_status' => $status,
            'edge_provider' => 'railway',
            'edge_provider_id' => $snapshot->missing ? $domain->edge_provider_id : $providerId,
            'edge_dns_instructions' => ['records' => $snapshot->instructionPayload()],
            'edge_last_error' => $snapshot->lastError,
            'edge_checked_at' => now(),
            'edge_ready_at' => $readyAt,
        ])->save();
    }

    /**
     * TOCTOU: استعلام المزوّد خارج قفل DB. لا يُنشئ موارد. يوفّق بالمعرّف
     * المخزَّن ثم بالـ hostname داخل خدمة المتجر المضبوطة فقط.
     *
     * @return array{provider_id: ?string, snapshot: EdgeSnapshot}
     */
    private function observeLiveCustomEdge(string $hostname, ?string $providerId): array
    {
        if (is_string($providerId) && $providerId !== '') {
            $snapshot = $this->edge->fetch($providerId);
            if (! $snapshot->missing) {
                return ['provider_id' => $providerId, 'snapshot' => $snapshot];
            }
        }

        $existing = $this->edge->findByHostname($hostname);
        if ($existing !== null) {
            return ['provider_id' => $existing->providerId, 'snapshot' => $existing->snapshot];
        }

        return [
            'provider_id' => null,
            'snapshot' => new EdgeSnapshot(
                EdgeSnapshot::STATUS_FAILED,
                [],
                'لم يعد نطاق الحافة موجوداً لدى المزوّد.',
                true,
            ),
        ];
    }

    /**
     * إطلاق ربط الحافة قبل الحذف المحلي. المصالحة بالـ hostname داخل خدمة
     * المتجر فقط — لا يُحذف كائن مزوّد لا يطابق hostname هذا الصف.
     */
    private function releaseCustomEdgeBinding(string $hostname): void
    {
        $existing = $this->edge->findByHostname($hostname);
        if ($existing === null) {
            return;
        }

        $this->edge->release($existing->providerId);
    }

    /**
     * يقفل كل نطاقات المتجر (مرتَّبة بالمعرّف لتفادي deadlock) ثم يعيد الصف
     * المطلوب إن كان مملوكاً للمستأجر الحالي. قفل المجموعة يجعل Make Primary
     * وDisconnect متسلسلَين على نفس المتجر دون معمارية قفل جديدة.
     */
    private function lockedDomainForStorefront(string $storefrontId, string $domainId, string $tenantId): ?StorefrontDomain
    {
        $locked = StorefrontDomain::query()
            ->where('storefront_id', $storefrontId)
            ->orderBy('id')
            ->lockForUpdate()
            ->get();

        $domain = $locked->firstWhere('id', $domainId);
        if ($domain === null || $domain->tenant_id !== $tenantId) {
            return null;
        }

        return $domain;
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
     * CUSTOM-DOMAIN-EDGE-1: `edge` إضافي بحت. `null` لنطاق AWJ المُدار.
     * للنطاق المخصَّص يُعرض الوضع/تعليمات DNS/الأزمنة/خطأ آمن فقط — بلا
     * `edge_provider_id` ولا أسرار Railway.
     *
     * @return array{id: string, hostname: string, type: string, is_primary: bool, is_active: bool, verification_status: string, verification: array{method: string, record_name: string, record_value: string, verified_at: ?string}|null, edge: ?array{status: string, dns_instructions: array{records: list<array{type: string, name: string, value: string}>}, checked_at: ?string, ready_at: ?string, last_error: ?string}}
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
            'edge' => $this->presentEdge($domain),
        ];
    }

    /**
     * @return array{status: string, dns_instructions: array{records: list<array{type: string, name: string, value: string}>}, checked_at: ?string, ready_at: ?string, last_error: ?string}|null
     */
    private function presentEdge(StorefrontDomain $domain): ?array
    {
        if ($domain->type !== StorefrontDomain::TYPE_CUSTOM) {
            return null;
        }

        $instructions = $domain->edge_dns_instructions;
        $records = [];
        if (is_array($instructions) && isset($instructions['records']) && is_array($instructions['records'])) {
            foreach ($instructions['records'] as $record) {
                if (! is_array($record)) {
                    continue;
                }
                $type = (string) ($record['type'] ?? '');
                $name = (string) ($record['name'] ?? '');
                $value = (string) ($record['value'] ?? '');
                if ($type === '' || $name === '' || $value === '') {
                    continue;
                }
                $records[] = ['type' => $type, 'name' => $name, 'value' => $value];
            }
        }

        return [
            'status' => is_string($domain->edge_status) && $domain->edge_status !== ''
                ? $domain->edge_status
                : StorefrontDomain::EDGE_NONE,
            'dns_instructions' => ['records' => $records],
            'checked_at' => $domain->edge_checked_at?->toIso8601String(),
            'ready_at' => $domain->edge_ready_at?->toIso8601String(),
            'last_error' => $domain->edge_last_error,
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
