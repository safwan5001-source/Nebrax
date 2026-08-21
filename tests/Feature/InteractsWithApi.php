<?php

namespace Tests\Feature;

use App\Models\User;
use App\Services\TenantApplicationService;
use App\Support\ApplicationCatalog;
use App\Tenancy\TenantContext;

/**
 * مساعدات اختبارات الـ API: تسجيل مستأجر، وإنشاء مستخدم بدور محدّد.
 */
trait InteractsWithApi
{
    /**
     * يُنسي حُرّاس المصادقة قبل كل طلب JSON حتى يُعاد حلّ المستخدم من توكنه.
     * (في الاختبار يبقى الحارس حيّاً عبر الطلبات؛ في الإنتاج كل طلب إقلاع منفصل.)
     */
    public function json($method, $uri, array $data = [], array $headers = [], $options = 0)
    {
        $this->app['auth']->forgetGuards();

        return parent::json($method, $uri, $data, $headers, $options);
    }

    /**
     * `$autoEnableApplications` (الافتراضي `true`) يحاكي مستأجراً أنهى تأسيسه:
     * كل القدرات المبنية غير الإلزامية مفعّلة فوراً، فتبقى مئات اختبارات
     * الميزات القائمة تعمل بلا تعديل رغم الإنفاذ الفعلي الجديد على المسارات
     * (`EnsureApplicationActive`) — الحقيقة الإنتاجية توازيها: مستأجرٌ سُجِّل
     * قبل تفعيل الإنفاذ يُعامَل كمفعّلٍ تلقائياً (`isGrandfatheredTenant`)،
     * فهذا المسار يحاكي نفس الحالة لأي مستأجر اختبار. عطّله صراحةً في
     * اختبارات كتالوج التطبيقات نفسها التي تفحص الحالة الافتراضية الخام.
     */
    protected function registerTenant(string $slug = 'acme', string $email = 'owner@acme.test', bool $autoEnableApplications = true): array
    {
        $res = $this->postJson('/api/register', [
            'company_name' => 'شركة ' . $slug,
            'slug'         => $slug,
            'vat_number'   => '300000000000003',
            'name'         => 'المالك',
            'email'        => $email,
            'password'     => 'password123',
        ])->assertCreated();

        $tenantId = $res['tenant']['id'];

        if ($autoEnableApplications) {
            app(TenantContext::class)->set($tenantId);
            $applications = app(TenantApplicationService::class);
            foreach (ApplicationCatalog::all() as $key => $application) {
                if ($application['mandatory'] || $application['maturity'] !== ApplicationCatalog::MATURITY_BUILT) {
                    continue;
                }
                $applications->enable($key, null);
            }
        }

        return ['token' => $res['token'], 'tenant_id' => $tenantId];
    }

    protected function tokenForRole(string $tenantId, string $role, string $email): string
    {
        app(TenantContext::class)->set($tenantId);

        $user = User::create([
            'tenant_id' => $tenantId,
            'name'      => $role,
            'email'     => $email,
            'password'  => 'password123',
            'role'      => $role,
        ]);

        return $user->createToken('api')->plainTextToken;
    }

    /**
     * حمولة `items` لعقدٍ يحمل بند "الراتب الأساسي" فقط — بندٌ واحدٌ إلزامي
     * (design-system/foundations/hr-users-architecture.md «قوالب/بنود الراتب»).
     * `$extra` يضيف بنوداً إضافية جاهزة (allowance/gosi/other).
     */
    protected function basicSalaryItems(int $amount, array $extra = []): array
    {
        return [
            ['category' => 'basic', 'name' => 'الراتب الأساسي', 'amount' => $amount],
            ...$extra,
        ];
    }
}
