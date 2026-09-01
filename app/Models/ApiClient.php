<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Laravel\Sanctum\HasApiTokens;

/**
 * عميل Public API — تكامل/آلة خارجية (M2M) مملوك **لمستأجر واحد** حصراً.
 *
 * ليس مستخدمًا بشريًا: هوية طلب الـ Public API وقت التشغيل هي عميل الـ API لا شخص.
 * قد يملك المستأجر عدة عملاء (تكامل ERP، موصّل متجر، تقارير BI، تطبيق جوّال، شريك…).
 *
 * مفاتيح الـ API له = توكنات Sanctum (`HasApiTokens`, tokenable = ApiClient)، فتُخزَّن
 * مجزَّأة (sha256) في `personal_access_tokens`، ويُحمَل الـ scope في `abilities`.
 * لا يحمل هذا النموذج أي سرّ بنفسه.
 *
 * يرث `BaseModel` (UUID + عزل مستأجر تلقائي عبر `BelongsToTenant`)، فالإدارة
 * (سرد/إبطال) معزولة بالمستأجر. أمّا حلّ الهوية وقت المصادقة فيتجاوز نطاق المستأجر
 * صراحةً في `AuthenticateApiClient` (الهوية عالمية قبل إنشاء حدّ المستأجر).
 *
 * `CompanyWide` (إقرار واعٍ): اعتماد تكامل على مستوى المؤسسة، غير مرتبط بفرع —
 * مثل المستخدمين والصلاحيات وإعدادات المؤسسة، لا بيانات تشغيلية معزولة بالفرع.
 */
class ApiClient extends BaseModel implements CompanyWide
{
    use HasApiTokens;

    protected $fillable = [
        'tenant_id',
        'name',
        'is_active',
    ];

    protected $casts = [
        'is_active' => 'boolean',
    ];

    public function tenant(): BelongsTo
    {
        return $this->belongsTo(Tenant::class);
    }
}
