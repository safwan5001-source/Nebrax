<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\LoginRequest;
use App\Http\Requests\RegisterRequest;
use App\Models\Branch;
use App\Models\Warehouse;
use App\Models\Tenant;
use App\Support\Settings;
use App\Models\Role;
use App\Models\User;
use App\Services\Accounting\CashBankAccountService;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Support\PlanGate;
use App\Support\Rbac;
use App\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;

class AuthController extends ApiController
{
    /** مدة صلاحية التوكن (أيام). */
    private const TOKEN_TTL_DAYS = 7;

    /** مدة التجربة المجانية عند التسجيل (أيام). */
    private const TRIAL_DAYS = 14;

    /**
     * تسجيل شركة جديدة + مالكها، وتهيئة دليل الحسابات، وإصدار توكن.
     */
    public function register(RegisterRequest $request): JsonResponse
    {
        $data = $request->validated();

        // ذرّية: المستأجر + دليل الحسابات + المالك في معاملة واحدة —
        // فشل أي خطوة لا يترك مستأجراً يتيماً بلا مالك (كان يحدث قبل).
        [$tenant, $user] = DB::transaction(function () use ($data) {
            $tenant = Tenant::create([
                'name'          => $data['company_name'],
                'slug'          => $data['slug'],
                'vat_number'    => $data['vat_number'] ?? null,
                'plan'          => 'free',
                'trial_ends_at' => now()->addDays(self::TRIAL_DAYS),
            ]);

            app(TenantContext::class)->set($tenant->id);
            app(ChartOfAccountsSeeder::class)->seed($tenant->id);
            app(CashBankAccountService::class)->bootstrapDefaults();

            // الأدوار النظامية الأربعة — نسخةً طبق الأصل من المصفوفة الثابتة،
            // فيصبح جدول الأدوار مصدر الحقيقة من أول يوم دون تغيير سلوك.
            foreach (Rbac::systemRoles() as $slug => $role) {
                Role::create([
                    'tenant_id'   => $tenant->id,
                    'slug'        => $slug,
                    'name'        => $role['name'],
                    'permissions' => $role['permissions'],
                    'is_system'   => true,
                ]);
            }

            // فرع رئيسي افتراضي لكل مؤسسة (كدليل الحسابات) — يبقى النظام أحادي
            // الفرع سلوكياً حتى يضيف المستخدم فروعاً ويعطّل المشاركة.
            $branch = Branch::create([
                'code' => '00001', 'name' => 'الفرع الرئيسي', 'is_main' => true,
            ]);

            // مخزن رئيسي افتراضي تابع للفرع الرئيسي — يستقبل كل الحركات
            // حتى يعرّف المستخدم مخازن إضافية.
            Warehouse::create([
                'code' => '00001', 'name' => 'المخزن الرئيسي',
                'branch_id' => $branch->id, 'is_default' => true,
            ]);

            $user = User::create([
                'tenant_id' => $tenant->id,
                'name'      => $data['name'] ?? $data['company_name'], // يُشتق من الاسم التجاري إن غاب
                'email'     => $data['email'],
                'phone'     => $data['phone'] ?? null,
                'password'  => $data['password'],
                'role'      => 'owner',
            ]);

            return [$tenant, $user];
        });

        return response()->json([
            'token'  => $this->issueToken($user),
            'user'   => $this->userPayload($user),
            'tenant' => ['id' => $tenant->id, 'name' => $tenant->name, 'slug' => $tenant->slug],
        ], 201);
    }

    /**
     * دخول بالبريد وكلمة المرور فقط — البريد فريد عالمياً فيُستنتَج منه المستأجر.
     * (User لا يرث BaseModel، فالاستعلام عالمي بلا نطاق مستأجر.)
     */
    public function login(LoginRequest $request): JsonResponse
    {
        $data = $request->validated();

        $user = User::where('email', $data['email'])->first();

        if (! $user || ! Hash::check($data['password'], $user->password)) {
            abort(422, 'بيانات الدخول غير صحيحة.');
        }
        if (! $user->is_active) {
            abort(403, 'الحساب غير مفعّل.');
        }

        $tenant = Tenant::find($user->tenant_id);
        if (! PlanGate::subscriptionActive($tenant)) {
            abort(403, 'اشتراك المؤسسة غير نشط أو منتهٍ.');
        }

        return response()->json([
            'token' => $this->issueToken($user),
            'user'  => $this->userPayload($user),
        ]);
    }

    public function logout(Request $request): JsonResponse
    {
        $request->user()->currentAccessToken()->delete();

        return response()->json(['message' => 'تم تسجيل الخروج.']);
    }

    public function me(Request $request): JsonResponse
    {
        $tenant = Tenant::find(app(TenantContext::class)->id());

        return response()->json([
            'user'    => $this->userPayload($request->user()),
            'company' => $this->companyPayload($tenant),
        ]);
    }

    private function issueToken(User $user): string
    {
        return $user->createToken('api', ['*'], now()->addDays(self::TOKEN_TTL_DAYS))->plainTextToken;
    }

    private function userPayload(User $user): array
    {
        return [
            'id'        => $user->id,
            'name'      => $user->name,
            'email'     => $user->email,
            'role'        => $user->role,
            'employee_id' => $user->employee_id,
            'tenant_id'   => $user->tenant_id,
            'preferences' => $user->preferences ?? ['locale' => 'ar', 'theme' => 'system'],
        ];
    }

    /** بيانات الشركة (البائع) لإظهارها في رأس المستندات كالفاتورة الضريبية. */
    private function companyPayload(?Tenant $tenant): ?array
    {
        if (! $tenant) {
            return null;
        }

        return [
            'name'       => $tenant->name,
            'vat_number' => $tenant->vat_number,
            'cr_number'  => $tenant->cr_number,
            'currency'   => $tenant->currency,
            'country'    => $tenant->country,
            // الشعار مع بقية بيانات الشركة: القشرة تقرؤه من هذا الاستدعاء
            // القائم بلا طلبٍ إضافي وبلا قيد صلاحية.
            'logo'       => Settings::group('company', $tenant)['logo'] ?? '',
        ];
    }
}
