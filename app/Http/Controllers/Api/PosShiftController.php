<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\StorePosShiftRequest;
use App\Http\Resources\PosShiftResource;
use App\Models\PosShift;
use Illuminate\Http\JsonResponse;
use Illuminate\Validation\ValidationException;

class PosShiftController extends ApiController
{
    public function index(): JsonResponse
    {
        return PosShiftResource::collection(PosShift::orderBy('name')->get())->response();
    }

    public function store(StorePosShiftRequest $request): JsonResponse
    {
        $data = $this->payload($request->validated());
        $this->assertCodeAvailable($data['code']);
        $shift = PosShift::create($data);

        return (new PosShiftResource($shift))->response()->setStatusCode(201);
    }

    public function update(StorePosShiftRequest $request, string $id): JsonResponse
    {
        $shift = PosShift::findOrFail($id);
        $data = $this->payload($request->validated());
        $this->assertCodeAvailable($data['code'], $shift->id);
        $shift->update($data);

        return (new PosShiftResource($shift))->response();
    }

    public function destroy(string $id): JsonResponse
    {
        $shift = PosShift::findOrFail($id);
        if ($shift->sessions()->exists()) {
            return response()->json([
                'message' => 'لا يمكن حذف وردية نقاط بيع مرتبطة بجلسات. عطّلها بدلاً من ذلك.',
            ], 422);
        }

        $shift->delete();

        return response()->json(['message' => 'تم حذف وردية نقاط البيع.']);
    }

    /** @param array<string,mixed> $data @return array<string,mixed> */
    private function payload(array $data): array
    {
        $code = trim((string) ($data['code'] ?? ''));
        $description = trim((string) ($data['description'] ?? ''));

        return [
            'name' => trim($data['name']),
            'code' => $code !== '' ? mb_strtoupper($code) : null,
            'description' => $description !== '' ? $description : null,
            'is_active' => $data['is_active'] ?? true,
        ];
    }

    private function assertCodeAvailable(?string $code, ?string $ignoreId = null): void
    {
        if ($code === null) {
            return;
        }

        $query = PosShift::where('code', $code);
        if ($ignoreId !== null) {
            $query->where('id', '!=', $ignoreId);
        }

        if ($query->exists()) {
            throw ValidationException::withMessages([
                'code' => ['رمز وردية نقاط البيع مستخدم بالفعل في الفرع النشط.'],
            ]);
        }
    }
}
