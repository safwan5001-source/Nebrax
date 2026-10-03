<?php

namespace App\Http\Controllers\Api;

use App\Models\CommerceProductPersonalizationField;
use App\Models\Product;
use App\Services\Commerce\ProductPersonalizationService;
use DomainException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * FLOWERS-H4a / ADR-16 — تعريفات التخصيص لمنتج: قراءة (`products.view`) واستبدال
 * ذرّي لمجموعة التعريفات (`products.manage`). `{id}` محدِّد منتج فقط والملكية عبر
 * `TenantScope` (404 غير كاشف). بلا أثر سعري ولا مخزني.
 */
final class CommercePersonalizationController extends ApiController
{
    private const SLUG = 'regex:/^[a-z0-9]+(?:-[a-z0-9]+)*$/';

    public function show(Request $request, ProductPersonalizationService $personalization, string $id): JsonResponse
    {
        $this->denySelfService($request);
        $product = Product::query()->findOrFail($id);

        return response()->json(['data' => ['fields' => $personalization->definitions($product)]]);
    }

    public function replace(Request $request, ProductPersonalizationService $personalization, string $id): JsonResponse
    {
        $this->denySelfService($request);
        $data = $request->validate([
            'fields' => ['present', 'array', 'max:'.ProductPersonalizationService::MAX_FIELDS],
            'fields.*.key' => ['required', 'string', 'max:48', self::SLUG],
            'fields.*.type' => ['required', 'string', Rule::in(CommerceProductPersonalizationField::TYPES)],
            'fields.*.label' => ['required', 'string', 'max:120', 'regex:/\S/'],
            'fields.*.label_en' => ['sometimes', 'nullable', 'string', 'max:120'],
            'fields.*.help_text' => ['sometimes', 'nullable', 'string', 'max:255'],
            'fields.*.is_required' => ['sometimes', 'boolean'],
            'fields.*.max_length' => ['sometimes', 'nullable', 'integer', 'min:1', 'max:'.CommerceProductPersonalizationField::MAX_LENGTH_CEILING],
            'fields.*.is_active' => ['sometimes', 'boolean'],
            'fields.*.options' => ['sometimes', 'array', 'max:'.ProductPersonalizationService::MAX_OPTIONS],
            'fields.*.options.*.value_key' => ['required', 'string', 'max:48', self::SLUG],
            'fields.*.options.*.label' => ['required', 'string', 'max:120', 'regex:/\S/'],
            'fields.*.options.*.label_en' => ['sometimes', 'nullable', 'string', 'max:120'],
            'fields.*.options.*.is_active' => ['sometimes', 'boolean'],
        ]);
        $product = Product::query()->findOrFail($id);

        try {
            $fields = $personalization->replaceDefinitions($product, array_values($data['fields']));
        } catch (DomainException $e) {
            abort(422, $e->getMessage());
        }

        return response()->json(['data' => ['fields' => $fields]]);
    }

    private function denySelfService(Request $request): void
    {
        if ($request->user()?->role === 'self_service') {
            abort(403, 'إدارة التخصيص غير متاحة لحساب الخدمة الذاتية.');
        }
    }
}
