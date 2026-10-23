<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\UnitTemplateImportRequest;
use App\Services\ImportPreviewService;
use App\Services\UnitTemplateImportService;
use App\Support\ImportJobDomain;
use Illuminate\Http\JsonResponse;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * استيراد قوالب الوحدات (IMP-H4-S5) — إنشاء فقط، **بلا مسار ذكاء اصطناعي (D-08)** ولا `apply` متزامن. التنفيذ عبر `POST /import-jobs` (مجال `unit_templates`)
 * المربوط بالمعاينة؛ وحدته الملف كله في معاملة واحدة. لا يعدّل قالباً قائماً ولا يلمس أي منتج.
 */
class UnitTemplateImportController extends ApiController
{
    public function __construct(protected UnitTemplateImportService $imports) {}

    public function template(): StreamedResponse
    {
        $content = $this->domain(fn () => $this->imports->template());

        return response()->streamDownload(static fn () => print($content), 'nebrax-unit-templates-import-template.csv', ['Content-Type' => 'text/csv; charset=UTF-8']);
    }

    public function fields(): JsonResponse
    {
        return response()->json(['data' => ['fields' => $this->imports->fieldContract()]]);
    }

    public function inspect(UnitTemplateImportRequest $request): JsonResponse
    {
        $data = $this->domain(fn () => $this->imports->inspect($request->file('file')));

        return response()->json(['data' => $data]);
    }

    public function preview(UnitTemplateImportRequest $request): JsonResponse
    {
        $data = $this->domain(function () use ($request): array {
            $preview = $this->imports->preview($request->file('file'), $request->importOptions());
            // وحدة الملف الذرّية: لا خطّة صفوف (كالمصنّف) — الربط بالملف والخيارات وحدهما.
            $preview['binding'] = app(ImportPreviewService::class)->issue(
                ImportJobDomain::UNIT_TEMPLATES, $request->file('file'), null, $request->importOptions(), $request->user()?->id, null,
            );

            return $preview;
        });

        return response()->json(['data' => $data]);
    }
}
