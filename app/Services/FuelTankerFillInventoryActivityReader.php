<?php

namespace App\Services;

use App\Models\Account;
use App\Models\FuelTankerFill;
use App\Models\JournalEntry;
use App\Models\User;
use App\Tenancy\TenantContext;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * TANKER-PR6B-5 — **قراءة فقط** لحالة الدمج المخزني لسندات التعبئة في مساحة العمل: حقائق الترحيل والعكس، سجل المحاولات (نتيجة المحاولة **منفصلة** عن حالة السند)،
 * الحسابات التاريخية للقيد، وما يتاح للمستخدم من إجراءات. لا كتابة ولا قفل ولا قيد ولا حركة (يحرسه فحص ساكن في `FuelTankerFillPostingStateTest`).
 *
 * التبويبات: `pending` (مسجَّل وبانتظار الترحيل) · `posted` · `reversed` · `attention` (سند لمحاولته الأخيرة لعملية ما نتيجة `rejected|failed` **ولم تتبعها محاولة ناجحة لتلك العملية**؛ لا علاقة لها بحالة السند نفسه).
 * حجب الحساس: المبالغ ومعرّفات القيود والحركات لمن يملك `products.view_cost` فقط، ومعرّفات الحسابات واسمها لمن يملك `accounts.view` فقط (شرطان مستقلان).
 */
class FuelTankerFillInventoryActivityReader
{
    public const TABS = ['pending', 'posted', 'reversed', 'attention'];

    public function __construct(private TenantContext $tenant) {}

    /** يقيّد استعلام السندات بتبويب (لا يغيّر نطاق المحطة/الفرع — يُطبَّقان خارجاً). @param Builder<FuelTankerFill> $query */
    public function applyTab(Builder $query, string $tab): Builder
    {
        $tenantId = (string) $this->tenant->id();

        return match ($tab) {
            'pending' => $query->where('status', FuelTankerFill::STATUS_RECORDED)->where('inventory_status', FuelTankerFill::INVENTORY_PENDING_INTEGRATION),
            'posted' => $query->where('inventory_status', FuelTankerFill::INVENTORY_POSTED),
            'reversed' => $query->where('inventory_status', FuelTankerFill::INVENTORY_REVERSED),
            'attention' => $query->whereIn('id', DB::table('fuel_tanker_fill_inventory_posting_attempts as a')
                ->where('a.tenant_id', $tenantId)->whereIn('a.outcome', ['rejected', 'failed'])
                ->whereNotExists(fn ($q) => $q->from('fuel_tanker_fill_inventory_posting_attempts as s')->whereColumn('s.fuel_tanker_fill_id', 'a.fuel_tanker_fill_id')
                    ->whereColumn('s.operation_type', 'a.operation_type')->where('s.outcome', 'succeeded')->whereColumn('s.attempted_at', '>=', 'a.attempted_at'))
                ->select('a.fuel_tanker_fill_id')),
            default => $query->whereRaw('1 = 0'),
        };
    }

    /**
     * أعداد التبويبات ضمن نطاق مُقيَّد مسبقاً (المتحكّم يمرّر مولّد استعلام جديداً كل مرة).
     *
     * @param  callable(): Builder<FuelTankerFill>  $scoped
     * @return array<string, int>
     */
    public function counts(callable $scoped): array
    {
        $counts = [];
        foreach (self::TABS as $tab) {
            $counts[$tab] = (int) $this->applyTab($scoped(), $tab)->count();
        }

        return $counts;
    }

    /**
     * ملخص لكل سند (حقائق الترحيل + آخر محاولة) لصفوف القائمة.
     *
     * @param  Collection<int, FuelTankerFill>  $fills
     * @return array<string, array<string, mixed>> بمفتاح معرّف السند
     */
    public function summaries(Collection $fills, bool $canSeeCost): array
    {
        if ($fills->isEmpty()) {
            return [];
        }
        $tenantId = (string) $this->tenant->id();
        $ids = $fills->pluck('id')->all();
        $postings = DB::table('fuel_tanker_fill_inventory_postings')->where('tenant_id', $tenantId)->whereIn('fuel_tanker_fill_id', $ids)->get()->keyBy('fuel_tanker_fill_id');
        $attempts = DB::table('fuel_tanker_fill_inventory_posting_attempts')->where('tenant_id', $tenantId)->whereIn('fuel_tanker_fill_id', $ids)
            ->orderBy('attempted_at')->orderBy('created_at')->orderBy('operation_type')->get()->groupBy('fuel_tanker_fill_id');

        $out = [];
        foreach ($fills as $fill) {
            $posting = $postings->get($fill->id);
            $last = $attempts->get($fill->id)?->last();
            $out[$fill->id] = [
                'posting_status' => $posting?->status,
                'posted_at' => $posting === null ? null : $this->iso($posting->posted_at),
                'reversed_at' => $posting?->reversed_at === null ? null : $this->iso($posting->reversed_at),
                'posted_cost_minor' => $canSeeCost && $posting !== null ? (int) $posting->posted_cost_minor : null,
                'last_attempt' => $last === null ? null : $this->attempt($last, false),
                'attempts_count' => (int) ($attempts->get($fill->id)?->count() ?? 0),
            ];
        }

        return $out;
    }

    /**
     * تفاصيل الدمج المخزني لسند واحد (قراءة فقط).
     *
     * @return array<string, mixed>
     */
    public function detail(FuelTankerFill $fill, User $actor): array
    {
        $tenantId = (string) $this->tenant->id();
        $canSeeCost = $actor->hasPermission('products.view_cost');
        $canSeeAccounts = $actor->hasPermission('accounts.view');
        $posting = DB::table('fuel_tanker_fill_inventory_postings')->where('tenant_id', $tenantId)->where('fuel_tanker_fill_id', $fill->id)->first();
        $attempts = DB::table('fuel_tanker_fill_inventory_posting_attempts')->where('tenant_id', $tenantId)->where('fuel_tanker_fill_id', $fill->id)
            ->orderByDesc('attempted_at')->orderByDesc('created_at')->orderByDesc('operation_type')->limit(50)->get();

        $userIds = collect([$posting?->posted_by, $posting?->reversed_by, ...$attempts->pluck('actor_id')->all()])->filter()->unique()->values()->all();
        $users = $userIds === [] ? collect() : User::query()->whereIn('id', $userIds)->pluck('name', 'id');

        $postingPayload = null;
        $accounts = null;
        if ($posting !== null) {
            $postingPayload = [
                'id' => $posting->id, 'status' => $posting->status, 'quantity_milliliters' => (int) $posting->quantity_milliliters,
                'posted_by' => ['id' => $posting->posted_by, 'name' => $users->get($posting->posted_by)], 'posted_at' => $this->iso($posting->posted_at),
                'reversed_by' => $posting->reversed_by === null ? null : ['id' => $posting->reversed_by, 'name' => $users->get($posting->reversed_by)],
                'reversed_at' => $posting->reversed_at === null ? null : $this->iso($posting->reversed_at), 'reversal_reason' => $posting->reversal_reason,
            ];
            if ($canSeeCost) {
                $postJournal = $this->journal(DB::table('fuel_inventory_cost_movements')->where('id', $posting->cost_movement_id)->value('journal_entry_id'));
                $revJournal = $posting->reversal_cost_movement_id === null ? null : $this->journal(DB::table('fuel_inventory_cost_movements')->where('id', $posting->reversal_cost_movement_id)->value('journal_entry_id'));
                $postingPayload += [
                    'posted_cost_minor' => (int) $posting->posted_cost_minor,
                    'journal_entry' => $postJournal, 'reversal_journal_entry' => $revJournal,
                    'stock_movement_id' => $posting->stock_movement_id, 'cost_movement_id' => $posting->cost_movement_id,
                    'reversal_stock_movement_id' => $posting->reversal_stock_movement_id, 'reversal_cost_movement_id' => $posting->reversal_cost_movement_id,
                ];
                if ($canSeeAccounts && $postJournal !== null) {
                    $accounts = $this->accounts((string) $postJournal['id']);
                }
            } elseif ($canSeeAccounts) {
                $entryId = DB::table('fuel_inventory_cost_movements')->where('id', $posting->cost_movement_id)->value('journal_entry_id');
                $accounts = $entryId === null ? null : $this->accounts((string) $entryId);
            }
        }

        return [
            'posting' => $postingPayload,
            'accounts' => $accounts,
            'attempts' => $attempts->map(fn ($row) => $this->attempt($row, true, $users->get($row->actor_id)))->values()->all(),
        ];
    }

    /**
     * الإجراءات المتاحة للمستخدم الحالي لهذا السند (الخادم المصدر: لا زر يظهر لمن لا يملك صلاحيته أو لسند حالته لا تسمح).
     *
     * @return array<string, bool>
     */
    public function actions(FuelTankerFill $fill, User $actor, bool $hasPosting): array
    {
        $pending = $fill->status === FuelTankerFill::STATUS_RECORDED && $fill->inventory_status === FuelTankerFill::INVENTORY_PENDING_INTEGRATION;
        $posted = $fill->inventory_status === FuelTankerFill::INVENTORY_POSTED && $hasPosting;

        return [
            'preview_post' => $pending && $actor->hasPermission('fuel.tanker.fill.inventory.view'),
            'post' => $pending && $actor->hasPermission('fuel.tanker.fill.inventory.post'),
            'post_historical' => $pending && $actor->hasPermission('fuel.tanker.fill.inventory.post') && $actor->hasPermission('fuel.tanker.fill.inventory.post_historical'),
            'preview_reversal' => $posted && $actor->hasPermission('fuel.tanker.fill.inventory.view'),
            'reverse' => $posted && $actor->hasPermission('fuel.tanker.fill.inventory.reverse'),
        ];
    }

    /** @return array{id:string,number:string}|null */
    private function journal(mixed $id): ?array
    {
        if ($id === null) {
            return null;
        }
        $entry = JournalEntry::query()->whereKey($id)->first(['id', 'number']);

        return $entry === null ? null : ['id' => $entry->id, 'number' => $entry->number];
    }

    /** الحسابان التاريخيان من سطرَي قيد الترحيل الأصلي: المدين = الوسيط، الدائن = مخزون الوقود. @return array<string, array<string, mixed>>|null */
    private function accounts(string $entryId): ?array
    {
        $lines = DB::table('journal_lines as jl')->where('journal_entry_id', $entryId)->get(['account_id', 'debit', 'credit']);
        $debit = $lines->firstWhere(fn ($l) => (int) $l->debit > 0);
        $credit = $lines->firstWhere(fn ($l) => (int) $l->credit > 0);
        if ($debit === null || $credit === null) {
            return null;
        }
        $accounts = Account::query()->whereIn('id', [$debit->account_id, $credit->account_id])->get(['id', 'code', 'name'])->keyBy('id');
        $shape = fn (string $id) => ['id' => $id, 'code' => $accounts->get($id)?->code, 'name' => $accounts->get($id)?->name];

        return ['clearing' => $shape($debit->account_id), 'inventory' => $shape($credit->account_id)];
    }

    /** @return array<string, mixed> */
    private function attempt(object $row, bool $withActor, ?string $actorName = null): array
    {
        $shape = ['operation' => $row->operation_type, 'outcome' => $row->outcome, 'reason_code' => $row->reason_code, 'attempted_at' => $this->iso($row->attempted_at)];
        if ($withActor) {
            $shape = ['id' => $row->id] + $shape + ['actor' => ['id' => $row->actor_id, 'name' => $actorName]];
        }

        return $shape;
    }

    private function iso(mixed $value): string
    {
        return \Carbon\CarbonImmutable::parse((string) $value, 'UTC')->toIso8601String();
    }
}
