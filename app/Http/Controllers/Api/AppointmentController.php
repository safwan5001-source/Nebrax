<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\StoreAppointmentRequest;
use App\Http\Resources\AppointmentResource;
use App\Models\Appointment;
use App\Models\Partner;
use Illuminate\Http\JsonResponse;

class AppointmentController extends ApiController
{
    public function index(): JsonResponse
    {
        return AppointmentResource::collection(
            Appointment::orderByDesc('appointment_at')->get()
        )->response();
    }

    public function store(StoreAppointmentRequest $request): JsonResponse
    {
        $data = $request->validated();
        if (! empty($data['partner_id'])) {
            Partner::findOrFail($data['partner_id']); // عزل: الطرف يخص المستأجر
        }

        $appointment = Appointment::create($data);

        return (new AppointmentResource($appointment))->response()->setStatusCode(201);
    }

    public function show(string $id): JsonResponse
    {
        return (new AppointmentResource(Appointment::findOrFail($id)))->response();
    }

    public function update(StoreAppointmentRequest $request, string $id): JsonResponse
    {
        $appointment = Appointment::findOrFail($id);
        $appointment->update($request->validated());

        return (new AppointmentResource($appointment))->response();
    }

    public function destroy(string $id): JsonResponse
    {
        Appointment::findOrFail($id)->delete();

        return response()->json(['message' => 'تم الحذف.']);
    }
}
