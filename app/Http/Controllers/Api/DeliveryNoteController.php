<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\CancelDeliveryNoteRequest;
use App\Http\Requests\ConfirmDeliveryNoteRequest;
use App\Http\Requests\StoreDeliveryNoteRequest;
use App\Http\Requests\UpdateDeliveryNoteRequest;
use App\Http\Resources\DeliveryNoteResource;
use App\Models\DeliveryNote;
use App\Services\Accounting\DeliveryNoteService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class DeliveryNoteController extends ApiController
{
    public function __construct(protected DeliveryNoteService $deliveryNotes) {}

    public function index(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'status' => ['nullable', 'in:draft,confirmed,cancelled'],
            'customer_id' => ['nullable', 'uuid'],
            'warehouse_id' => ['nullable', 'uuid'],
            'date_from' => ['nullable', 'date'],
            'date_to' => ['nullable', 'date', 'after_or_equal:date_from'],
            'search' => ['nullable', 'string', 'max:120'],
            'sort' => ['nullable', 'in:delivery_date,number,created_at,updated_at'],
            'direction' => ['nullable', 'in:asc,desc'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);

        $query = DeliveryNote::query()->with(['customer', 'warehouse']);
        foreach (['status', 'customer_id', 'warehouse_id'] as $field) {
            if (! empty($validated[$field])) {
                $query->where($field, $validated[$field]);
            }
        }
        if (! empty($validated['date_from'])) {
            $query->whereDate('delivery_date', '>=', $validated['date_from']);
        }
        if (! empty($validated['date_to'])) {
            $query->whereDate('delivery_date', '<=', $validated['date_to']);
        }
        if (! empty($validated['search'])) {
            $search = trim($validated['search']);
            $query->where(function ($nested) use ($search): void {
                $nested->where('number', 'like', "%{$search}%")
                    ->orWhere('external_reference', 'like', "%{$search}%")
                    ->orWhereHas('customer', fn ($customers) => $customers->where('name', 'like', "%{$search}%"));
            });
        }

        $sort = $validated['sort'] ?? 'delivery_date';
        $direction = $validated['direction'] ?? 'desc';
        $paginator = $query->orderBy($sort, $direction)->orderByDesc('created_at')
            ->paginate($validated['per_page'] ?? 25)->withQueryString();

        return DeliveryNoteResource::collection($paginator)->response();
    }

    public function store(StoreDeliveryNoteRequest $request): JsonResponse
    {
        $data = $request->validated();
        $note = $this->domain(fn () => $this->deliveryNotes->create(
            $data + ['created_by' => $request->user()->id],
            $data['items'],
        ));

        return (new DeliveryNoteResource($note))->response()->setStatusCode(201);
    }

    public function show(string $id): JsonResponse
    {
        $note = DeliveryNote::with($this->detailRelations())->findOrFail($id);

        return (new DeliveryNoteResource($note))->response();
    }

    public function update(UpdateDeliveryNoteRequest $request, string $id): JsonResponse
    {
        $note = DeliveryNote::findOrFail($id);
        $data = $request->validated();
        $updated = $this->domain(fn () => $this->deliveryNotes->update(
            $note,
            $data + ['actor_id' => $request->user()->id],
            $data['items'],
            (int) $data['expected_version'],
        ));

        return (new DeliveryNoteResource($updated))->response();
    }

    public function confirm(ConfirmDeliveryNoteRequest $request, string $id): JsonResponse
    {
        $note = DeliveryNote::findOrFail($id);
        $data = $request->validated();
        $confirmed = $this->domain(fn () => $this->deliveryNotes->confirm(
            $note,
            (int) $data['expected_version'],
            $request->user()->id,
            $data['reason'] ?? null,
        ));

        return (new DeliveryNoteResource($confirmed))->response();
    }

    public function cancel(CancelDeliveryNoteRequest $request, string $id): JsonResponse
    {
        $note = DeliveryNote::findOrFail($id);
        $data = $request->validated();
        $cancelled = $this->domain(fn () => $this->deliveryNotes->cancel(
            $note,
            (int) $data['expected_version'],
            $request->user()->id,
            $data['reason'],
        ));

        return (new DeliveryNoteResource($cancelled))->response();
    }

    /** @return array<int,string> */
    private function detailRelations(): array
    {
        return ['customer', 'warehouse', 'lines.product', 'events.actor'];
    }
}
