<?php

namespace App\Http\Controllers\Api;

use App\Services\AppBuilder\AppTemplateRegistry;
use App\Services\AppBuilder\CompatibilityResolver;
use App\Services\AppBuilder\RuntimeGenerations;
use Illuminate\Http\JsonResponse;

/**
 * AD-11 / S22a — `GET app-builder/templates`: بيانات وصفية للقوالب (بلا المخطط) + `min_runtime` الفعلي المحسوب من الأجيال المعروفة.
 * بيانات منصّة ثابتة لا تخصّ مستأجراً (نفس طبيعة `registries`).
 */
class BuilderTemplateController extends ApiController
{
    public function index(AppTemplateRegistry $templates, RuntimeGenerations $generations, CompatibilityResolver $resolver): JsonResponse
    {
        $data = array_map(function (array $t) use ($generations, $resolver): array {
            $lowest = $generations->lowestRendering($t['schema'], $resolver);

            return [
                'key' => $t['key'],
                'version' => $t['version'],
                'vertical' => $t['vertical'],
                'name' => $t['name'],
                'description' => $t['description'],
                'min_runtime' => $lowest === null ? null : (string) $lowest->runtimeVersion,
            ];
        }, $templates->all());

        return response()->json(['data' => $data]);
    }
}
