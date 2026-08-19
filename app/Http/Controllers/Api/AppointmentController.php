<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\StoreAppointmentRequest;
use App\Http\Resources\AppointmentResource;
use App\Models\Appointment;
use App\Models\Invoice;
use App\Models\Partner;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class AppointmentController extends ApiController
{
    public function index(): JsonResponse
    {
        return AppointmentResource::collection(
            Appointment::with('invoice')->orderByDesc('appointment_at')->get()
        )->response();
    }

    public function store(StoreAppointmentRequest $request): JsonResponse
    {
        $data = $this->prepareData($request->validated(), $request);
        $appointment = Appointment::create($data);

        return (new AppointmentResource($appointment->load('invoice')))->response()->setStatusCode(201);
    }

    public function show(string $id): JsonResponse
    {
        return (new AppointmentResource(Appointment::with('invoice')->findOrFail($id)))->response();
    }

    public function update(StoreAppointmentRequest $request, string $id): JsonResponse
    {
        $appointment = Appointment::findOrFail($id);
        $appointment->update($this->prepareData($request->validated(), $request));

        return (new AppointmentResource($appointment->load('invoice')))->response();
    }

    public function destroy(string $id): JsonResponse
    {
        Appointment::findOrFail($id)->delete();

        return response()->json(['message' => 'تم الحذف.']);
    }

    /** مواعيد فاتورة مرئية ضمن الفرع النشط فقط؛ لا يغيّر العرض أي مستند مالي. */
    public function forInvoice(Request $request, string $id): JsonResponse
    {
        $invoice = $this->scopeToActiveBranch(Invoice::query(), $request)->findOrFail($id);

        return AppointmentResource::collection($invoice->appointments()->with('invoice')->get())->response();
    }

    /**
     * يربط الموعد بالفاتورة المصدر ويمنع حقن عميل يختلف عن عميلها.
     * عند إنشاء موعد من الفاتورة، يكون العميل نتيجة موثقة للفواتير لا اختياراً
     * قابلاً للتغيير في النموذج؛ لذلك تملأه الدالة إن لم يرسله العميل.
     */
    private function prepareData(array $data, Request $request): array
    {
        if (array_key_exists('invoice_id', $data) && $data['invoice_id'] !== null) {
            $invoice = $this->scopeToActiveBranch(Invoice::query(), $request)->findOrFail($data['invoice_id']);

            if (isset($data['partner_id']) && $data['partner_id'] !== $invoice->partner_id) {
                abort(422, 'يجب أن يطابق عميل الموعد عميل الفاتورة المصدر.');
            }

            $data['partner_id'] = $invoice->partner_id;
        }

        if (! empty($data['partner_id'])) {
            Partner::findOrFail($data['partner_id']);
        }

        return $data;
    }
}
