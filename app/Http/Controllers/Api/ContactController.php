<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\StoreContactRequest;
use App\Http\Resources\ContactResource;
use App\Models\Contact;
use App\Models\Partner;
use Illuminate\Http\JsonResponse;

class ContactController extends ApiController
{
    public function index(): JsonResponse
    {
        return ContactResource::collection(Contact::orderBy('name')->get())->response();
    }

    public function store(StoreContactRequest $request): JsonResponse
    {
        $data = $request->validated();
        if (! empty($data['partner_id'])) {
            Partner::findOrFail($data['partner_id']); // عزل: الطرف يخص المستأجر
        }

        $contact = Contact::create($data);

        return (new ContactResource($contact))->response()->setStatusCode(201);
    }

    public function show(string $id): JsonResponse
    {
        return (new ContactResource(Contact::findOrFail($id)))->response();
    }

    public function update(StoreContactRequest $request, string $id): JsonResponse
    {
        $contact = Contact::findOrFail($id);
        $contact->update($request->validated());

        return (new ContactResource($contact))->response();
    }

    public function destroy(string $id): JsonResponse
    {
        Contact::findOrFail($id)->delete();

        return response()->json(['message' => 'تم الحذف.']);
    }
}
