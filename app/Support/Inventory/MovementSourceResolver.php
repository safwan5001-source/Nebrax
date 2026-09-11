<?php

namespace App\Support\Inventory;

use App\Models\InventoryOpening;
use App\Models\Invoice;
use App\Models\Purchase;
use App\Models\ReturnDocument;
use App\Models\StockMovement;
use App\Models\StockPermit;
use App\Models\Stocktake;
use App\Models\User;
use Illuminate\Support\Collection;

final class MovementSourceResolver
{
    /** @var array<string, MovementSourceHandler> */
    private array $handlers;

    /** @param  iterable<MovementSourceHandler>  $handlers */
    public function __construct(iterable $handlers = [])
    {
        $this->handlers = [];
        foreach ($handlers as $handler) {
            $this->register($handler);
        }
        if ($this->handlers === []) {
            foreach (self::defaultHandlers() as $handler) {
                $this->register($handler);
            }
        }
    }

    public static function make(): self
    {
        return new self(self::defaultHandlers());
    }

    public function register(MovementSourceHandler $handler): void
    {
        $this->handlers[$handler->sourceType()] = $handler;
    }

    /**
     * @param  Collection<int, StockMovement>  $movements
     * @return array<string, MovementSource> keyed by movement id
     */
    public function resolveMany(Collection $movements, ?User $user): array
    {
        $grouped = [];
        foreach ($movements as $movement) {
            $type = (string) ($movement->source_type ?? '');
            $id = (string) ($movement->source_id ?? '');
            if ($type === '' || $id === '') {
                continue;
            }
            $grouped[$type][$id][] = $movement->id;
        }

        $bySource = [];
        foreach ($grouped as $type => $idsToMovements) {
            $ids = array_keys($idsToMovements);
            $handler = $this->handlers[$type] ?? null;
            $resolved = $handler ? $handler->resolve($ids, $user) : [];
            foreach ($ids as $id) {
                $bySource[$type][$id] = $resolved[$id] ?? MovementSource::unknown();
            }
        }

        $out = [];
        foreach ($movements as $movement) {
            $type = (string) ($movement->source_type ?? '');
            $id = (string) ($movement->source_id ?? '');
            $out[$movement->id] = ($type === '' || $id === '')
                ? MovementSource::unknown()
                : ($bySource[$type][$id] ?? MovementSource::unknown());
        }

        return $out;
    }

    /** @return list<MovementSourceHandler> */
    private static function defaultHandlers(): array
    {
        return [
            new ClassDocumentHandler(Invoice::class, 'invoice', 'فاتورة مبيعات', '/invoices/{id}', 'invoices.view', 'invoice_date'),
            new ClassDocumentHandler(Purchase::class, 'purchase', 'فاتورة مشتريات', '/purchases/{id}', 'purchases.view', 'purchase_date'),
            new ReturnDocumentHandler(),
            new ClassDocumentHandler(InventoryOpening::class, 'inventory_opening', 'رصيد افتتاحي', '/inventory-openings/{id}', 'products.view', 'opening_date', false, false),
            new ClassDocumentHandler(StockPermit::class, 'stock_permit', 'إذن مخزون', '/stock-permits/{id}', 'products.view', 'permit_date', true, true),
            new ClassDocumentHandler(Stocktake::class, 'stocktake', 'جرد مخزون', '/stocktaking/{id}', 'products.view', 'stocktake_date', true, true),
        ];
    }
}
