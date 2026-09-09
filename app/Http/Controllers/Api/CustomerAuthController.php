<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\CustomerLoginRequest;
use App\Http\Requests\CustomerRegisterRequest;
use App\Http\Resources\CustomerIdentityResource;
use App\Models\CustomerIdentity;
use App\Services\CustomerAuthenticationService;
use App\Services\CustomerIdentityService;
use App\Tenancy\CustomerContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class CustomerAuthController extends ApiController
{
    public function register(
        CustomerRegisterRequest $request,
        CustomerIdentityService $identities,
    ): JsonResponse {
        $identities->register($request->validated());

        // Identical for new and existing identifiers. No token is issued until a
        // real production email verification mechanism establishes proof.
        return response()->json([
            'message' => 'إذا كانت البيانات مؤهلة فستصل تعليمات التحقق عبر القناة المعتمدة.',
            'verification_required' => true,
        ], 202);
    }

    public function login(
        CustomerLoginRequest $request,
        CustomerAuthenticationService $authentication,
    ): JsonResponse {
        $result = $authentication->login(
            $request->validated('email'),
            $request->validated('password'),
        );

        return response()->json([
            'token' => $result['token'],
            'customer' => new CustomerIdentityResource($result['identity']),
        ]);
    }

    public function logout(Request $request): JsonResponse
    {
        $request->user()->currentAccessToken()->delete();

        return response()->json(['message' => 'تم تسجيل الخروج.']);
    }

    public function me(Request $request, CustomerContext $customerContext): JsonResponse
    {
        /** @var CustomerIdentity $identity */
        $identity = $request->user();

        return response()->json([
            'customer' => new CustomerIdentityResource($identity),
            'partner_link' => [
                'linked' => $customerContext->hasPartnerLink(),
                'partner_id' => $customerContext->linkedPartnerId(),
            ],
        ]);
    }
}
