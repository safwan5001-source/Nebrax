<?php

namespace App\Support\Inventory;

use App\Models\User;
use Illuminate\Database\Eloquent\Model;

final class ClassDocumentHandler implements MovementSourceHandler
{
    public function __construct(
        private readonly string $modelClass,
        private readonly string $type,
        private readonly string $label,
        private readonly string $routeTemplate,
        private readonly string $permission,
        private readonly string $dateColumn,
        private readonly bool $enforceBranch = true,
        private readonly bool $enforceWarehouse = false,
    ) {}

    public function sourceType(): string
    {
        return $this->modelClass;
    }

    public function resolve(array $ids, ?User $user): array
    {
        if ($ids === []) {
            return [];
        }

        $permitted = $user !== null && $user->hasPermission($this->permission);
        $records = $this->modelClass::query()->whereIn('id', $ids)->get()->keyBy('id');

        $out = [];
        foreach ($ids as $id) {
            $record = $records->get($id);
            if (! $record instanceof Model) {
                $out[$id] = MovementSource::unknown();
                continue;
            }
            if (! $permitted || ! $this->inScope($record, $user)) {
                $out[$id] = MovementSource::unavailable($this->type, $this->label);
                continue;
            }
            $date = $record->{$this->dateColumn} ?? null;
            $out[$id] = new MovementSource(
                type: $this->type,
                label: $this->label,
                reference: $record->number !== null ? (string) $record->number : null,
                date: $date ? (string) $date->toDateString() : null,
                status: $record->status !== null ? (string) $record->status : null,
                canOpen: true,
                route: str_replace('{id}', (string) $record->id, $this->routeTemplate),
            );
        }

        return $out;
    }

    private function inScope(Model $record, ?User $user): bool
    {
        if ($user === null) {
            return false;
        }
        if ($this->enforceBranch && $record->getAttribute('branch_id')) {
            $allowed = $user->allowedBranchIds();
            if ($allowed !== null && ! in_array((string) $record->getAttribute('branch_id'), array_map('strval', $allowed), true)) {
                return false;
            }
        }
        if ($this->enforceWarehouse && $record->getAttribute('warehouse_id')) {
            $allowed = $user->allowedWarehouseIds();
            if ($allowed !== null && ! in_array((string) $record->getAttribute('warehouse_id'), array_map('strval', $allowed), true)) {
                return false;
            }
        }

        return true;
    }
}
