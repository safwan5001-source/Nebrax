<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use App\Tenancy\TenantContext;
use App\Tenancy\TenantScope;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;
use RuntimeException;

/**
 * متجر Commerce مستضاف (COM-7-P2A) — كيانٌ tenant-owned منفصل عن
 * `SalesChannel` (AWJ_COM_7_P2_STOREFRONT_DOMAIN_RESOLUTION_DECISION.md
 * §1-2). القناة تبقى مصدر البيع التجاري؛ هذا النموذج يمثّل واجهة المتجر
 * المستضافة ونطاقاتها ولغتها الافتراضية فقط — لا علامة تجارية ولا قالب ولا
 * SEO هنا (أعمدة عمل Store Configuration/Design لاحقة، خارج هذا الجدول
 * صراحةً، §2).
 *
 * **`CompanyWide`**: تهيئة مستوى المؤسسة كـ`SalesChannel` نفسه — لا فرعاً
 * بعينه؛ متجرٌ واحد قد يخدم كل فروع المؤسسة.
 *
 * **لا ثقة بمعرّف قناة وارد وحده**: `booted()` يتحقق صراحةً (بتجاوز واعٍ
 * ومعلَّق لـ`TenantScope` لقراءة `tenant_id` الحقيقي للقناة أياً كان المستأجر
 * النشط حالياً) أن القناة المرجوّة تخصّ نفس مستأجر هذا المتجر ومن نوع `web`
 * — بنيوياً عبر `saving()`، لا فقط عبر قيد FK الذي يثبت الوجود لا الملكية،
 * وبلا اعتماد على خدمة وسيطة قد يُنسى استدعاؤها.
 */
class Storefront extends BaseModel implements CompanyWide
{
    use SoftDeletes;

    protected $fillable = [
        'tenant_id', 'sales_channel_id', 'slug', 'name', 'is_active', 'default_locale',
    ];

    protected $casts = [
        'is_active' => 'boolean',
    ];

    protected $attributes = [
        'is_active' => true,
        'default_locale' => 'ar',
    ];

    protected static function booted(): void
    {
        static::saving(function (self $storefront) {
            if ($storefront->sales_channel_id === null) {
                return;
            }

            // عند الإنشاء: `tenant_id` قد لا يكون مملوءاً بعد — تعبئته التلقائية
            // في `BelongsToTenant::bootBelongsToTenant()` تُسجَّل على حدث
            // `creating` نفسه، وترتيب الاستماعين بين السمات و`booted()` غير
            // مضمونٍ سابقاً لهذا الوسيط دائماً. نقرأ من `TenantContext` مباشرةً
            // حين يكون العمود ما يزال فارغاً — المصدر ذاته الذي ستُملأ منه على
            // أي حال، فلا اختلاف في النتيجة، فقط ضمان ترتيب صحيح.
            $tenantId = $storefront->tenant_id ?? app(TenantContext::class)->id();
            if ($tenantId === null) {
                return;
            }

            $channel = SalesChannel::withoutGlobalScope(TenantScope::class)
                ->select(['id', 'tenant_id', 'type'])
                ->find($storefront->sales_channel_id);

            if ($channel === null || $channel->tenant_id !== $tenantId) {
                throw new RuntimeException('قناة البيع غير موجودة لهذا المستأجر.');
            }

            if ($channel->type !== SalesChannel::TYPE_WEB) {
                throw new RuntimeException('يجب أن تكون قناة البيع من نوع ويب لربطها بمتجر.');
            }
        });
    }

    public function salesChannel(): BelongsTo
    {
        return $this->belongsTo(SalesChannel::class);
    }

    public function domains(): HasMany
    {
        return $this->hasMany(StorefrontDomain::class);
    }
}
