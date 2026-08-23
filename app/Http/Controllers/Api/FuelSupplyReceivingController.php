<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\ApproveFuelDeliveryRequest;
use App\Http\Requests\StoreFuelDeliveryRequest;
use App\Http\Requests\StoreFuelSupplierInvoiceMatchRequest;
use App\Http\Requests\StoreFuelSupplierInvoiceRequest;
use App\Http\Resources\FuelDeliveryResource;
use App\Http\Resources\FuelSupplierInvoiceMatchResource;
use App\Http\Resources\FuelSupplierInvoiceResource;
use App\Models\FuelDelivery;
use App\Models\FuelSupplierInvoice;
use App\Services\FuelSupplyReceivingService;
use Illuminate\Http\Request;

class FuelSupplyReceivingController extends ApiController
{
    public function __construct(private FuelSupplyReceivingService $service) {}

    public function deliveries(Request $request)
    {
        $query = FuelDelivery::query()->with(['station', 'tank', 'fuelProduct', 'warehouse', 'supplier'])->latest('received_at');
        if ($request->filled('station_id')) {
            $query->where('fuel_station_id', $request->query('station_id'));
        }
        if ($request->filled('status')) {
            $query->where('status', $request->query('status'));
        }

        return FuelDeliveryResource::collection($this->scopeToActiveBranch($query, $request)->paginate(50));
    }

    public function showDelivery(Request $request, string $id)
    {
        $delivery = $this->scopeToActiveBranch(FuelDelivery::query(), $request)->with(['station', 'tank', 'fuelProduct', 'warehouse', 'supplier'])->findOrFail($id);
        return new FuelDeliveryResource($delivery);
    }

    public function storeDelivery(StoreFuelDeliveryRequest $request)
    {
        return $this->domain(fn () => new FuelDeliveryResource($this->service->createDelivery(
            $request->validated() + ['created_by' => $request->user()->id],
        )));
    }

    public function approveDelivery(ApproveFuelDeliveryRequest $request, string $id)
    {
        $delivery = $this->scopeToActiveBranch(FuelDelivery::query(), $request)->findOrFail($id);
        return $this->domain(fn () => new FuelDeliveryResource($this->service->approveDelivery($delivery, $request->user()->id)));
    }

    public function invoices(Request $request)
    {
        $query = FuelSupplierInvoice::query()->with('lines')->latest('invoice_date');
        if ($request->filled('supplier_id')) {
            $query->where('supplier_id', $request->query('supplier_id'));
        }
        if ($request->filled('status')) {
            $query->where('status', $request->query('status'));
        }

        return FuelSupplierInvoiceResource::collection($query->paginate(50));
    }

    public function showInvoice(string $id)
    {
        return new FuelSupplierInvoiceResource(FuelSupplierInvoice::with(['lines', 'matches'])->findOrFail($id));
    }

    public function storeInvoice(StoreFuelSupplierInvoiceRequest $request)
    {
        return $this->domain(fn () => new FuelSupplierInvoiceResource($this->service->createSupplierInvoice(
            $request->validated() + ['created_by' => $request->user()->id],
        )));
    }

    public function matchInvoice(StoreFuelSupplierInvoiceMatchRequest $request, string $id)
    {
        $invoice = FuelSupplierInvoice::findOrFail($id);
        return $this->domain(fn () => new FuelSupplierInvoiceMatchResource(
            $this->service->matchSupplierInvoiceLine($invoice, $request->validated(), $request->user()->id),
        ));
    }
}
