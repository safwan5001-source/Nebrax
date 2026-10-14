<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\StoreUserRequest;
use App\Http\Requests\UpdateUserRequest;
use App\Http\Resources\UserResource;
use App\Mail\AuthActionMail;
use App\Models\Branch;
use App\Models\Employee;
use App\Models\Role;
use App\Models\Tenant;
use App\Models\User;
use App\Models\Warehouse;
use App\Services\AuthRecoveryService;
use App\Support\PlanGate;
use App\Support\Rbac;
use App\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;

/**
 * إدارة مستخدمي المؤسسة (owner/admin فقط).
 * User لا يرث BaseModel، فالعزل يدوي بالـ tenant_id في كل استعلام.
 */
class UserController extends ApiController
{
    private function tenantId(): string
    {
        return app(TenantContext::class)->id();
    }

    /**
     * حراسة دور المالك: منح دور owner أو المساس بحساب owner قائم حكرٌ على owner.
     * يمنع تصعيد admin نفسه (أو غيره) إلى مالك، أو تعديل/حذف المالك من دونه.
     */
    /**
     * يزامن نطاق وصول المستخدم: فروعه ومستودعاته.
     *
     * **المفتاح الغائب يُترك ولا يُمحى** — تحديثٌ جزئيّ لا يجرّد مستخدماً من
     * نطاقه بالسهو. والمصفوفة الفارغة إلغاءٌ صريح للتقييد (وصولٌ كامل)، وهي
     * الحالة الافتراضية لكل مستخدم قائم.
     *
     * المعرّفات تمرّ بـ`TenantScope` عند التحقّق، فلا يُسنَد فرع أو مستودع
     * لمستأجر آخر.
     */
    private function syncAccessScope(User $user, array $data): void
    {
        if (array_key_exists('branch_ids', $data)) {
            $ids = Branch::whereKey($data['branch_ids'] ?? [])->pluck('id')->all();
            $user->branches()->sync($ids);
        }

        if (array_key_exists('warehouse_ids', $data)) {
            $ids = Warehouse::whereKey($data['warehouse_ids'] ?? [])->pluck('id')->all();
            $user->warehouses()->sync($ids);
        }
    }

    private function guardOwnerRole(Request $request, ?User $target = null, ?string $newRole = null): void
    {
        $actorIsOwner = $request->user()->role === 'owner';

        if ($newRole === 'owner' && ! $actorIsOwner) {
            abort(403, 'منح دور المالك حكر على المالك.');
        }

        if ($target && $target->role === 'owner' && ! $actorIsOwner) {
            abort(403, 'لا يمكن تعديل حساب المالك إلا من مالك.');
        }
    }

    /**
     * هل يستطيع هذا الفاعل منح الدور `$slug`؟ (AC-UX-00A — سقف المنح)
     *
     * - الفاعل ذو `*` يمنح أي دور (حارس المالك `guardOwnerRole` يبقى منفصلاً).
     * - غيره يمنح دوراً فقط إن لم يكن الدور ذا `*` وكانت كل صلاحياته ⊆ صلاحيات
     *   الفاعل نفسه — فلا يرقّي نفسه (أو غيره) فوق ما يملك.
     */
    private function canGrantRole(User $actor, string $slug): bool
    {
        return Rbac::covers(Rbac::permissionsForRole($actor->role), Rbac::permissionsForRole($slug));
    }

    /**
     * حدود المنح لإدارة المستخدمين (AC-UX-00A): لا يُدار بـ`users.manage` ما يتجاوز
     * سلطة الفاعل نفسه.
     *
     *  1. **الدور:** يُمنح دورٌ جديد فقط إن استطاع الفاعل منحه (`canGrantRole`).
     *  2. **الهدف:** مستخدمٌ آخر دوره الحالي فوق سقف الفاعل، أو نطاقه أوسع من نطاق
     *     فاعلٍ مقيَّد، لا يُعدَّل ولا يُحذف — وإلا كان إعادة تعيين كلمة مرور `admin`
     *     (أو مستخدمٍ في فرع آخر) ترقيةً بالمقايضة.
     *  3. **النطاق:** فاعلٌ مقيَّد بفروع/مستودعات لا يُسند إلا ما هو ضمن نطاقه ولا
     *     يمسح التقييد (`[]` تعني «غير مقيَّد») ولا يُنشئ مستخدماً بلا نطاق.
     *
     * الفاعل غير المقيَّد (دلالة الفراغ = الكلّ) وذو `*` لا يتأثر سلوكه.
     */
    private function guardGrantBoundary(Request $request, array $data, ?User $target = null): void
    {
        /** @var User $actor */
        $actor = $request->user();

        // تُقفل صفوف الأدوار التي ستُفحص (الحالي والمطلوب) بترتيب ثابت (slug تصاعدياً) قبل
        // تقييم أيٍّ منها — يتسلسل ذلك مع `RoleController::update` الذي يقفل صفّه، ولا
        // يتشابك طلبان يبدّلان A→B وB→A.
        $slugs = array_values(array_unique(array_filter([$target?->role, $data['role'] ?? null])));
        sort($slugs);
        foreach ($slugs as $slug) {
            Role::where('slug', $slug)->lockForUpdate()->first();
        }

        if ($target && $target->id !== $actor->id) {
            if (! $this->canGrantRole($actor, $target->role)) {
                abort(403, 'لا يمكنك إدارة مستخدمٍ دوره يتجاوز صلاحياتك.');
            }

            // فاعلٌ مقيَّد لا يمسّ مستخدماً نطاقه أوسع من نطاقه (أو غير مقيَّد): تغيير
            // كلمة مرور هذا المستخدم أو حالته استيلاءٌ على وصولٍ خارج نطاق الفاعل.
            foreach ([
                [$actor->allowedBranchIds(), $target->allowedBranchIds()],
                [$actor->allowedWarehouseIds(), $target->allowedWarehouseIds()],
            ] as [$mine, $theirs]) {
                if ($mine !== null && ($theirs === null || array_diff($theirs, $mine) !== [])) {
                    abort(403, 'لا يمكنك إدارة مستخدمٍ نطاق وصوله أوسع من نطاقك.');
                }
            }
        }

        $newRole = $data['role'] ?? null;
        if ($newRole !== null && $newRole !== $target?->role && ! $this->canGrantRole($actor, $newRole)) {
            abort(403, 'لا يمكنك منح دورٍ يتجاوز صلاحياتك.');
        }

        $creating = $target === null;
        foreach (['branch_ids' => $actor->allowedBranchIds(), 'warehouse_ids' => $actor->allowedWarehouseIds()] as $key => $allowed) {
            if ($allowed === null) {
                continue; // الفاعل غير مقيَّد في هذا البُعد.
            }

            if (! array_key_exists($key, $data)) {
                if ($creating) {
                    abort(403, 'حدّد نطاق الوصول للمستخدم الجديد ضمن نطاقك.');
                }
                continue; // الغياب = بلا تغيير.
            }

            $requested = array_values(array_unique($data[$key] ?? []));
            if ($requested === []) {
                abort(403, 'لا يمكنك إلغاء قيد نطاق الوصول؛ حدّد ما ضمن نطاقك.');
            }
            if (array_diff($requested, $allowed) !== []) {
                abort(403, 'لا يمكنك إسناد فروع أو مستودعات خارج نطاقك.');
            }
        }
    }

    /**
     * تحقّق ربط الموظف بالمستخدم (`User ⊃ Employee`). لا فعل إن كان `null`
     * (غير مرسَل أو فكّ ربط). وإلا: الموظف يجب أن يخصّ المستأجر وألّا يكون
     * مرتبطاً بمستخدم آخر — فحسابُ دخولٍ واحد لكل موظف على الأكثر.
     *
     * يشمل الفحصُ المستخدمين المحذوفين ناعماً (`withTrashed`): صفُّهم يبقى في
     * القاعدة ويحجز القيد الفريد، فبلا ذلك كان الربط يمرّ هنا ثم يسقط بخطأ
     * قاعدة بيانات خام. (إعادة إتاحة موظفِ مستخدمٍ محذوف تُعالَج لاحقاً.)
     */
    private function assertLinkableEmployee(?string $employeeId, ?string $exceptUserId = null): void
    {
        if ($employeeId === null) {
            return;
        }

        // Employee يرث BaseModel، فالبحث معزولٌ بالمستأجر تلقائياً.
        if (! Employee::whereKey($employeeId)->exists()) {
            abort(422, 'الموظف غير موجود.');
        }

        $taken = User::withTrashed()
            ->where('tenant_id', $this->tenantId())
            ->where('employee_id', $employeeId)
            ->when($exceptUserId, fn ($q) => $q->where('id', '!=', $exceptUserId))
            ->exists();

        if ($taken) {
            abort(422, 'هذا الموظف مرتبط بمستخدم آخر بالفعل.');
        }
    }

    public function index(): JsonResponse
    {
        // تُحمَّل العلاقتان هنا فتصل الشاشةَ مع القائمة — فلا مسار `show`
        // ولا نداءٌ ثانٍ لكل صفّ لمعرفة نطاق وصوله.
        $users = User::where('tenant_id', $this->tenantId())
            ->with('employee', 'branches', 'warehouses')
            ->latest()
            ->get();

        return UserResource::collection($users)->response();
    }

    public function store(StoreUserRequest $request): JsonResponse
    {
        $data = $request->validated();
        $tenantId = $this->tenantId();

        // فحص سقف المنح والإنشاء ومزامنة النطاق في معاملةٍ واحدة تُبقي أقفال الأدوار —
        // فلا يتّسع دورٌ بين الفحص والإنشاء (انظر `guardGrantBoundary`). الدعوة بالبريد
        // بعدها خارج المعاملة.
        $user = DB::transaction(function () use ($request, $data, $tenantId): User {
            $this->guardOwnerRole($request, null, $data['role'] ?? null);
            $this->guardGrantBoundary($request, $data);

            // فرض حدّ الخطة لعدد المستخدمين
            $tenant = Tenant::find($tenantId);
            $limit = PlanGate::limit($tenant, 'users');
            if ($limit !== null && User::where('tenant_id', $tenantId)->count() >= $limit) {
                abort(422, "تجاوزت حدّ خطتك ({$limit} مستخدمين). رقِّ خطتك للمزيد.");
            }

            // البريد فريد عالمياً (الدخول بالبريد وحده)
            if (User::where('email', $data['email'])->exists()) {
                abort(422, 'البريد الإلكتروني مستخدم بالفعل.');
            }

            $this->assertLinkableEmployee($data['employee_id'] ?? null);

            $user = User::create([
                'tenant_id'   => $tenantId,
                'employee_id' => $data['employee_id'] ?? null,
                'name'        => $data['name'],
                'email'       => $data['email'],
                // لا تُخزَّن كلمة مرور مؤقتة معروفة عند اختيار الدعوة؛ القيمة
                // العشوائية لا تصل إلى البريد أو أي استجابة.
                'password'    => $data['password'] ?? Str::random(64),
                'role'        => $data['role'],
                'is_active'   => $data['is_active'] ?? true,
            ]);

            $this->syncAccessScope($user, $data);

            return $user;
        });

        $invitationSent = true;
        if ((bool) ($data['send_invitation'] ?? false)) {
            $invitationSent = $this->sendLoginInvitation($user);
        }

        return (new UserResource($user->load('employee', 'branches', 'warehouses')))
            ->additional(['invitation' => [
                'sent' => $invitationSent,
                'message' => $invitationSent
                    ? null
                    : 'تم حفظ المستخدم، لكن تعذر إرسال دعوة الدخول. يمكنك إعادة الإرسال من قائمة المستخدمين.',
            ]])
            ->response()->setStatusCode(201);
    }

    public function sendInvitation(Request $request, string $id, AuthRecoveryService $recovery): JsonResponse
    {
        $user = User::where('tenant_id', $this->tenantId())->findOrFail($id);

        if (! is_string($user->email) || trim($user->email) === '') {
            abort(422, 'لا يمكن إرسال دعوة لمستخدم بلا بريد إلكتروني.');
        }

        if (! $this->sendLoginInvitation($user, $recovery)) {
            return response()->json([
                'message' => 'تعذر إرسال دعوة الدخول. بقيت الدعوة السابقة صالحة إن وُجدت، ويمكنك إعادة المحاولة.',
                'invitation_sent' => false,
            ], 503);
        }

        return response()->json(['message' => 'تم إرسال بيانات الدخول إلى بريد المستخدم.']);
    }

    public function update(UpdateUserRequest $request, string $id): JsonResponse
    {
        $data = $request->validated();

        if (empty($data['password'])) {
            unset($data['password']);
        }

        // AC-UX-00A: الهدف يُقفل ويُفحص سقف المنح عليه **داخل** المعاملة نفسها التي
        // تكتب — فلا يُرقّيه مالكٌ متزامن (دوراً أو نطاقاً) بين الفحص والكتابة فتقع
        // كلمة المرور/الحالة على مستخدمٍ صار خارج سقف الفاعل. ومزامنة النطاق في
        // المعاملة نفسها فلا يبقى تحديثٌ نصفيّ.
        $user = DB::transaction(function () use ($request, $id, $data): User {
            $user = User::where('tenant_id', $this->tenantId())->lockForUpdate()->findOrFail($id);
            $this->guardOwnerRole($request, $user, $data['role'] ?? null);
            $this->guardGrantBoundary($request, $data, $user);

            // الغياب يُبقي الربط الحالي؛ `null` صريحة تفكّه؛ ومعرّفٌ يُتحقّق ثم يُربط.
            $this->assertLinkableEmployee($data['employee_id'] ?? null, $user->id);

            // REM-08 / SEC-04: الانتقال active → inactive وحده يسحب التوكنات، وفي المعاملة
            // نفسها — فلا تُحفظ حالة التعطيل ويبقى التوكن حيّاً بسبب استثناء لاحق.
            // إعادة التفعيل لا تُنشئ توكناً: يلزم دخولٌ جديد. الحارس الفعلي وقت
            // الطلب في `SetTenant` وليس هذا الحذف وحده.
            $wasActive = (bool) $user->is_active;

            $user->update($data);

            if ($wasActive && ! $user->is_active) {
                $user->tokens()->delete();
            }

            $this->syncAccessScope($user, $data);

            return $user;
        });

        return (new UserResource($user->load('employee', 'branches', 'warehouses')))->response();
    }

    public function destroy(Request $request, string $id): JsonResponse
    {
        if ($request->user()->id === $id) {
            abort(422, 'لا يمكنك حذف حسابك الخاص.');
        }

        // REM-08 / SEC-04: الحذف ناعم (`SoftDeletes`) وجدول التوكنات polymorphic بلا
        // FK متتالٍ، فلا يسقط التوكن تبعاً للمستخدم — يُسحب صراحةً قبل الحذف.
        // والهدف مقفولٌ ومفحوصٌ داخل المعاملة نفسها (انظر `update`).
        DB::transaction(function () use ($request, $id): void {
            $user = User::where('tenant_id', $this->tenantId())->lockForUpdate()->findOrFail($id);
            $this->guardOwnerRole($request, $user);
            $this->guardGrantBoundary($request, [], $user);

            $user->tokens()->delete();
            $user->delete();
        });

        return response()->json(['message' => 'تم الحذف.']);
    }

    private function sendLoginInvitation(User $user, ?AuthRecoveryService $recovery = null): bool
    {
        $recovery ??= app(AuthRecoveryService::class);
        $delivery = $recovery->issueForDelivery($user, AuthRecoveryService::LOGIN_INVITATION);
        $tenantName = (string) $user->tenant()->value('name');

        try {
            Mail::to($user->email)->send(new AuthActionMail(
                'invite',
                $recovery->frontendLink($user, '/reset-password', $delivery['token']),
                $tenantName,
                $user->name,
                $user->email,
            ));
        } catch (\Throwable $exception) {
            $recovery->abandonDelivery($delivery['id']);
            report($exception);

            return false;
        }

        $recovery->commitDelivery($delivery['id'], $delivery['previous_ids']);

        return true;
    }
}
