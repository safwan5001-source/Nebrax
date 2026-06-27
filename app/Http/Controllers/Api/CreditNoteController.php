<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\StoreCreditNoteRequest;
use App\Http\Resources\CreditNoteResource;
use App\Models\CreditNote;
use App\Models\Partner;
use App\Services\Accounting\CreditNoteService;
use Illuminate\Http\JsonResponse;

class CreditNoteController extends ApiController
{
    public function __construct(protected CreditNoteService $creditNotes) {}

    public function index(): JsonResponse
    {
        return CreditNoteResource::collection(CreditNote::with('lines')->latest()->get())->response();
    }

    public function store(StoreCreditNoteRequest $request): JsonResponse
    {
        $data = $request->validated();
        Partner::findOrFail($data['partner_id']); // عزل: الطرف يخص المستأجر

        $note = $this->domain(fn () => $this->creditNotes->create($data, $data['items']));

        return (new CreditNoteResource($note->load('lines')))->response()->setStatusCode(201);
    }

    public function show(string $id): JsonResponse
    {
        return (new CreditNoteResource(CreditNote::with('lines')->findOrFail($id)))->response();
    }

    public function post(string $id): JsonResponse
    {
        $note = CreditNote::findOrFail($id);
        $posted = $this->domain(fn () => $this->creditNotes->post($note));

        return (new CreditNoteResource($posted->load('lines')))->response();
    }
}
