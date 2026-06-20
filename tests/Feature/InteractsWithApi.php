<?php

namespace Tests\Feature;

use App\Models\User;
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

    protected function registerTenant(string $slug = 'acme', string $email = 'owner@acme.test'): array
    {
        $res = $this->postJson('/api/register', [
            'company_name' => 'شركة ' . $slug,
            'slug'         => $slug,
            'vat_number'   => '300000000000003',
            'name'         => 'المالك',
            'email'        => $email,
            'password'     => 'password123',
        ])->assertCreated();

        return ['token' => $res['token'], 'tenant_id' => $res['tenant']['id']];
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
}
