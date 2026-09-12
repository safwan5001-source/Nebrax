<?php

namespace App\Support\Inventory;

use App\Models\ReturnDocument;
use App\Models\User;

final class ReturnDocumentHandler implements MovementSourceHandler
{
    public function sourceType(): string
    {
        return ReturnDocument::class;
    }

    public function resolve(array $ids, ?User $user): array
    {
        if ($ids === []) {
            return [];
        }

        $permitted = $user !== null && $user->hasPermission('returns.view');
        $records = ReturnDocument::query()->whereIn('id', $ids)->get()->keyBy('id');
        $out = [];
        foreach ($ids as $id) {
            $record = $records->get($id);
            if (! $record instanceof ReturnDocument) {
                $out[$id] = MovementSource::unknown();
                continue;
            }
            $sales = $record->type === 'sales';
            $type = $sales ? 'sales_return' : 'purchase_return';
            $label = $sales ? 'مرتجع مبيعات' : 'مرتجع مشتريات';
            $routePrefix = $sales ? '/returns/' : '/purchase-returns/';
            if (! $permitted || ! $this->inScope($record, $user)) {
                $out[$id] = MovementSource::unavailable($type, $label);
                continue;
            }
            $out[$id] = new MovementSource(
                type: $type,
                label: $label,
                reference: $record->number !== null ? (string) $record->number : null,
                date: optional($record->return_date)->toDateString(),
                status: $record->status !== null ? (string) $record->status : null,
                canOpen: true,
                route: $routePrefix.$record->id,
            );
        }

        return $out;
    }

    private function inScope(ReturnDocument $record, ?User $user): bool
    {
        if ($user === null) {
            return false;
        }
        $allowed = $user->allowedBranchIds();
        if ($allowed !== null && $record->branch_id && ! in_array((string) $record->branch_id, array_map('strval', $allowed), true)) {
            return false;
        }
        $warehouses = $user->allowedWarehouseIds();
        if ($warehouses !== null && $record->warehouse_id && ! in_array((string) $record->warehouse_id, array_map('strval', $warehouses), true)) {
            return false;
        }

        return true;
    }
}
