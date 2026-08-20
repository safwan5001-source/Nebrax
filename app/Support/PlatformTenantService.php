<?php

namespace App\Support;

use App\Models\PlatformAdministrator;
use App\Models\PlatformAdministratorAction;
use App\Models\PlatformSubscription;
use App\Models\Tenant;
use Illuminate\Pagination\LengthAwarePaginator;
use Illuminate\Support\Facades\DB;

/**
 * يدير مستأجري المنصة من مساحة التشغيل الداخلية: عرض قوائم/تفاصيل أساسية،
 * وتغيير الخطة أو تمديد التجربة أو تفعيل/تعطيل الوصول.
 *
 * لا يعيد أو يعدّل أي بيانات مالية داخلية للمستأجر (دفتر أستاذ، فواتير) —
 * تلك ملك المستأجر حصراً. كل تعديل يُسجَّل في `platform_administrator_actions`
 * للأثر الرجعي.
 */
class PlatformTenantService
{
    public function list(?string $search, int $perPage = 20): LengthAwarePaginator
    {
        $query = Tenant::query()
            ->withCount('users')
            ->with(['users' => fn ($q) => $q->where('role', 'owner')->oldest()->limit(1)]);

        if ($search !== null && trim($search) !== '') {
            $term = '%' . trim($search) . '%';
            $query->where(function ($q) use ($term): void {
                $q->where('name', 'like', $term)
                    ->orWhere('slug', 'like', $term)
                    ->orWhereHas('users', fn ($u) => $u->where('role', 'owner')->where('email', 'like', $term));
            });
        }

        return $query->orderByDesc('created_at')->paginate($perPage)->through(fn (Tenant $tenant) => $this->summarize($tenant));
    }

    public function find(string $tenantId): array
    {
        $tenant = Tenant::query()
            ->withCount(['users', 'users as active_users_count' => fn ($q) => $q->where('is_active', true)])
            ->with(['users' => fn ($q) => $q->where('role', 'owner')->oldest()->limit(1)])
            ->findOrFail($tenantId);

        $subscriptions = PlatformSubscription::query()
            ->where('tenant_id', $tenant->id)
            ->orderByDesc('starts_on')
            ->get(['id', 'plan', 'status', 'monthly_amount', 'currency', 'starts_on', 'ends_on'])
            ->map(fn (PlatformSubscription $s) => [
                'id'                   => $s->id,
                'plan'                 => $s->plan,
                'status'               => $s->status,
                'monthly_amount_minor' => $s->monthly_amount,
                'monthly_amount'       => Money::toRiyal($s->monthly_amount),
                'currency'             => $s->currency,
                'starts_on'            => $s->starts_on?->toDateString(),
                'ends_on'              => $s->ends_on?->toDateString(),
            ])
            ->all();

        return [
            ...$this->summarize($tenant),
            'active_users_count' => $tenant->active_users_count,
            'plan_limits'        => $tenant->plan_limits,
            'subscriptions'      => $subscriptions,
        ];
    }

    public function updatePlan(Tenant $tenant, PlatformAdministrator $administrator, string $plan): Tenant
    {
        if (! array_key_exists($plan, Plans::PLANS)) {
            throw new \InvalidArgumentException('الخطة غير معروفة.');
        }

        $from = $tenant->plan;

        DB::transaction(function () use ($tenant, $administrator, $plan, $from): void {
            $tenant->update(['plan' => $plan]);
            $this->log($administrator, $tenant, PlatformAdministratorAction::ACTION_PLAN_CHANGED, $from, $plan);
        });

        return $tenant->refresh();
    }

    public function extendTrial(Tenant $tenant, PlatformAdministrator $administrator, ?\DateTimeInterface $trialEndsAt): Tenant
    {
        $from = $tenant->trial_ends_at?->toDateString();
        $to = $trialEndsAt?->format('Y-m-d');

        DB::transaction(function () use ($tenant, $administrator, $trialEndsAt, $from, $to): void {
            $tenant->update(['trial_ends_at' => $trialEndsAt]);
            $this->log($administrator, $tenant, PlatformAdministratorAction::ACTION_TRIAL_EXTENDED, $from, $to);
        });

        return $tenant->refresh();
    }

    public function setActive(Tenant $tenant, PlatformAdministrator $administrator, bool $active): Tenant
    {
        $from = $tenant->is_active ? 'active' : 'inactive';
        $to = $active ? 'active' : 'inactive';

        DB::transaction(function () use ($tenant, $administrator, $active, $from, $to): void {
            $tenant->update(['is_active' => $active]);
            $this->log(
                $administrator,
                $tenant,
                $active ? PlatformAdministratorAction::ACTION_ACTIVATED : PlatformAdministratorAction::ACTION_DEACTIVATED,
                $from,
                $to,
            );
        });

        return $tenant->refresh();
    }

    private function log(PlatformAdministrator $administrator, Tenant $tenant, string $action, ?string $from, ?string $to): void
    {
        PlatformAdministratorAction::create([
            'platform_administrator_id' => $administrator->id,
            'tenant_id'                 => $tenant->id,
            'action'                    => $action,
            'from_value'                => $from,
            'to_value'                  => $to,
        ]);
    }

    /** @return array<string, mixed> */
    private function summarize(Tenant $tenant): array
    {
        $owner = $tenant->users->first();

        return [
            'id'                    => $tenant->id,
            'name'                  => $tenant->name,
            'slug'                  => $tenant->slug,
            'plan'                  => $tenant->plan,
            'is_active'             => $tenant->is_active,
            'trial_ends_at'         => $tenant->trial_ends_at?->toDateString(),
            'subscription_ends_at'  => $tenant->subscription_ends_at?->toDateString(),
            'created_at'            => $tenant->created_at?->toDateString(),
            'users_count'           => $tenant->users_count,
            'contact'               => $owner ? ['name' => $owner->name, 'email' => $owner->email, 'phone' => $owner->phone] : null,
        ];
    }
}
