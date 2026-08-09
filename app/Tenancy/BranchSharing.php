<?php

namespace App\Tenancy;

use App\Support\BranchSettings;

/**
 * ═══════════════════════════════════════════════════════════════
 *  BranchSharing — مفاتيح مشاركة البيانات بين الفروع (singleton)
 * ═══════════════════════════════════════════════════════════════
 *  العزل المشروط يحتاج قراءة هذه المفاتيح عند **كل** استعلام على نموذج
 *  مشمول. قراءتها من قاعدة البيانات في كل مرة كارثة أداء، فتُقرأ هنا **مرة
 *  واحدة للطلب** وتُحفظ.
 *
 *  **الافتراض الآمن: مشترك.** بلا سياق مستأجر (أوامر artisan، مهام مجدولة،
 *  اختبارات وحدة) تُعاد القيم الافتراضية — كلها `true` — فلا يُصفّى شيء.
 *  أي فشل في القراءة يميل إلى إظهار البيانات لا إخفائها.
 *
 *  @see design-system/foundations/multi-branch-architecture.md
 */
class BranchSharing
{
    /** @var array<string, bool>|null المفاتيح المحمّلة لهذا الطلب (null = لم تُقرأ بعد) */
    protected ?array $flags = null;

    /** هل هذا النوع من البيانات مشترك بين الفروع؟ (`true` = بلا عزل) */
    public function shared(string $key): bool
    {
        return (bool) ($this->all()[$key] ?? true);
    }

    /**
     * كل المفاتيح — تُقرأ كسولاً مرة واحدة ثم تُحفظ.
     *
     * @return array<string, bool>
     */
    public function all(): array
    {
        return $this->flags ??= app(TenantContext::class)->has()
            ? BranchSettings::sharing()
            : BranchSettings::SHARING_DEFAULTS;
    }

    /**
     * يُبطل الحفظ. يُستدعى عند بداية كل طلب (SetBranch) وعند تعديل الإعدادات
     * (BranchSettings::merge) — فلا يخدم طلبٌ مفاتيحَ طلبٍ سابق.
     */
    public function forget(): void
    {
        $this->flags = null;
    }
}
