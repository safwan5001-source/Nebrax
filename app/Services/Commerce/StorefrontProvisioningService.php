<?php

namespace App\Services\Commerce;

use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\StorefrontDomain;
use App\Models\Tenant;
use App\Support\ManagedStorefrontHostname;
use App\Support\StorefrontBaseDomainMisconfiguredException;
use App\Tenancy\TenantContext;
use App\Tenancy\TenantScope;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * COM-STORE-PROVISION-1 — تزويد أول متجر إلكتروني صريح لمستأجر.
 *
 * يُنشئ/يقارِب سلسلة الملكية الدنيا: قناة بيع `web` نشطة → `Storefront` →
 * `StorefrontDomain` مُدار من AWJ (`awj_subdomain`) نشطٌ وموثَّقٌ فوراً.
 *
 * **مبدأ الثقة الوحيد**: هوية المستأجر تأتي حصراً من `TenantContext` النشط
 * (وحده ما ضبطه `SetTenant` من مستخدم مصادَق) — لا معرّف مستأجر/قناة/متجر/نطاق
 * وارد من العميل في أي مكان هنا. hostname يُبنى حصراً عبر
 * `ManagedStorefrontHostname::forSlug()` من `tenants.slug` الموثوق + الإعداد
 * المُهيَّأ — لا نص عميل يُقبل كـhostname إطلاقاً.
 *
 * **تزويد صريح فقط**: تُستدعى هذه الخدمة فقط من مسار `POST` مخصَّص يستدعيه
 * مستخدمٌ مخوَّل — لا استدعاء تلقائي عند تسجيل الدخول أو تحميل لوحة التحكم أو
 * أي قراءة GET (يطابق قرار المنتج الصريح في التذكرة).
 *
 * **التقارب لا الاستنساخ**: إعادة الاستدعاء لنفس المستأجر يُقارِب إلى نفس
 * الرسم البياني (قناة/متجر/نطاق واحد) بدل تكراره — بنفس روح
 * `RegisterStorefrontDomainCommand`/`EnsureWebSalesChannelCommand` القائمين،
 * دون استدعائهما (كلاهما أمر CLI تشغيلي بتأكيد تفاعلي بشري، لا واجهة برمجية
 * آمنة للتشغيل الذاتي عبر HTTP). أي غموض (أكثر من قناة/متجر نشط مرشَّح، أو
 * حالة موجودة غير متوافقة) يفشل **مغلقاً** بلا أي كتابة.
 *
 * **قفل تسلسلي**: يقفل صفّ `tenants` (نفس نمط `GeneratesDocumentNumbers`
 * المرجعي في CLAUDE.md) كمرساة تسلسل لكامل عملية التزويد — طلبان متزامنان لنفس
 * المستأجر يتسلسلان فعلياً، فالثاني يرى دائماً ما التزمه الأول ويقارِب إليه
 * بدل تكراره.
 */
final class StorefrontProvisioningService
{
    private const CHANNEL_SLUG = 'web';

    private const STOREFRONT_SLUG = 'main';

    /**
     * @return array{id: string, name: string, sales_channel_id: string, is_active: bool, preview_url: string, default_locale: string, created: bool}
     */
    public function provisionFirstStorefrontForCurrentTenant(?string $displayName = null): array
    {
        $tenantId = app(TenantContext::class)->id();
        if ($tenantId === null) {
            throw new RuntimeException('لا سياق مستأجر نشط.');
        }

        // يُحسب **قبل** فتح المعاملة: إعداد ناقص/غير صالح يجب ألا يفتح
        // معاملة ولا يقفل أي صفّ — فشلٌ مغلق مبكرٌ بلا أي أثر جزئي.
        $baseDomain = ManagedStorefrontHostname::configuredBaseDomain();

        return DB::transaction(function () use ($tenantId, $baseDomain, $displayName) {
            // مرساة التسلسل: يقفل صفّ المستأجر نفسه، فطلبا تزويدٍ متزامنان
            // لنفس المستأجر يتسلسلان — الثاني يرى دوماً ما التزمه الأول.
            $tenant = Tenant::whereKey($tenantId)->lockForUpdate()->first();
            if ($tenant === null) {
                throw new RuntimeException('المستأجر غير موجود.');
            }

            $hostname = ManagedStorefrontHostname::forSlug($tenant->slug, $baseDomain);

            $channel = $this->ensureWebSalesChannel($tenant);
            $storefront = $this->ensureStorefront($channel, $tenant, $displayName);
            $domain = $this->ensureManagedDomain($storefront, $tenantId, $hostname);

            return [
                'id' => $storefront->id,
                'name' => $storefront->name,
                'sales_channel_id' => $channel->id,
                'is_active' => (bool) $storefront->is_active,
                'preview_url' => 'https://'.$domain->hostname.'/',
                'default_locale' => $storefront->default_locale,
                'created' => (bool) $domain->wasRecentlyCreated,
            ];
        });
    }

    /**
     * يضمن قناة بيع `web` نشطة واحدة — بنفس دلالات `sales-channel:ensure-web`
     * (فشلٌ مغلق عند الغموض)، لكن كمنطق خدمة قابل للاستدعاء من HTTP مباشرة.
     * لا أمر Artisan يُستدعى هنا (CLAUDE.md/التذكرة تمنعان استدعاء أوامر من كود
     * HTTP)؛ ولا خدمة قائمة قابلة لإعادة الاستعمال كانت موجودة قبل هذا الملف
     * (المنطق عاش فقط داخل صنف الأمر) — فهذا أصغر امتداد ضروري، لا تكرارٌ
     * زائد عن حاجة.
     */
    private function ensureWebSalesChannel(Tenant $tenant): SalesChannel
    {
        $activeWeb = SalesChannel::query()
            ->where('type', SalesChannel::TYPE_WEB)
            ->where('is_active', true)
            ->lockForUpdate()
            ->get();

        if ($activeWeb->count() > 1) {
            throw new RuntimeException('يوجد أكثر من قناة بيع web نشطة لهذا المستأجر — لا يمكن تحديد المتجر المقصود تلقائياً.');
        }

        if ($activeWeb->count() === 1) {
            return $activeWeb->first();
        }

        $occupant = SalesChannel::query()
            ->withTrashed()
            ->where('slug', self::CHANNEL_SLUG)
            ->lockForUpdate()
            ->first();

        if ($occupant !== null) {
            if ($occupant->trashed()) {
                throw new RuntimeException('السلاج «web» محجوز بقناة محذوفة سابقاً — يحتاج مراجعة تشغيلية يدوية.');
            }

            if ($occupant->type !== SalesChannel::TYPE_WEB || ! $occupant->is_active) {
                throw new RuntimeException('توجد قناة بيع بالسلاج «web» غير متوافقة أو غير نشطة — يحتاج مراجعة تشغيلية يدوية قبل إنشاء متجر.');
            }

            // withTrashed()+lockForUpdate أعلاه لم يلتقطها ضمن $activeWeb (نفس
            // الاستعلام بلا withTrashed) لو كانت من نوع آخر — لكن لو وصلنا هنا
            // فهي فعلاً web+نشطة، أي حالة سباق نادرة بين الاستعلامين ضمن نفس
            // القفل؛ نعيدها مباشرة بدل استثناء زائف.
            return $occupant;
        }

        return SalesChannel::create([
            'tenant_id' => $tenant->id,
            'slug' => self::CHANNEL_SLUG,
            'name' => 'المتجر الإلكتروني',
            'type' => SalesChannel::TYPE_WEB,
            'is_active' => true,
        ]);
    }

    /**
     * يضمن `Storefront` واحداً مرتبطاً بقناة `web` — يقارِب حالة قائمة متوافقة
     * (يعيد تفعيلها إن كانت معطّلة، بنفس سلوك `RegisterStorefrontDomainCommand`
     * تماماً)، ولا يُنشئ ثانياً أبداً، ويفشل مغلقاً عند تعدّد غامض.
     */
    private function ensureStorefront(SalesChannel $channel, Tenant $tenant, ?string $displayName): Storefront
    {
        $existing = Storefront::query()
            ->where('sales_channel_id', $channel->id)
            ->lockForUpdate()
            ->get();

        if ($existing->count() > 1) {
            throw new RuntimeException('يوجد أكثر من متجر واحد مرتبط بقناة البيع web لهذا المستأجر — لا يمكن التقارب تلقائياً.');
        }

        if ($existing->count() === 1) {
            $storefront = $existing->first();
            if (! $storefront->is_active) {
                $storefront->update(['is_active' => true]);
            }

            return $storefront;
        }

        $slugOccupant = Storefront::withTrashed()
            ->where('slug', self::STOREFRONT_SLUG)
            ->lockForUpdate()
            ->first();

        if ($slugOccupant !== null) {
            if ($slugOccupant->trashed()) {
                throw new RuntimeException('سلاج المتجر «main» محجوز بمتجر محذوف سابقاً — يحتاج مراجعة تشغيلية يدوية.');
            }

            if ($slugOccupant->sales_channel_id !== $channel->id) {
                throw new RuntimeException('سلاج المتجر «main» محجوز بمتجر مرتبط بقناة بيع أخرى — يحتاج مراجعة تشغيلية يدوية.');
            }

            return $slugOccupant;
        }

        $name = $displayName !== null && trim($displayName) !== ''
            ? trim($displayName)
            : ($tenant->name ?: 'المتجر الإلكتروني');

        return Storefront::create([
            'sales_channel_id' => $channel->id,
            'slug' => self::STOREFRONT_SLUG,
            'name' => $name,
            'is_active' => true,
            'default_locale' => 'ar',
        ]);
    }

    /**
     * يضمن `StorefrontDomain` مُدار من AWJ (`awj_subdomain`) نشطٌ وموثَّقٌ
     * فوراً — **حصراً** لأن هذا الـhostname وُلِّد خادمياً من سلاج المستأجر
     * الموثوق + النطاق الأساسي المُهيَّأ (`AWJ_STOREFRONT_BASE_DOMAIN`)، وهذه
     * الخدمة وحدها من تستدعي `ManagedStorefrontHostname::forSlug()` وتمرّر
     * `TYPE_AWJ_SUBDOMAIN` — لا مسار آخر في المستودع يُثبت `verified` تلقائياً
     * بلا مراجعة تشغيلية، ونطاقات `TYPE_CUSTOM` (المملوكة للتاجر) تبقى خارج
     * هذا المسار كلياً وبلا أي تغيير لسلوكها الحالي.
     */
    private function ensureManagedDomain(Storefront $storefront, string $tenantId, string $hostname): StorefrontDomain
    {
        $existing = StorefrontDomain::withoutGlobalScope(TenantScope::class)
            ->where('hostname', $hostname)
            ->lockForUpdate()
            ->first();

        if ($existing !== null) {
            if ($existing->tenant_id !== $tenantId) {
                throw new StorefrontHostnameConflictException(
                    'اسم النطاق المولَّد لهذا المستأجر مسجَّلٌ بالفعل لمستأجر آخر — هذا لا ينبغي أن يحدث في التشغيل الطبيعي ويحتاج مراجعة عاجلة.'
                );
            }

            if ($existing->storefront_id !== $storefront->id) {
                throw new StorefrontHostnameConflictException(
                    'اسم النطاق المولَّد مرتبطٌ بمتجر آخر لنفس المستأجر — يحتاج مراجعة تشغيلية يدوية.'
                );
            }

            if ($existing->type !== StorefrontDomain::TYPE_AWJ_SUBDOMAIN) {
                throw new StorefrontHostnameConflictException(
                    'اسم النطاق مسجَّلٌ يدوياً بنوع مختلف (نطاق مخصَّص) — لا يُعاد تصنيفه تلقائياً؛ يحتاج قراراً تشغيلياً صريحاً.'
                );
            }

            if (! $existing->is_active || ! $existing->isVerified()) {
                $existing->update([
                    'is_active' => true,
                    'verification_status' => StorefrontDomain::VERIFICATION_VERIFIED,
                ]);
            }

            return $existing;
        }

        $hasActivePrimary = StorefrontDomain::query()
            ->where('storefront_id', $storefront->id)
            ->where('is_primary', true)
            ->where('is_active', true)
            ->exists();

        return StorefrontDomain::create([
            'storefront_id' => $storefront->id,
            'hostname' => $hostname,
            'type' => StorefrontDomain::TYPE_AWJ_SUBDOMAIN,
            'is_primary' => ! $hasActivePrimary,
            'is_active' => true,
            'verification_status' => StorefrontDomain::VERIFICATION_VERIFIED,
        ]);
    }
}
