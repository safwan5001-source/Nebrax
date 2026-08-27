<?php

namespace App\Services\DocumentCenter;

use App\Models\DocumentProviderAttempt;
use App\Models\DocumentProviderUsageEvent;
use App\Tenancy\BranchContext;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;

/** تقارير usage من evidence immutable فقط، بلا تسعير أو تحويل عملات. */
final class DocumentUsageReportingService
{
    public const DEFAULT_DAYS = 31;

    public const MAX_DAYS = 92;

    /** @param array{from:CarbonImmutable,to:CarbonImmutable,provider?:?string,model?:?string,document_type?:?string} $filters
     * @return array<string,mixed>
     */
    public function tenantSummary(array $filters): array
    {
        $events = $this->events($filters);
        $totals = (clone $events)->selectRaw('COUNT(*) as operations, COALESCE(SUM(page_count), 0) as pages, COALESCE(SUM(input_tokens), 0) as input_tokens, COALESCE(SUM(output_tokens), 0) as output_tokens, COALESCE(SUM(processing_duration_ms), 0) as processing_duration_ms')->first();
        $cost = (clone $events)->whereNotNull('currency')->whereNotNull('cost_minor')
            ->select('currency', DB::raw('SUM(cost_minor) as cost_minor'))
            ->groupBy('currency')->orderBy('currency')->get()->map(fn ($row) => [
                'currency' => $row->currency,
                'cost_minor' => (int) $row->cost_minor,
            ])->all();
        $byProvider = (clone $events)->select('provider_key', 'model', DB::raw('COUNT(*) as operations'), DB::raw('COALESCE(SUM(page_count), 0) as pages'), DB::raw('COALESCE(SUM(input_tokens), 0) as input_tokens'), DB::raw('COALESCE(SUM(output_tokens), 0) as output_tokens'))
            ->groupBy('provider_key', 'model')->orderBy('provider_key')->orderBy('model')->get()->map(fn ($row) => [
                'provider' => $row->provider_key,
                'model' => $row->model,
                'operations' => (int) $row->operations,
                'pages' => (int) $row->pages,
                'input_tokens' => (int) $row->input_tokens,
                'output_tokens' => (int) $row->output_tokens,
            ])->all();
        $failed = $this->attempts($filters)->where('status', 'failed')->count();

        return [
            'range' => ['from' => $filters['from']->toDateString(), 'to' => $filters['to']->toDateString()],
            'operations' => (int) ($totals?->operations ?? 0),
            'pages' => (int) ($totals?->pages ?? 0),
            'input_tokens' => (int) ($totals?->input_tokens ?? 0),
            'output_tokens' => (int) ($totals?->output_tokens ?? 0),
            'total_tokens' => (int) ($totals?->input_tokens ?? 0) + (int) ($totals?->output_tokens ?? 0),
            'processing_duration_ms' => (int) ($totals?->processing_duration_ms ?? 0),
            'successful_operations' => (int) ($totals?->operations ?? 0),
            'failed_attempts' => $failed,
            'cost_available' => $cost !== [],
            'cost_by_currency' => $cost,
            'by_provider_model' => $byProvider,
        ];
    }

    /** @param array{from:CarbonImmutable,to:CarbonImmutable,provider?:?string,model?:?string,document_type?:?string} $filters
     * @return \Generator<int,array<int,string|int|null>>
     */
    public function exportRows(array $filters): \Generator
    {
        $query = $this->events($filters)->orderBy('document_provider_usage_events.occurred_at')->orderBy('document_provider_usage_events.id');
        foreach ($query->cursor() as $event) {
            yield [
                $event->occurred_at?->toIso8601String(),
                $event->document_batch_id,
                $event->document_type,
                $event->provider_key,
                $event->model,
                $event->page_count,
                $event->input_tokens,
                $event->output_tokens,
                $event->processing_duration_ms,
                $event->currency,
                $event->cost_minor,
                $event->cost_policy_version,
            ];
        }
    }

    /** @return array<string,mixed> */
    public function platformSummary(CarbonImmutable $from, CarbonImmutable $to): array
    {
        $base = DB::table('document_provider_usage_events')->whereBetween('occurred_at', [$from, $to]);
        $totals = (clone $base)->selectRaw('COUNT(*) as operations, COALESCE(SUM(page_count), 0) as pages, COALESCE(SUM(input_tokens), 0) as input_tokens, COALESCE(SUM(output_tokens), 0) as output_tokens')->first();
        $perTenant = (clone $base)->select('tenant_id', DB::raw('COUNT(*) as operations'), DB::raw('COALESCE(SUM(page_count), 0) as pages'), DB::raw('COALESCE(SUM(input_tokens), 0) as input_tokens'), DB::raw('COALESCE(SUM(output_tokens), 0) as output_tokens'))
            ->groupBy('tenant_id')->orderBy('tenant_id')->get()->map(fn ($row) => ['tenant_id' => $row->tenant_id, 'operations' => (int) $row->operations, 'pages' => (int) $row->pages, 'input_tokens' => (int) $row->input_tokens, 'output_tokens' => (int) $row->output_tokens])->all();
        $perProvider = (clone $base)->select('provider_key', 'model', DB::raw('COUNT(*) as operations'), DB::raw('COALESCE(SUM(page_count), 0) as pages'))
            ->groupBy('provider_key', 'model')->orderBy('provider_key')->orderBy('model')->get()->map(fn ($row) => ['provider' => $row->provider_key, 'model' => $row->model, 'operations' => (int) $row->operations, 'pages' => (int) $row->pages])->all();
        $daily = (clone $base)->selectRaw('DATE(occurred_at) as day, COUNT(*) as operations, COALESCE(SUM(page_count), 0) as pages')
            ->groupBy('day')->orderBy('day')->get()->map(fn ($row) => ['day' => (string) $row->day, 'operations' => (int) $row->operations, 'pages' => (int) $row->pages])->all();
        $cost = (clone $base)->whereNotNull('currency')->whereNotNull('cost_minor')->select('currency', DB::raw('SUM(cost_minor) as cost_minor'))
            ->groupBy('currency')->orderBy('currency')->get()->map(fn ($row) => ['currency' => $row->currency, 'cost_minor' => (int) $row->cost_minor])->all();

        return [
            'range' => ['from' => $from->toDateString(), 'to' => $to->toDateString()],
            'operations' => (int) ($totals?->operations ?? 0), 'pages' => (int) ($totals?->pages ?? 0),
            'input_tokens' => (int) ($totals?->input_tokens ?? 0), 'output_tokens' => (int) ($totals?->output_tokens ?? 0),
            'per_tenant' => $perTenant, 'per_provider_model' => $perProvider, 'per_day' => $daily,
            'cost_available' => $cost !== [], 'cost_by_currency' => $cost,
            'quota_utilization' => null,
        ];
    }

    /** @param array{from:CarbonImmutable,to:CarbonImmutable,provider?:?string,model?:?string,document_type?:?string} $filters */
    private function events(array $filters): Builder
    {
        $query = DocumentProviderUsageEvent::query()
            ->join('document_batches', 'document_batches.id', '=', 'document_provider_usage_events.document_batch_id')
            ->where('document_provider_usage_events.branch_id', app(BranchContext::class)->id())
            ->whereBetween('document_provider_usage_events.occurred_at', [$filters['from'], $filters['to']])
            ->select('document_provider_usage_events.*', 'document_batches.document_type');
        if (filled($filters['provider'] ?? null)) {
            $query->where('document_provider_usage_events.provider_key', $filters['provider']);
        }
        if (filled($filters['model'] ?? null)) {
            $query->where('document_provider_usage_events.model', $filters['model']);
        }
        if (filled($filters['document_type'] ?? null)) {
            $query->where('document_batches.document_type', $filters['document_type']);
        }

        return $query;
    }

    /** @param array{from:CarbonImmutable,to:CarbonImmutable,provider?:?string,model?:?string,document_type?:?string} $filters */
    private function attempts(array $filters): Builder
    {
        $query = DocumentProviderAttempt::query()
            ->join('document_batches', 'document_batches.id', '=', 'document_provider_attempts.document_batch_id')
            ->where('document_provider_attempts.branch_id', app(BranchContext::class)->id())
            ->whereBetween('document_provider_attempts.started_at', [$filters['from'], $filters['to']]);
        if (filled($filters['provider'] ?? null)) {
            $query->where('document_provider_attempts.provider_key', $filters['provider']);
        }
        if (filled($filters['model'] ?? null)) {
            $query->where('document_provider_attempts.model', $filters['model']);
        }
        if (filled($filters['document_type'] ?? null)) {
            $query->where('document_batches.document_type', $filters['document_type']);
        }

        return $query;
    }
}
