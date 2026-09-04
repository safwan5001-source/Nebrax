<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\PlatformDocumentFileScanExceptionRequest;
use App\Models\PlatformAdministrator;
use App\Models\PlatformAdministratorAction;
use App\Models\PlatformDocumentFileScanException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class PlatformDocumentFileScanExceptionController extends ApiController
{
    public function index(): JsonResponse
    {
        return response()->json(['data' => PlatformDocumentFileScanException::query()->with('tenant:id,name')->latest('granted_at')->get()->map(fn ($e) => $this->payload($e))->values()]);
    }

    public function store(PlatformDocumentFileScanExceptionRequest $request): JsonResponse
    {
        /** @var PlatformAdministrator $admin */
        $admin = $request->user();
        $data = $request->validated();
        $this->assertPassword($admin, $data['current_password']);
        $exception = PlatformDocumentFileScanException::query()->create([
            'tenant_id' => $data['tenant_id'], 'reason' => trim($data['reason']), 'granted_by' => $admin->id,
            'granted_at' => now('UTC'), 'expires_at' => $data['expires_at'] ?? null,
        ]);
        PlatformAdministratorAction::query()->create([
            'id' => (string) Str::uuid(), 'platform_administrator_id' => $admin->id, 'tenant_id' => $exception->tenant_id,
            'action' => PlatformAdministratorAction::ACTION_FILE_SCAN_EXCEPTION_GRANTED,
            'from_value' => null, 'to_value' => json_encode(['reason' => $exception->reason, 'expires_at' => $exception->expires_at?->toIso8601String()], JSON_THROW_ON_ERROR),
        ]);
        return response()->json(['data' => $this->payload($exception->load('tenant:id,name'))], 201);
    }

    public function revoke(PlatformDocumentFileScanException $exception, Request $request): JsonResponse
    {
        /** @var PlatformAdministrator $admin */
        $admin = $request->user();
        $data = $request->validate(['reason' => ['required', 'string', 'max:500'], 'current_password' => ['required', 'string', 'max:255']]);
        $this->assertPassword($admin, $data['current_password']);
        if ($exception->revoked_at === null) {
            $exception->revoked_at = now('UTC'); $exception->revoked_by = $admin->id; $exception->revocation_reason = trim($data['reason']); $exception->saveQuietly();
            PlatformAdministratorAction::query()->create([
                'id' => (string) Str::uuid(), 'platform_administrator_id' => $admin->id, 'tenant_id' => $exception->tenant_id,
                'action' => PlatformAdministratorAction::ACTION_FILE_SCAN_EXCEPTION_REVOKED,
                'from_value' => json_encode(['reason' => $exception->reason, 'expires_at' => $exception->expires_at?->toIso8601String()], JSON_THROW_ON_ERROR),
                'to_value' => json_encode(['reason' => $exception->revocation_reason, 'revoked_at' => $exception->revoked_at->toIso8601String()], JSON_THROW_ON_ERROR),
            ]);
        }
        return response()->json(['data' => $this->payload($exception->fresh('tenant:id,name'))]);
    }

    private function assertPassword(PlatformAdministrator $admin, string $password): void
    {
        if (! Hash::check($password, $admin->password)) throw ValidationException::withMessages(['current_password' => 'كلمة مرور مدير المنصة غير صحيحة.']);
    }

    private function payload(PlatformDocumentFileScanException $e): array
    {
        return ['id' => $e->id, 'tenant_id' => $e->tenant_id, 'tenant_name' => $e->tenant?->name, 'reason' => $e->reason, 'granted_at' => $e->granted_at?->toIso8601String(), 'expires_at' => $e->expires_at?->toIso8601String(), 'revoked_at' => $e->revoked_at?->toIso8601String(), 'status' => $e->revoked_at ? 'revoked' : ($e->isActive() ? 'active' : 'expired')];
    }
}
