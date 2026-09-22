<?php

namespace App\Http\Controllers\Api;

use App\Http\Resources\CommerceCustomerAddressResource;
use App\Services\Commerce\CommerceCustomerAddressService;
use App\Support\PublicApiResponse;
use App\Tenancy\CustomerContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

/**
 * COM-MOBILE-ADDRESSES-1 (ADR-08) — CRUD over the authenticated customer's own
 * address book. Reached only through the existing `X-Customer-Token`
 * required-auth route group (`AuthenticateCommerceCustomer` +
 * `EstablishCustomerContext`, unmodified) — every address is scoped to
 * `CustomerContext::customerIdentityId()` by `CommerceCustomerAddressService`,
 * never a client-supplied owner.
 *
 * Country-aware validation: Saudi National Address components (district,
 * building number, postal code, secondary/additional number) are required
 * only when `country` is `SA`, never unconditionally — a non-Saudi address
 * only ever needs the universal fields. `update()` validates the *merged*
 * (existing + patched) state, not the raw partial payload, so a PATCH that
 * flips `country` to `SA` or clears a required field can't slip through.
 *
 * (Codex, PR #929, round 2, P2) That merged-state check itself moved into
 * `CommerceCustomerAddressService::create()`/`update()`, running under the
 * per-customer row lock those methods already take before touching any
 * address — reading the existing row here in the controller, outside any
 * lock, let two concurrent PATCHes each validate against a stale snapshot
 * and land a state neither individually would have allowed.
 */
final class CommerceCustomerAddressController extends PublicApiController
{
    public function index(Request $request, CustomerContext $customerContext, CommerceCustomerAddressService $addresses): JsonResponse
    {
        $list = $addresses->list($customerContext);

        return PublicApiResponse::success($request, [
            'data' => CommerceCustomerAddressResource::collection($list)->resolve(),
        ]);
    }

    public function store(Request $request, CustomerContext $customerContext, CommerceCustomerAddressService $addresses): JsonResponse
    {
        $data = $this->validateStore($request);

        $address = $this->domainWrite(fn () => $addresses->create($customerContext, $data));

        return PublicApiResponse::resource($request, new CommerceCustomerAddressResource($address))->setStatusCode(201);
    }

    public function update(Request $request, string $id, CustomerContext $customerContext, CommerceCustomerAddressService $addresses): JsonResponse
    {
        $data = $this->validateUpdate($request);

        $address = $this->domainWrite(fn () => $addresses->update($customerContext, $id, $data));

        return PublicApiResponse::resource($request, new CommerceCustomerAddressResource($address));
    }

    public function destroy(Request $request, string $id, CustomerContext $customerContext, CommerceCustomerAddressService $addresses): JsonResponse
    {
        $this->domainWrite(function () use ($customerContext, $id, $addresses): void {
            $addresses->delete($customerContext, $id);
        });

        return PublicApiResponse::success($request, ['deleted' => true]);
    }

    /** @return array<string, mixed> */
    private function validateStore(Request $request): array
    {
        $this->rejectUnknown($request, [
            'label', 'recipient_name', 'phone', 'country', 'region', 'city', 'district',
            'street', 'building_no', 'additional_number', 'postal_code', 'short_address',
            'latitude', 'longitude', 'delivery_notes', 'is_default_shipping', 'is_default_billing',
        ]);
        $data = $request->validate([
            'label' => ['nullable', 'string', 'max:255'],
            'recipient_name' => ['required', 'string', 'max:255'],
            'phone' => ['required', 'string', 'max:32'],
            'country' => ['required', 'string', 'size:2'],
            'region' => ['nullable', 'string', 'max:255'],
            'city' => ['required', 'string', 'max:255'],
            'district' => ['nullable', 'string', 'max:255'],
            'street' => ['required', 'string', 'max:255'],
            'building_no' => ['nullable', 'string', 'max:32'],
            'additional_number' => ['nullable', 'string', 'max:32'],
            'postal_code' => ['nullable', 'string', 'max:32'],
            'short_address' => ['nullable', 'string', 'max:8'],
            'latitude' => ['nullable', 'numeric', 'between:-90,90'],
            'longitude' => ['nullable', 'numeric', 'between:-180,180'],
            'delivery_notes' => ['nullable', 'string', 'max:1000'],
            'is_default_shipping' => ['sometimes', 'boolean'],
            'is_default_billing' => ['sometimes', 'boolean'],
        ]);

        $data['country'] = strtoupper($data['country']);

        return $data;
    }

    /** @return array<string, mixed> */
    private function validateUpdate(Request $request): array
    {
        $this->rejectUnknown($request, [
            'label', 'recipient_name', 'phone', 'country', 'region', 'city', 'district',
            'street', 'building_no', 'additional_number', 'postal_code', 'short_address',
            'latitude', 'longitude', 'delivery_notes', 'is_default_shipping', 'is_default_billing',
        ]);
        $data = $request->validate([
            'label' => ['sometimes', 'nullable', 'string', 'max:255'],
            'recipient_name' => ['sometimes', 'string', 'max:255'],
            'phone' => ['sometimes', 'string', 'max:32'],
            'country' => ['sometimes', 'string', 'size:2'],
            'region' => ['sometimes', 'nullable', 'string', 'max:255'],
            'city' => ['sometimes', 'string', 'max:255'],
            'district' => ['sometimes', 'nullable', 'string', 'max:255'],
            'street' => ['sometimes', 'string', 'max:255'],
            'building_no' => ['sometimes', 'nullable', 'string', 'max:32'],
            'additional_number' => ['sometimes', 'nullable', 'string', 'max:32'],
            'postal_code' => ['sometimes', 'nullable', 'string', 'max:32'],
            'short_address' => ['sometimes', 'nullable', 'string', 'max:8'],
            'latitude' => ['sometimes', 'nullable', 'numeric', 'between:-90,90'],
            'longitude' => ['sometimes', 'nullable', 'numeric', 'between:-180,180'],
            'delivery_notes' => ['sometimes', 'nullable', 'string', 'max:1000'],
            'is_default_shipping' => ['sometimes', 'boolean'],
            'is_default_billing' => ['sometimes', 'boolean'],
        ]);

        if (array_key_exists('country', $data)) {
            $data['country'] = strtoupper($data['country']);
        }

        return $data;
    }

    /** @param array<int, string> $allowed */
    private function rejectUnknown(Request $request, array $allowed): void
    {
        $unknown = array_values(array_diff(array_keys($request->all()), $allowed));
        if ($unknown !== []) {
            throw ValidationException::withMessages([
                'request' => 'حقول غير مسموحة: '.implode(', ', $unknown),
            ]);
        }
    }
}
