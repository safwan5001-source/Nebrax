<?php

namespace App\Services;

use App\Models\AiBudget;
use App\Support\AiAssistantDenied;
use Carbon\CarbonInterface;
use Illuminate\Support\Facades\DB;
use InvalidArgumentException;

/**
 * ميزانية المساعد الذكي (AI-02A): سقف عالمي للمنصة + سقف لكل مستأجر، حجز قبل أي استدعاء، تسوية بعده.
 *
 * ── الذرّية ──
 * الحجز **جملة UPDATE شرطية واحدة** لكل صف: `... WHERE used + reserved + :n <= cap`. فحص الشرط
 * والزيادة غير قابلين للتجزئة في PostgreSQL (قفل الصف) وSQLite (كاتب واحد)، فلا قراءة-ثم-كتابة تُسابَق.
 * الصفّان (global ثم tenant — ترتيب ثابت) داخل معاملة واحدة: فشل أيٍّ منهما يتراجع عن الآخر.
 *
 * ── لا حدّ مفتوح ──
 * غياب صف السقف (عالمي أو للمستأجر) للفترة الحالية = رفض `budget_not_configured`. الأسقف NOT NULL
 * بلا افتراضي. الوحدات: رموز، وmicro-USD (1/1,000,000 دولار) كأعداد صحيحة.
 *
 * ── التسوية ──
 * `finalize` تنتقل بالطلب من `reserved` مرة واحدة فقط (قفل الصف + شرط الحالة): تسويتان متزامنتان أو
 * تسوية ومنظِّف الحجوزات المهجورة لا يُحتسبان مرتين. الاستهلاك الفعلي قد يتجاوز المحجوز (تُحتسب الحقيقة
 * ويُرفض ما بعدها)، ولا يُترك محجوزٌ معلّقاً.
 */
class AiBudgetService
{
    private const PERIOD_PATTERN = '/^\d{4}-(0[1-9]|1[0-2])$/';

    /** الفترة المحاسبية للميزانية: شهر UTC. */
    public function period(?CarbonInterface $at = null): string
    {
        return ($at ?? now())->copy()->utc()->format('Y-m');
    }

    /**
     * تعيين سقوف فترة (مسار المنصة فقط — لا API للمستأجر). `$tenantId = null` = السقف العالمي.
     * خفض السقف دون المستهلك مسموح (يوقف الحجز الجديد) ولا يمسّ العدّادات.
     */
    public function setCaps(?string $tenantId, string $period, int $capTokens, int $capCostMicroUsd): AiBudget
    {
        if (preg_match(self::PERIOD_PATTERN, $period) !== 1) {
            throw new InvalidArgumentException('period must be YYYY-MM.');
        }
        if ($capTokens < 0 || $capCostMicroUsd < 0) {
            throw new InvalidArgumentException('caps must be non-negative integers.');
        }

        $key = $this->key($tenantId);
        $budget = AiBudget::query()->firstOrNew(['budget_key' => $key, 'period' => $period]);
        $budget->tenant_id = $tenantId;
        $budget->cap_tokens = $capTokens;
        $budget->cap_cost_micro_usd = $capCostMicroUsd;
        $budget->save();

        return $budget;
    }

    /**
     * يحجز لمستأجر ضمن الفترة (عالمي ثم مستأجر، معاملة واحدة) أو يرمي `AiAssistantDenied`. لا يُنظِّف
     * الحجوزات المهجورة هنا: التنظيف يجب أن يُثبَّت خارج أي معاملة قد يُتراجَع عنها عند الرفض، فيتولاه
     * `AiRequestLedger::open` ثم يعيد المحاولة مرة واحدة.
     *
     * @throws AiAssistantDenied
     */
    public function reserve(string $tenantId, string $period, int $tokens, int $costMicroUsd): void
    {
        $tokens = max(0, $tokens);
        $costMicroUsd = max(0, $costMicroUsd);

        DB::transaction(function () use ($tenantId, $period, $tokens, $costMicroUsd): void {
            $this->reserveRow('global', $period, $tokens, $costMicroUsd, 'platform_budget_exceeded');
            $this->reserveRow($this->key($tenantId), $period, $tokens, $costMicroUsd, 'budget_exceeded');
        });
    }

    public static function isExceeded(AiAssistantDenied $denied): bool
    {
        return in_array($denied->reason, ['budget_exceeded', 'platform_budget_exceeded'], true);
    }

    /**
     * ينقل الطلب من `reserved` إلى حالة نهائية ويُسوّي الميزانيتين. `$usage = null` ⇒ طبّق سياسة
     * الفشل على المحجوز. يعيد `false` إن سبقه من سوّى الطلب (لا أثر مزدوج).
     *
     * @param  array{input_tokens:int, output_tokens:int, cost_micro_usd:int}|null  $usage
     */
    public function finalize(string $requestId, string $status, ?array $usage, ?string $errorCode): bool
    {
        return DB::transaction(function () use ($requestId, $status, $usage, $errorCode): bool {
            $row = DB::table('ai_requests')->where('id', $requestId)->where('status', 'reserved')->lockForUpdate()->first();
            if ($row === null) {
                return false;
            }

            $reservedTokens = (int) $row->reserved_tokens;
            $reservedCost = (int) $row->reserved_cost_micro_usd;

            if ($usage !== null) {
                $in = max(0, (int) $usage['input_tokens']);
                $out = max(0, (int) $usage['output_tokens']);
                $unmetered = 0;
                $cost = max(0, (int) $usage['cost_micro_usd']);
            } elseif (config('ai_assistant.budget.failure_charge', 'reserved') === 'none') {
                [$in, $out, $unmetered, $cost] = [0, 0, 0, 0];
            } else {
                [$in, $out, $unmetered, $cost] = [0, 0, $reservedTokens, $reservedCost];
            }

            DB::table('ai_requests')->where('id', $requestId)->update([
                'status' => $status,
                'input_tokens' => DB::raw('input_tokens + ' . $in),
                'output_tokens' => DB::raw('output_tokens + ' . $out),
                'unmetered_tokens' => DB::raw('unmetered_tokens + ' . $unmetered),
                'cost_micro_usd' => DB::raw('cost_micro_usd + ' . $cost),
                'reserved_tokens' => 0,
                'reserved_cost_micro_usd' => 0,
                'error_code' => $errorCode,
                'completed_at' => now(),
                'updated_at' => now(),
            ]);

            if ((bool) $row->billable) {
                $this->settleRow('global', (string) $row->period, $reservedTokens, $reservedCost, $in + $out + $unmetered, $cost);
                $this->settleRow($this->key((string) $row->tenant_id), (string) $row->period, $reservedTokens, $reservedCost, $in + $out + $unmetered, $cost);
            }

            return true;
        });
    }

    /**
     * يُسوّي الحجوزات المهجورة (طلب انهار قبل التسوية) بسياسة الفشل. عبر المستأجرين عمداً — الميزانية
     * العالمية مشتركة. يعيد عدد ما سُوّي فعلاً.
     */
    public function reapStale(int $limit = 50): int
    {
        $cutoff = now()->subSeconds(max(1, (int) config('ai_assistant.budget.reservation_ttl_seconds', 600)));
        $ids = DB::table('ai_requests')
            ->where('status', 'reserved')
            ->where('updated_at', '<', $cutoff)
            ->orderBy('updated_at')
            ->limit($limit)
            ->pluck('id');

        $settled = 0;
        foreach ($ids as $id) {
            if ($this->finalize((string) $id, 'failed', null, 'reservation_expired')) {
                $settled++;
            }
        }

        return $settled;
    }

    public function key(?string $tenantId): string
    {
        return $tenantId === null ? 'global' : 'tenant:' . $tenantId;
    }

    /** @throws AiAssistantDenied */
    private function reserveRow(string $key, string $period, int $tokens, int $costMicroUsd, string $exceededReason): void
    {
        $affected = DB::table('ai_budgets')
            ->where('budget_key', $key)
            ->where('period', $period)
            ->whereRaw('used_tokens + reserved_tokens + ? <= cap_tokens', [$tokens])
            ->whereRaw('used_cost_micro_usd + reserved_cost_micro_usd + ? <= cap_cost_micro_usd', [$costMicroUsd])
            ->update([
                'reserved_tokens' => DB::raw('reserved_tokens + ' . $tokens),
                'reserved_cost_micro_usd' => DB::raw('reserved_cost_micro_usd + ' . $costMicroUsd),
                'updated_at' => now(),
            ]);

        if ($affected === 1) {
            return;
        }

        $exists = DB::table('ai_budgets')->where('budget_key', $key)->where('period', $period)->exists();

        throw AiAssistantDenied::for($exists ? $exceededReason : 'budget_not_configured');
    }

    private function settleRow(string $key, string $period, int $reservedTokens, int $reservedCost, int $usedTokens, int $usedCost): void
    {
        DB::table('ai_budgets')->where('budget_key', $key)->where('period', $period)->update([
            'reserved_tokens' => DB::raw("CASE WHEN reserved_tokens >= {$reservedTokens} THEN reserved_tokens - {$reservedTokens} ELSE 0 END"),
            'reserved_cost_micro_usd' => DB::raw("CASE WHEN reserved_cost_micro_usd >= {$reservedCost} THEN reserved_cost_micro_usd - {$reservedCost} ELSE 0 END"),
            'used_tokens' => DB::raw('used_tokens + ' . $usedTokens),
            'used_cost_micro_usd' => DB::raw('used_cost_micro_usd + ' . $usedCost),
            'updated_at' => now(),
        ]);
    }
}
