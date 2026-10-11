<?php

namespace App\Services\Reporting;

use App\Models\CreditNote;
use App\Models\DeliveryPlatformProfileVersion as Version;
use App\Models\Invoice;
use App\Models\InvoiceLine;
use App\Models\ReturnDocument;
use App\Support\ReportBranchScope;
use App\Tenancy\TenantContext;
use Illuminate\Database\Eloquent\Builder;
use RuntimeException;

/**
 * تقرير مبيعات قنوات التوصيل — قراءة فقط.
 *
 * العقد: docs/plans/pos/DLV-CHANNEL-REPORT-1-EVIDENCE-DESIGN.md §§3–6.
 * المجتمع المالي هو فواتير POS مرحّلة ذات سياق توصيل مطابق للفرع والمستأجر.
 * المبالغ هللات. لا ضم لطلبات Hub، ولا طرح لإشعارات الدائن من صافي المرتجعات،
 * ولا إعادة حساب للضريبة.
 */
class DeliveryChannelReportService
{
    /**
     * @param  array<string,mixed>  $filters
     * @return array<string,mixed>
     */
    public function report(array $filters): array
    {
        $tenantId = app(TenantContext::class)->id();
        if (! is_string($tenantId) || $tenantId === '') {
            throw new RuntimeException('مستأجر التقرير غير محدد.');
        }

        $from = $this->dateFilter($filters['from'] ?? null);
        $to = $this->dateFilter($filters['to'] ?? null);
        $profileId = $this->dateFilter($filters['delivery_platform_profile_id'] ?? null);
        $branches = ReportBranchScope::resolve($filters);

        $header = $this->headerTotals(true, $from, $to, $profileId, $branches, $tenantId);
        $lines = $this->lineTotals(true, $from, $to, $profileId, $branches, $tenantId);
        $returns = $this->returnTotals($from, $to, $profileId, $branches, $tenantId);
        $credits = $this->creditTotals($from, $to, $profileId, $branches, $tenantId);

        $gross = $lines['gross'];
        $discounts = $lines['line_discount'] + $header['discount'];
        $net = $header['net'];
        $vat = $header['tax'];
        $total = $header['total'];
        $netAfterReturns = $total - $returns['total'];

        $platforms = $this->platforms($from, $to, $profileId, $branches, $tenantId);

        return [
            'scope' => [
                'from' => $from,
                'to' => $to,
                'branch_ids' => $branches,
                'delivery_platform_profile_id' => $profileId,
                'source' => 'posted_pos_delivery_invoices',
            ],
            'metrics' => [
                ['number' => 1, 'key' => 'gross_sales', 'amount' => $gross],
                ['number' => 2, 'key' => 'discounts', 'amount' => $discounts],
                ['number' => 3, 'key' => 'net_sales', 'amount' => $net],
                ['number' => 4, 'key' => 'vat', 'amount' => $vat],
                ['number' => 5, 'key' => 'total', 'amount' => $total],
                ['number' => 6, 'key' => 'posted_invoices', 'count' => $header['count']],
                ['number' => 7, 'key' => 'credit_notes', 'count' => $credits['count'], 'amount' => $credits['total']],
                ['number' => 8, 'key' => 'pos_returns', 'count' => $returns['count'], 'amount' => $returns['total'], 'subtotal' => $returns['subtotal'], 'tax' => $returns['tax']],
                ['number' => 9, 'key' => 'net_after_pos_returns', 'amount' => $netAfterReturns],
            ],
            'summary' => [
                'gross_sales' => $gross,
                'discounts' => $discounts,
                'shipping' => $header['shipping'],
                'adjustment' => $header['adjustment'],
                'net_sales' => $net,
                'vat' => $vat,
                'total' => $total,
                'invoice_count' => $header['count'],
                'returns_count' => $returns['count'],
                'returns_subtotal' => $returns['subtotal'],
                'returns_vat' => $returns['tax'],
                'returns_total' => $returns['total'],
                'net_after_pos_returns' => $netAfterReturns,
            ],
            'collection' => [
                'platform_collected_total' => $header['platform_collected'],
                'merchant_collected_total' => $header['merchant_collected'],
                'unclassified_total' => $total - $header['platform_collected'] - $header['merchant_collected'],
            ],
            'credit_notes' => [
                'count' => $credits['count'],
                'total' => $credits['total'],
                'by_platform' => $credits['by_platform'],
                'rows' => $this->creditRows($from, $to, $profileId, $branches, $tenantId),
            ],
            'exceptions' => [
                'context_branch_mismatch' => $this->mismatchCount($from, $to, $profileId, $branches, $tenantId),
                'credit_note_partner_mismatch' => $this->partnerMismatchCount($from, $to, $profileId, $branches, $tenantId),
            ],
            'platforms' => $platforms,
            'invoices' => $this->invoiceRows($from, $to, $profileId, $branches, $tenantId),
            'returns' => $this->returnRows($from, $to, $profileId, $branches, $tenantId),
        ];
    }

    /** @return array{count:int,discount:int,shipping:int,adjustment:int,net:int,tax:int,total:int,platform_collected:int,merchant_collected:int} */
    private function headerTotals(bool $dated, ?string $from, ?string $to, ?string $profileId, ?array $branches, string $tenantId): array
    {
        $row = $this->population($dated, $from, $to, $profileId, $branches, $tenantId)
            ->join('delivery_invoice_contexts as ctx', function ($join) use ($tenantId): void {
                $this->matchContext($join, $tenantId);
            })
            ->selectRaw(
                'COUNT(invoices.id) as invoice_count,
                COALESCE(SUM(invoices.discount), 0) as header_discount,
                COALESCE(SUM(invoices.shipping), 0) as shipping,
                COALESCE(SUM(invoices.adjustment), 0) as adjustment,
                COALESCE(SUM(invoices.subtotal - invoices.discount + invoices.shipping + invoices.adjustment), 0) as net_sales,
                COALESCE(SUM(invoices.tax_amount), 0) as vat,
                COALESCE(SUM(invoices.total), 0) as total,
                COALESCE(SUM(CASE WHEN ctx.collection_mode = ? THEN invoices.total ELSE 0 END), 0) as platform_collected,
                COALESCE(SUM(CASE WHEN ctx.collection_mode = ? THEN invoices.total ELSE 0 END), 0) as merchant_collected',
                [Version::COLLECTION_PLATFORM, Version::COLLECTION_MERCHANT]
            )
            ->first();

        return [
            'count' => $this->halalas($row->invoice_count ?? 0),
            'discount' => $this->halalas($row->header_discount ?? 0),
            'shipping' => $this->halalas($row->shipping ?? 0),
            'adjustment' => $this->halalas($row->adjustment ?? 0),
            'net' => $this->halalas($row->net_sales ?? 0),
            'tax' => $this->halalas($row->vat ?? 0),
            'total' => $this->halalas($row->total ?? 0),
            'platform_collected' => $this->halalas($row->platform_collected ?? 0),
            'merchant_collected' => $this->halalas($row->merchant_collected ?? 0),
        ];
    }

    /** @return array{gross:int,line_discount:int} */
    private function lineTotals(bool $dated, ?string $from, ?string $to, ?string $profileId, ?array $branches, string $tenantId): array
    {
        $row = InvoiceLine::query()
            ->whereIn('invoice_lines.invoice_id', $this->population($dated, $from, $to, $profileId, $branches, $tenantId)->select('invoices.id'))
            ->selectRaw('COALESCE(SUM(invoice_lines.line_subtotal), 0) as gross, COALESCE(SUM(invoice_lines.line_discount), 0) as line_discount')
            ->first();

        return [
            'gross' => $this->halalas($row->gross ?? 0),
            'line_discount' => $this->halalas($row->line_discount ?? 0),
        ];
    }

    /** @return array{count:int,subtotal:int,tax:int,total:int} */
    private function returnTotals(?string $from, ?string $to, ?string $profileId, ?array $branches, string $tenantId): array
    {
        $row = $this->returnsQuery($from, $to, $profileId, $branches, $tenantId)
            ->selectRaw('COUNT(return_documents.id) as returns_count, COALESCE(SUM(return_documents.subtotal), 0) as subtotal, COALESCE(SUM(return_documents.tax_amount), 0) as vat, COALESCE(SUM(return_documents.total), 0) as total')
            ->first();

        return [
            'count' => $this->halalas($row->returns_count ?? 0),
            'subtotal' => $this->halalas($row->subtotal ?? 0),
            'tax' => $this->halalas($row->vat ?? 0),
            'total' => $this->halalas($row->total ?? 0),
        ];
    }

    /** @return array{count:int,total:int,by_platform:array<int,array<string,mixed>>} */
    private function creditTotals(?string $from, ?string $to, ?string $profileId, ?array $branches, string $tenantId): array
    {
        $row = $this->creditsQuery($from, $to, $profileId, $branches, $tenantId, true)
            ->selectRaw('COUNT(DISTINCT credit_notes.id) as notes_count, COALESCE(SUM(credit_notes.total), 0) as notes_total')
            ->first();

        $byPlatform = $this->creditsQuery($from, $to, $profileId, $branches, $tenantId, true)
            ->join('delivery_invoice_contexts as ctx', function ($join) use ($tenantId): void {
                $join->on('ctx.invoice_id', '=', 'invoices.id')
                    ->where('ctx.tenant_id', $tenantId);
                $this->whereSameBranch($join);
            })
            ->join('delivery_platform_profiles as profiles', function ($join) use ($tenantId): void {
                $join->on('profiles.id', '=', 'ctx.delivery_platform_profile_id')
                    ->where('profiles.tenant_id', $tenantId);
            })
            ->groupBy('profiles.id', 'profiles.platform_key')
            ->orderBy('profiles.platform_key')
            ->selectRaw('profiles.id as profile_id, profiles.platform_key as platform_key, COUNT(DISTINCT credit_notes.id) as notes_count, COALESCE(SUM(credit_notes.total), 0) as notes_total')
            ->get()
            ->map(fn ($platform) => [
                'delivery_platform_profile_id' => (string) $platform->profile_id,
                'platform_key' => (string) $platform->platform_key,
                'count' => $this->halalas($platform->notes_count),
                'total' => $this->halalas($platform->notes_total),
            ])->all();

        return [
            'count' => $this->halalas($row->notes_count ?? 0),
            'total' => $this->halalas($row->notes_total ?? 0),
            'by_platform' => $byPlatform,
        ];
    }

    /** @return array<int,array<string,mixed>> */
    private function platforms(?string $from, ?string $to, ?string $profileId, ?array $branches, string $tenantId): array
    {
        $sales = $this->population(true, $from, $to, $profileId, $branches, $tenantId)
            ->join('delivery_invoice_contexts as ctx', function ($join) use ($tenantId): void {
                $this->matchContext($join, $tenantId);
            })
            ->join('delivery_platform_profiles as profiles', function ($join) use ($tenantId): void {
                $join->on('profiles.id', '=', 'ctx.delivery_platform_profile_id')
                    ->where('profiles.tenant_id', $tenantId);
            })
            ->groupBy('profiles.id', 'profiles.platform_key')
            ->selectRaw(
                'profiles.id as profile_id, profiles.platform_key as platform_key,
                COUNT(invoices.id) as invoice_count,
                COALESCE(SUM(invoices.discount), 0) as header_discount,
                COALESCE(SUM(invoices.shipping), 0) as shipping,
                COALESCE(SUM(invoices.adjustment), 0) as adjustment,
                COALESCE(SUM(invoices.subtotal - invoices.discount + invoices.shipping + invoices.adjustment), 0) as net_sales,
                COALESCE(SUM(invoices.tax_amount), 0) as vat,
                COALESCE(SUM(invoices.total), 0) as total,
                COALESCE(SUM(CASE WHEN ctx.collection_mode = ? THEN invoices.total ELSE 0 END), 0) as platform_collected,
                COALESCE(SUM(CASE WHEN ctx.collection_mode = ? THEN invoices.total ELSE 0 END), 0) as merchant_collected',
                [Version::COLLECTION_PLATFORM, Version::COLLECTION_MERCHANT]
            )
            ->get()
            ->keyBy('profile_id');

        $lineRows = InvoiceLine::query()
            ->join('invoices', 'invoices.id', '=', 'invoice_lines.invoice_id')
            ->where('invoices.tenant_id', $tenantId)
            ->whereIn('invoices.id', $this->population(true, $from, $to, $profileId, $branches, $tenantId)->select('invoices.id'))
            ->join('delivery_invoice_contexts as ctx', function ($join) use ($tenantId): void {
                $this->matchContext($join, $tenantId);
            })
            ->join('delivery_platform_profiles as profiles', function ($join) use ($tenantId): void {
                $join->on('profiles.id', '=', 'ctx.delivery_platform_profile_id')
                    ->where('profiles.tenant_id', $tenantId);
            })
            ->groupBy('profiles.id')
            ->selectRaw('profiles.id as profile_id, COALESCE(SUM(invoice_lines.line_subtotal), 0) as gross, COALESCE(SUM(invoice_lines.line_discount), 0) as line_discount')
            ->get()
            ->keyBy('profile_id');

        $returnRows = $this->returnsQuery($from, $to, $profileId, $branches, $tenantId)
            ->join('delivery_invoice_contexts as ctx', function ($join) use ($tenantId): void {
                $join->on('ctx.invoice_id', '=', 'invoices.id')
                    ->where('ctx.tenant_id', $tenantId);
                $this->whereSameBranch($join);
            })
            ->join('delivery_platform_profiles as profiles', function ($join) use ($tenantId): void {
                $join->on('profiles.id', '=', 'ctx.delivery_platform_profile_id')
                    ->where('profiles.tenant_id', $tenantId);
            })
            ->groupBy('profiles.id', 'profiles.platform_key')
            ->selectRaw('profiles.id as profile_id, profiles.platform_key as platform_key, COUNT(return_documents.id) as returns_count, COALESCE(SUM(return_documents.subtotal), 0) as subtotal, COALESCE(SUM(return_documents.tax_amount), 0) as vat, COALESCE(SUM(return_documents.total), 0) as total')
            ->get()
            ->keyBy('profile_id');

        $ids = $sales->keys()->merge($returnRows->keys())->unique()->all();
        $rows = [];
        foreach ($ids as $id) {
            $sale = $sales->get($id);
            $line = $lineRows->get($id);
            $return = $returnRows->get($id);
            $platformKey = (string) ($sale->platform_key ?? $return->platform_key ?? '');
            $gross = $this->halalas($line->gross ?? 0);
            $discounts = $this->halalas($line->line_discount ?? 0) + $this->halalas($sale->header_discount ?? 0);
            $total = $this->halalas($sale->total ?? 0);
            $platformCollected = $this->halalas($sale->platform_collected ?? 0);
            $merchantCollected = $this->halalas($sale->merchant_collected ?? 0);
            $returnsTotal = $this->halalas($return->total ?? 0);
            $rows[] = [
                'delivery_platform_profile_id' => (string) $id,
                'platform_key' => $platformKey,
                'gross_sales' => $gross,
                'discounts' => $discounts,
                'shipping' => $this->halalas($sale->shipping ?? 0),
                'adjustment' => $this->halalas($sale->adjustment ?? 0),
                'net_sales' => $this->halalas($sale->net_sales ?? 0),
                'vat' => $this->halalas($sale->vat ?? 0),
                'total' => $total,
                'invoice_count' => $this->halalas($sale->invoice_count ?? 0),
                'platform_collected_total' => $platformCollected,
                'merchant_collected_total' => $merchantCollected,
                'unclassified_total' => $total - $platformCollected - $merchantCollected,
                'returns_count' => $this->halalas($return->returns_count ?? 0),
                'returns_subtotal' => $this->halalas($return->subtotal ?? 0),
                'returns_vat' => $this->halalas($return->vat ?? 0),
                'returns_total' => $returnsTotal,
                'net_after_pos_returns' => $total - $returnsTotal,
            ];
        }

        usort($rows, fn (array $a, array $b) => [$a['platform_key'], $a['delivery_platform_profile_id']] <=> [$b['platform_key'], $b['delivery_platform_profile_id']]);

        return $rows;
    }

    /** @return array<int,array<string,mixed>> */
    private function invoiceRows(?string $from, ?string $to, ?string $profileId, ?array $branches, string $tenantId): array
    {
        $lines = InvoiceLine::query()
            ->whereIn('invoice_lines.invoice_id', $this->population(true, $from, $to, $profileId, $branches, $tenantId)->select('invoices.id'))
            ->groupBy('invoice_lines.invoice_id')
            ->selectRaw('invoice_lines.invoice_id as invoice_id, COALESCE(SUM(invoice_lines.line_subtotal), 0) as gross, COALESCE(SUM(invoice_lines.line_discount), 0) as line_discount')
            ->get()
            ->keyBy('invoice_id');

        return $this->population(true, $from, $to, $profileId, $branches, $tenantId)
            ->join('delivery_invoice_contexts as ctx', function ($join) use ($tenantId): void {
                $this->matchContext($join, $tenantId);
            })
            ->join('delivery_platform_profiles as profiles', function ($join) use ($tenantId): void {
                $join->on('profiles.id', '=', 'ctx.delivery_platform_profile_id')
                    ->where('profiles.tenant_id', $tenantId);
            })
            ->join('delivery_platform_profile_versions as versions', function ($join) use ($tenantId): void {
                $join->on('versions.id', '=', 'ctx.delivery_platform_profile_version_id')
                    ->where('versions.tenant_id', $tenantId);
            })
            ->leftJoin('branches', function ($join) use ($tenantId): void {
                $join->on('branches.id', '=', 'invoices.branch_id')
                    ->where('branches.tenant_id', $tenantId);
            })
            ->orderBy('invoices.invoice_date')
            ->orderBy('invoices.number')
            ->get([
                'invoices.id',
                'invoices.number',
                'invoices.invoice_date',
                'invoices.branch_id',
                'branches.name as branch_name',
                'profiles.id as profile_id',
                'profiles.platform_key',
                'versions.display_name',
                'versions.display_name_en',
                'versions.logo_asset_key',
                'ctx.collection_mode',
                'ctx.external_order_reference',
                'invoices.discount',
                'invoices.shipping',
                'invoices.adjustment',
                'invoices.subtotal',
                'invoices.tax_amount',
                'invoices.total',
                'invoices.pos_session_id',
            ])
            ->map(function ($invoice) use ($lines) {
                $line = $lines->get($invoice->id);
                $gross = $this->halalas($line->gross ?? 0);
                $discounts = $this->halalas($line->line_discount ?? 0) + $this->halalas($invoice->discount);
                $net = $this->halalas($invoice->subtotal) - $this->halalas($invoice->discount) + $this->halalas($invoice->shipping) + $this->halalas($invoice->adjustment);

                return [
                    'id' => (string) $invoice->id,
                    'number' => (string) $invoice->number,
                    'invoice_date' => $this->day($invoice->invoice_date),
                    'branch_id' => $invoice->branch_id ? (string) $invoice->branch_id : null,
                    'branch_name' => $invoice->branch_name !== null ? (string) $invoice->branch_name : null,
                    'delivery_platform_profile_id' => (string) $invoice->profile_id,
                    'platform_key' => (string) $invoice->platform_key,
                    'display_name' => $invoice->display_name !== null ? (string) $invoice->display_name : null,
                    'display_name_en' => $invoice->display_name_en !== null ? (string) $invoice->display_name_en : null,
                    'logo_asset_key' => $invoice->logo_asset_key !== null ? (string) $invoice->logo_asset_key : null,
                    'collection_mode' => (string) $invoice->collection_mode,
                    'external_order_reference' => $invoice->external_order_reference !== null ? (string) $invoice->external_order_reference : null,
                    'gross_sales' => $gross,
                    'discounts' => $discounts,
                    'shipping' => $this->halalas($invoice->shipping),
                    'adjustment' => $this->halalas($invoice->adjustment),
                    'net_sales' => $net,
                    'vat' => $this->halalas($invoice->tax_amount),
                    'total' => $this->halalas($invoice->total),
                    'pos_session_id' => $invoice->pos_session_id ? (string) $invoice->pos_session_id : null,
                ];
            })->all();
    }

    /** @return array<int,array<string,mixed>> */
    private function returnRows(?string $from, ?string $to, ?string $profileId, ?array $branches, string $tenantId): array
    {
        return $this->returnsQuery($from, $to, $profileId, $branches, $tenantId)
            ->join('delivery_invoice_contexts as ctx', function ($join) use ($tenantId): void {
                $join->on('ctx.invoice_id', '=', 'invoices.id')
                    ->where('ctx.tenant_id', $tenantId);
                $this->whereSameBranch($join);
            })
            ->join('delivery_platform_profiles as profiles', function ($join) use ($tenantId): void {
                $join->on('profiles.id', '=', 'ctx.delivery_platform_profile_id')
                    ->where('profiles.tenant_id', $tenantId);
            })
            ->orderBy('return_documents.return_date')
            ->orderBy('return_documents.number')
            ->get([
                'return_documents.id',
                'return_documents.number',
                'return_documents.return_date',
                'invoices.id as source_invoice_id',
                'invoices.number as source_invoice_number',
                'profiles.id as profile_id',
                'profiles.platform_key',
                'return_documents.subtotal',
                'return_documents.tax_amount',
                'return_documents.total',
            ])
            ->map(fn ($row) => [
                'id' => (string) $row->id,
                'number' => (string) $row->number,
                'return_date' => $this->day($row->return_date),
                'source_invoice_id' => (string) $row->source_invoice_id,
                'source_invoice_number' => (string) $row->source_invoice_number,
                'delivery_platform_profile_id' => (string) $row->profile_id,
                'platform_key' => (string) $row->platform_key,
                'subtotal' => $this->halalas($row->subtotal),
                'vat' => $this->halalas($row->tax_amount),
                'total' => $this->halalas($row->total),
            ])->all();
    }

    /** @return array<int,array<string,mixed>> */
    private function creditRows(?string $from, ?string $to, ?string $profileId, ?array $branches, string $tenantId): array
    {
        return $this->creditsQuery($from, $to, $profileId, $branches, $tenantId, true)
            ->join('delivery_invoice_contexts as ctx', function ($join) use ($tenantId): void {
                $join->on('ctx.invoice_id', '=', 'invoices.id')
                    ->where('ctx.tenant_id', $tenantId);
                $this->whereSameBranch($join);
            })
            ->join('delivery_platform_profiles as profiles', function ($join) use ($tenantId): void {
                $join->on('profiles.id', '=', 'ctx.delivery_platform_profile_id')
                    ->where('profiles.tenant_id', $tenantId);
            })
            ->orderBy('credit_notes.note_date')
            ->orderBy('credit_notes.number')
            ->get([
                'credit_notes.id',
                'credit_notes.number',
                'credit_notes.note_date',
                'invoices.id as source_invoice_id',
                'invoices.number as source_invoice_number',
                'profiles.id as profile_id',
                'profiles.platform_key',
                'credit_notes.total',
            ])
            ->map(fn ($row) => [
                'id' => (string) $row->id,
                'number' => (string) $row->number,
                'note_date' => $this->day($row->note_date),
                'source_invoice_id' => (string) $row->source_invoice_id,
                'source_invoice_number' => (string) $row->source_invoice_number,
                'delivery_platform_profile_id' => (string) $row->profile_id,
                'platform_key' => (string) $row->platform_key,
                'total' => $this->halalas($row->total),
            ])->all();
    }

    private function mismatchCount(?string $from, ?string $to, ?string $profileId, ?array $branches, string $tenantId): int
    {
        $query = Invoice::query()
            ->where('invoices.tenant_id', $tenantId)
            ->where('invoices.status', 'posted')
            ->where('invoices.type', 'sale')
            ->whereNotNull('invoices.pos_session_id');
        $this->applySalesDates($query, $from, $to);
        $this->applyInvoiceBranches($query, $branches);
        $query->whereExists(function ($sub) use ($tenantId, $profileId): void {
            $sub->selectRaw('1')
                ->from('delivery_invoice_contexts as ctx')
                ->whereColumn('ctx.invoice_id', 'invoices.id')
                ->where('ctx.tenant_id', $tenantId)
                ->where(function ($branch) {
                    $branch->where(function ($different) {
                        $different->whereColumn('ctx.branch_id', '!=', 'invoices.branch_id')
                            ->whereNotNull('ctx.branch_id')
                            ->whereNotNull('invoices.branch_id');
                    })->orWhere(function ($onlyInvoice) {
                        $onlyInvoice->whereNull('ctx.branch_id')->whereNotNull('invoices.branch_id');
                    })->orWhere(function ($onlyContext) {
                        $onlyContext->whereNotNull('ctx.branch_id')->whereNull('invoices.branch_id');
                    });
                });
            if ($profileId !== null) {
                $sub->where('ctx.delivery_platform_profile_id', $profileId);
            }
        });

        return (int) $query->count();
    }

    private function partnerMismatchCount(?string $from, ?string $to, ?string $profileId, ?array $branches, string $tenantId): int
    {
        return (int) $this->creditsQuery($from, $to, $profileId, $branches, $tenantId, false)
            ->distinct()
            ->count('credit_notes.id');
    }

    /** @param  \Illuminate\Database\Query\JoinClause  $join */
    private function matchContext($join, string $tenantId): void
    {
        $join->on('ctx.invoice_id', '=', 'invoices.id')
            ->where('ctx.tenant_id', $tenantId)
            ->whereColumn('ctx.tenant_id', 'invoices.tenant_id');
        $this->whereSameBranch($join);
    }

    /**
     * `NULL = NULL` ليست مطابقة في SQL. فرع الفاتورة وسياقها يُنسخان معاً،
     * فغياب الفرع عن الطرفين تطابق لا استثناء.
     *
     * @param  \Illuminate\Database\Query\JoinClause|\Illuminate\Database\Query\Builder  $query
     */
    private function whereSameBranch($query): void
    {
        $query->where(function ($match) {
            $match->whereColumn('ctx.branch_id', 'invoices.branch_id')
                ->orWhere(function ($bothNull) {
                    $bothNull->whereNull('ctx.branch_id')->whereNull('invoices.branch_id');
                });
        });
    }

    /** @return Builder<Invoice> */
    private function population(bool $dated, ?string $from, ?string $to, ?string $profileId, ?array $branches, string $tenantId): Builder
    {
        $query = Invoice::query()
            ->where('invoices.status', 'posted')
            ->where('invoices.type', 'sale')
            ->whereNotNull('invoices.pos_session_id')
            ->where('invoices.tenant_id', $tenantId)
            ->whereExists(function ($sub) use ($tenantId, $profileId): void {
                $sub->selectRaw('1')
                    ->from('delivery_invoice_contexts as ctx')
                    ->whereColumn('ctx.invoice_id', 'invoices.id')
                    ->where('ctx.tenant_id', $tenantId)
                    ->whereColumn('ctx.tenant_id', 'invoices.tenant_id');
                $this->whereSameBranch($sub);
                if ($profileId !== null) {
                    $sub->where('ctx.delivery_platform_profile_id', $profileId);
                }
            });

        if ($dated) {
            $this->applySalesDates($query, $from, $to);
        }
        $this->applyInvoiceBranches($query, $branches);

        return $query;
    }

    /** @return Builder<ReturnDocument> */
    private function returnsQuery(?string $from, ?string $to, ?string $profileId, ?array $branches, string $tenantId): Builder
    {
        $query = ReturnDocument::query()
            ->join('invoices', function ($join) use ($tenantId): void {
                $join->on('invoices.id', '=', 'return_documents.original_id')
                    ->where('return_documents.original_type', Invoice::class)
                    ->where('invoices.tenant_id', $tenantId);
            })
            ->where('return_documents.tenant_id', $tenantId)
            ->where('return_documents.status', 'posted')
            ->where('return_documents.type', 'sales')
            ->where('return_documents.original_type', Invoice::class)
            ->whereIn('return_documents.original_id', $this->population(false, $from, $to, $profileId, $branches, $tenantId)->select('invoices.id'));

        if ($from !== null) {
            $query->whereDate('return_documents.return_date', '>=', $from);
        }
        if ($to !== null) {
            $query->whereDate('return_documents.return_date', '<=', $to);
        }
        if ($branches !== null) {
            $query->whereIn('return_documents.branch_id', $branches);
        }

        return $query;
    }

    /** @return Builder<CreditNote> */
    private function creditsQuery(?string $from, ?string $to, ?string $profileId, ?array $branches, string $tenantId, bool $samePartner): Builder
    {
        $query = CreditNote::query()
            ->join('invoices', function ($join) use ($tenantId): void {
                $join->on('invoices.id', '=', 'credit_notes.original_invoice_id')
                    ->where('invoices.tenant_id', $tenantId);
            })
            ->where('credit_notes.tenant_id', $tenantId)
            ->where('credit_notes.status', 'posted')
            ->where('credit_notes.type', 'sales')
            ->whereNotNull('credit_notes.original_invoice_id')
            ->whereColumn('credit_notes.tenant_id', 'invoices.tenant_id')
            ->whereIn('credit_notes.original_invoice_id', $this->population(false, $from, $to, $profileId, $branches, $tenantId)->select('invoices.id'));

        if ($samePartner) {
            $query->whereColumn('credit_notes.partner_id', 'invoices.partner_id');
        } else {
            $query->whereColumn('credit_notes.partner_id', '!=', 'invoices.partner_id');
        }
        if ($from !== null) {
            $query->whereDate('credit_notes.note_date', '>=', $from);
        }
        if ($to !== null) {
            $query->whereDate('credit_notes.note_date', '<=', $to);
        }
        if ($branches !== null) {
            $query->whereIn('credit_notes.branch_id', $branches);
        }

        return $query;
    }

    /** @param  Builder<Invoice>  $query */
    private function applySalesDates(Builder $query, ?string $from, ?string $to): void
    {
        if ($from !== null) {
            $query->whereDate('invoices.invoice_date', '>=', $from);
        }
        if ($to !== null) {
            $query->whereDate('invoices.invoice_date', '<=', $to);
        }
    }

    /** @param  Builder<Invoice>  $query
     * @param  array<int,string>|null  $branches
     */
    private function applyInvoiceBranches(Builder $query, ?array $branches): void
    {
        if ($branches !== null) {
            $query->whereIn('invoices.branch_id', $branches);
        }
    }

    private function dateFilter(mixed $value): ?string
    {
        if (! is_string($value) || $value === '') {
            return null;
        }

        return $value;
    }

    private function halalas(mixed $value): int
    {
        return (int) ($value ?? 0);
    }

    private function day(mixed $value): ?string
    {
        if ($value === null || $value === '') {
            return null;
        }
        if ($value instanceof \DateTimeInterface) {
            return $value->format('Y-m-d');
        }

        return substr((string) $value, 0, 10);
    }
}
