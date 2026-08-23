<?php

namespace App\Http\Controllers\Api;

use App\Support\DocumentNumberingCatalog;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use InvalidArgumentException;

/** يعيد الرقم المتوقع للعرض في النماذج؛ لا يخصص رقماً ولا يغير أي عداد. */
class NumberPreviewController extends ApiController
{
    public function show(Request $request): JsonResponse
    {
        $data = $request->validate([
            'key'        => ['required', 'string', 'in:'.implode(',', array_keys(DocumentNumberingCatalog::ENTITIES))],
            'series_key' => ['nullable', 'string', 'max:64'],
            'date'       => ['nullable', 'date_format:Y-m-d'],
        ]);

        try {
            return response()->json([
                'data' => DocumentNumberingCatalog::preview(
                    $data['key'],
                    $data['series_key'] ?? null,
                    $data['date'] ?? null,
                ),
            ]);
        } catch (InvalidArgumentException $exception) {
            abort(422, $exception->getMessage());
        }
    }
}
