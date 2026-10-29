<?php

namespace App\Http\Controllers\Api;

use App\Models\ImportMappingPreset;
use App\Services\ImportJobAccess;
use App\Services\ImportMappingPresetService;
use App\Support\ImportJobDomain;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * مطابقات الأعمدة المحفوظة (IMP-H8-S2a): قائمة · حفظ · حذف · تطبيق على عناوين ملف. **لا تكتب شيئاً عدا إعداد المطابقة نفسه**؛ لا ملف ولا صفوف ولا أثر محاسبي.
 * الصلاحية والقدرة **حسب مجال المطابقة** (`ImportJobAccess` — بوابة الإدارة نفسها لتشغيلات ذاك المجال): من لا يستطيع استيراد مجالٍ لا يرى مطابقاته ولا يحفظها.
 */
class ImportMappingPresetController extends ApiController
{
    public function __construct(
        private readonly ImportMappingPresetService $presets,
        private readonly ImportJobAccess $access,
    ) {}

    public function index(Request $request): JsonResponse
    {
        $domain = (string) $request->validate(['domain' => ['required', Rule::in(ImportJobDomain::values())]])['domain'];
        $this->access->assertManage($request, $domain);

        return response()->json(['data' => $this->presets->list($domain)->map(fn (ImportMappingPreset $preset): array => $this->payload($preset))->values()]);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'domain' => ['required', Rule::in(ImportJobDomain::values())],
            'name' => ['required', 'string', 'max:'.ImportMappingPresetService::NAME_MAX],
            'columns' => ['required', 'array', 'min:1', 'max:'.ImportMappingPresetService::MAX_COLUMNS],
            'columns.*.header' => ['nullable', 'string', 'max:'.ImportMappingPresetService::HEADER_MAX],
            'columns.*.field' => ['nullable', 'string', 'regex:/^[a-z][a-z0-9_]{0,63}$/'],
        ]);
        $this->access->assertManage($request, $data['domain']);

        $preset = $this->domain(fn () => $this->presets->create($data['domain'], $data['name'], $data['columns'], $request->user()?->id));

        return response()->json(['data' => $this->payload($preset)], 201);
    }

    public function destroy(Request $request, string $id): JsonResponse
    {
        $preset = ImportMappingPreset::query()->whereKey($id)->firstOrFail();
        $this->access->assertManage($request, $preset->domain);
        $this->presets->delete($preset);

        return response()->json(['data' => ['id' => $id]]);
    }

    public function match(Request $request, string $id): JsonResponse
    {
        $data = $request->validate([
            'headers' => ['required', 'array', 'min:1', 'max:'.ImportMappingPresetService::MAX_COLUMNS],
            'headers.*' => ['nullable', 'string', 'max:'.ImportMappingPresetService::HEADER_MAX],
        ]);
        $preset = ImportMappingPreset::query()->whereKey($id)->firstOrFail();
        $this->access->assertManage($request, $preset->domain);

        return response()->json(['data' => $this->presets->match($preset, array_map(static fn ($header): string => (string) $header, $data['headers']))]);
    }

    /** @return array<string, mixed> */
    private function payload(ImportMappingPreset $preset): array
    {
        return [
            'id' => $preset->id,
            'domain' => $preset->domain,
            'name' => $preset->name,
            'columns' => collect((array) $preset->columns)->map(fn (array $column): array => ['header' => $column['header'], 'field' => $column['field']])->values(),
            'created_at' => $preset->created_at?->toIso8601String(),
        ];
    }
}
