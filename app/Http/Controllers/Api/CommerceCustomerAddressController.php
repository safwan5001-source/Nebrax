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
 * only ever needs the universal fields. This conditional requiredness is
 * enforced on `store()` only (a brand-new address always has a definite
 * country); `update()` stays a plain partial merge — same shape as
 * `CommerceCheckoutController::updateAddress()` — so changing an address's
 * country to add/drop Saudi-specific requirements means creating a new
 * saved address, not a moving-target PATCH contract.
 */
final class CommerceCustomerAddressController extends PublicApiController
{
    private const SAUDI_REQUIRED_FIELDS = ['district', 'building_no', 'postal_code', 'additional_number'];

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

        // (Codex, PR #929, P1) validateUpdate() only sees this request's own
        // partial payload, so a PATCH that changes country to SA, or clears
        // a required field on an already-Saudi address, previously reached
        // the service unchecked — the write happened regardless, letting an
        // address that violates the advertised Saudi National Address
        // requirement flow into checkout/order snapshots. Validate the
        // *merged* (existing + patched) state instead of the raw patch.
        // Skipped entirely when the address can't be found here — the
        // service's own update() call still surfaces that as "not found"
        // via domainWrite(), unchanged.
        $existing = $addresses->find($customerContext, $id);
        if ($existing !== null) {
            $this->assertSaudiFieldsPresent([
                'country' => $data['country'] ?? $existing->country,
                'district' => array_key_exists('district', $data) ? $data['district'] : $existing->district,
                'building_no' => array_key_exists('building_no', $data) ? $data['building_no'] : $existing->building_no,
                'postal_code' => array_key_exists('postal_code', $data) ? $data['postal_code'] : $existing->postal_code,
                'additional_number' => array_key_exists('additional_number', $data) ? $data['additional_number'] : $existing->additional_number,
            ]);
        }

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
        $this->assertSaudiFieldsPresent($data);

        return $data;
    }

    /** @return array<string, mixed> */
    private function validateUpdate(Request $request): array
    {
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

    /** @param  array<string, mixed>  $data */
    private function assertSaudiFieldsPresent(array $data): void
    {
        if ($data['country'] !== 'SA') {
            return;
        }

        $missing = [];
        foreach (self::SAUDI_REQUIRED_FIELDS as $field) {
            if (! isset($data[$field]) || trim((string) $data[$field]) === '') {
                $missing[] = $field;
            }
        }

        if ($missing !== []) {
            throw ValidationException::withMessages([
                'saudi_national_address' => 'العنوان الوطني السعودي يتطلب: '.implode(', ', $missing).'.',
            ]);
        }
    }
}
