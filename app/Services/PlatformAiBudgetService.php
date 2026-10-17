<?php

namespace App\Services;

use App\Models\AiBudget;
use App\Models\PlatformAdministrator;
use App\Models\PlatformIntegrationAuditEvent;
use App\Models\Tenant;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\ValidationException;

/**
 * إدارة ميزانيات الذكاء الاصطناعي من مساحة تشغيل المنصة (AI-07) — **واجهة فوق `AiBudgetService` لا بديل عنه**.
 *
 * - الكتابة الوحيدة عبر `AiBudgetService::setCaps` (لا جدول ولا منطق حجز جديد)، بمسار المنصة وحده (`platform:manage`
 *   + كلمة مرور المدير) وتدقيق ثابت في `platform_integration_audit_events` بأسماء الحقول لا قيمها.
 * - الأسقف أعداد صحيحة: رموز، وmicro-USD (1 دولار = 1,000,000). ممنوع float.
 * - حماية من الاستهلاك الزائد: لا فترة ماضية، حدود قصوى معقولة، **سقف المؤسسة لا يتجاوز السقف العالمي** للفترة نفسها،
 *   وغياب الصف = لا إنفاق (`budget_not_configured`) كما في المحرك. خفض السقف دون المستهلك مسموح ويوقف الحجز الجديد.
 * - القراءة تجمع المستهلك لكل `feature` (assistant | document_extraction) من الجدول نفسه، ولا تكشف أسعاراً ولا مفاتيح.
 */
class PlatformAiBudgetService
{
    public const MAX_TOKENS = 1_000_000_000_000;      // 10^12 رمز/شهر

    public const MAX_COST_MICRO_USD = 100_000_000_000; // 100,000 دولار/شهر

    public function __construct(private readonly AiBudgetService $budgets) {}

    /** @return array<string,mixed> */
    public function overview(?string $period = null): array
    {
        $period = $this->validPeriod($period ?? $this->budgets->period());

        $rows = DB::table('ai_budgets')->where('period', $period)->orderBy('budget_key')->get();
        $names = Tenant::query()->whereIn('id', $rows->pluck('tenant_id')->filter()->all())->pluck('name', 'id');

        $global = $rows->firstWhere('budget_key', 'global');
        $tenants = $rows->filter(fn ($row): bool => $row->tenant_id !== null)
            ->map(fn ($row): array => $this->shape($row) + ['tenant_id' => $row->tenant_id, 'tenant_name' => $names[$row->tenant_id] ?? null])
            ->values()->all();

        $allocatedTokens = $rows->filter(fn ($row): bool => $row->tenant_id !== null)->sum('cap_tokens');
        $allocatedCost = $rows->filter(fn ($row): bool => $row->tenant_id !== null)->sum('cap_cost_micro_usd');

        $byFeature = DB::table('ai_requests')->where('period', $period)
            ->selectRaw('feature, COUNT(*) as requests, SUM(CASE WHEN status = \'failed\' THEN 1 ELSE 0 END) as failed, '
                . 'COALESCE(SUM(input_tokens + output_tokens + unmetered_tokens), 0) as tokens, COALESCE(SUM(cost_micro_usd), 0) as cost_micro_usd')
            ->groupBy('feature')->orderBy('feature')->get()
            ->map(fn ($row): array => [
                'feature' => (string) $row->feature,
                'requests' => (int) $row->requests,
                'failed' => (int) $row->failed,
                'tokens' => (int) $row->tokens,
                'cost_micro_usd' => (int) $row->cost_micro_usd,
                'cost_usd' => self::usd((int) $row->cost_micro_usd),
            ])->all();

        return [
            'period' => $period,
            'current_period' => $this->budgets->period(),
            'global' => $global === null ? null : $this->shape($global),
            'tenants' => $tenants,
            // مجموع أسقف المؤسسات يفوق السقف العالمي: مسموح (الأول الذي يبلغ سقفه يمنع)، لكن يُنبَّه عليه.
            'over_allocated' => $global !== null && ($allocatedTokens > (int) $global->cap_tokens || $allocatedCost > (int) $global->cap_cost_micro_usd),
            'by_feature' => $byFeature,
            'policy' => [
                'meter_document_extraction' => (bool) config('ai_assistant.budget.meter_document_extraction', false),
                'failure_charge' => (string) config('ai_assistant.budget.failure_charge', 'reserved'),
                'assistant_provider' => (string) config('ai_assistant.provider', 'mock'),
                'assistant_external_network_enabled' => AssistantNetworkGate::allowsExternalRequests(),
            ],
            'limits' => ['max_tokens' => self::MAX_TOKENS, 'max_cost_micro_usd' => self::MAX_COST_MICRO_USD],
        ];
    }

    /**
     * @param  array{scope:string, tenant_id?:?string, period:string, cap_tokens:int, cap_cost_micro_usd:int, current_password:string}  $validated
     * @return array<string,mixed>
     */
    public function update(PlatformAdministrator $administrator, array $validated): array
    {
        if (! Hash::check((string) $validated['current_password'], $administrator->password)) {
            throw ValidationException::withMessages(['current_password' => 'كلمة مرور مدير المنصة غير صحيحة.']);
        }

        $period = $this->validPeriod($validated['period']);
        if ($period < $this->budgets->period()) {
            throw ValidationException::withMessages(['period' => 'لا يمكن تعديل ميزانية فترة منتهية.']);
        }
        $tokens = (int) $validated['cap_tokens'];
        $cost = (int) $validated['cap_cost_micro_usd'];
        if ($tokens < 0 || $tokens > self::MAX_TOKENS || $cost < 0 || $cost > self::MAX_COST_MICRO_USD) {
            throw ValidationException::withMessages(['cap_tokens' => 'السقف خارج الحدود المسموحة.']);
        }

        $tenantId = $validated['scope'] === 'tenant' ? (string) ($validated['tenant_id'] ?? '') : null;

        DB::transaction(function () use ($administrator, $period, $tokens, $cost, $tenantId): void {
            if ($tenantId !== null) {
                if (! Tenant::query()->whereKey($tenantId)->exists()) {
                    throw ValidationException::withMessages(['tenant_id' => 'المؤسسة غير موجودة.']);
                }
                // قفل صفّ السقف العالمي حتى نهاية المعاملة: فحص «سقف المؤسسة ≤ العالمي» وكتابته لا يفصل بينهما تعديلٌ متزامن للعالمي.
                $global = AiBudget::query()->where('budget_key', 'global')->where('period', $period)->lockForUpdate()->first();
                if ($global !== null && ($tokens > $global->cap_tokens || $cost > $global->cap_cost_micro_usd)) {
                    throw ValidationException::withMessages(['cap_tokens' => 'سقف المؤسسة لا يتجاوز السقف العالمي للفترة.']);
                }
            }

            $previous = AiBudget::query()->where('budget_key', $this->budgets->key($tenantId))->where('period', $period)->first();
            $this->budgets->setCaps($tenantId, $period, $tokens, $cost);

            $prefix = $tenantId === null ? 'global' : 'tenant:' . $tenantId;
            $changed = [];
            if ($previous === null || $previous->cap_tokens !== $tokens) {
                $changed[] = "{$prefix}.cap_tokens";
            }
            if ($previous === null || $previous->cap_cost_micro_usd !== $cost) {
                $changed[] = "{$prefix}.cap_cost_micro_usd";
            }
            PlatformIntegrationAuditEvent::create([
                'platform_administrator_id' => $administrator->id,
                'integration_key' => 'ai_budget',
                'action' => $previous === null ? 'budget_created' : 'budget_updated',
                'changed_keys' => $changed,
                'occurred_at' => now('UTC'),
            ]);
        }, 3);

        return $this->overview($period);
    }

    /** @return array<string,mixed> */
    private function shape(object $row): array
    {
        $cap = (int) $row->cap_cost_micro_usd;
        $used = (int) $row->used_cost_micro_usd;
        $reserved = (int) $row->reserved_cost_micro_usd;

        return [
            'cap_tokens' => (int) $row->cap_tokens,
            'used_tokens' => (int) $row->used_tokens,
            'reserved_tokens' => (int) $row->reserved_tokens,
            'cap_cost_micro_usd' => $cap,
            'used_cost_micro_usd' => $used,
            'reserved_cost_micro_usd' => $reserved,
            'cap_cost_usd' => self::usd($cap),
            'used_cost_usd' => self::usd($used),
            'remaining_tokens' => max(0, (int) $row->cap_tokens - (int) $row->used_tokens - (int) $row->reserved_tokens),
            'remaining_cost_micro_usd' => max(0, $cap - $used - $reserved),
        ];
    }

    /** micro-USD → نص عشري بستّ خانات بحساب صحيح (بلا float). */
    public static function usd(int $micro): string
    {
        return intdiv($micro, 1_000_000) . '.' . str_pad((string) ($micro % 1_000_000), 6, '0', STR_PAD_LEFT);
    }

    private function validPeriod(string $period): string
    {
        if (preg_match('/^\d{4}-(0[1-9]|1[0-2])$/', $period) !== 1) {
            throw ValidationException::withMessages(['period' => 'الفترة بصيغة YYYY-MM.']);
        }

        return $period;
    }
}
