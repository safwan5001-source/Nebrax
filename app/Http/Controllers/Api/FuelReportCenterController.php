<?php

namespace App\Http\Controllers\Api;

use App\Services\Reporting\FuelReportEngine;
use App\Services\Reporting\FuelReportExporter;
use App\Support\FuelReportCatalog;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

/**
 * مركز تقارير الوقود: واجهة HTTP رقيقة فوق `FuelReportEngine` (المحرك الوحيد). تستهلكها واجهتا تطبيق المحطة وأَوْج بلا اختلاف.
 * النطاق (محطات المستخدم المتاحة فرعاً/مخزناً/إسناداً + الفرع النشط) يُحسم هنا من سياق المصادقة ويُمرَّر للمحرك؛ لا يُقبل معرّف مستأجر من الطلب.
 * قراءة فقط: لا كتابة في قاعدة البيانات.
 */
class FuelReportCenterController extends ApiController
{
    use AuthorizesFuelStationScope;

    public function __construct(private readonly FuelReportEngine $engine, private readonly FuelReportExporter $exporter) {}

    public function catalog(Request $request): JsonResponse
    {
        return response()->json(['data' => $this->engine->catalog($request->user())])->header('Cache-Control', 'no-store, private');
    }

    public function show(Request $request, string $key): JsonResponse
    {
        return response()->json(['data' => $this->run($request, $key)])->header('Cache-Control', 'no-store, private');
    }

    /**
     * تصدير XLSX/CSV من الحمولة نفسها (نفس التفويض والنطاق وحذف الأعمدة الحسّاسة). يُدقَّق كل تصدير. الملف يُبنى في الذاكرة من ملف مؤقت يُحذف فوراً
     * ويُرسل `no-store, private` بلا حفظ ولا رابط عام.
     */
    public function export(Request $request, string $key): Response
    {
        $data = $request->validate([
            'format' => ['nullable', 'in:xlsx,csv'], 'lang' => ['nullable', 'in:ar,en'], 'table' => ['nullable', 'string', 'max:40'],
        ]);
        $format = $data['format'] ?? 'xlsx';
        $lang = $data['lang'] ?? 'ar';
        $payload = $this->run($request, $key);

        $body = $this->domain(fn () => $format === 'csv' ? $this->exporter->csv($payload, $lang, $data['table'] ?? null) : $this->exporter->xlsx($payload, $lang));
        $this->exporter->audit($request->user(), $payload, $format, $lang);

        return response($body, 200, [
            'Content-Type' => $format === 'csv' ? 'text/csv; charset=UTF-8' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'Content-Disposition' => 'attachment; filename="'.$this->exporter->filename($payload, $lang, $format).'"',
            'Content-Length' => (string) strlen($body),
            'X-Content-Type-Options' => 'nosniff',
            'Cache-Control' => 'no-store, private',
        ]);
    }

    /** تدقيق إجراء طباعة/PDF/مشاركة نُفِّذ في المتصفح (لا بيانات صفوف). 404 لتقرير لا يملك المستخدم صلاحيته. */
    public function audit(Request $request, string $key): JsonResponse
    {
        $definition = FuelReportCatalog::find($key);
        abort_if($definition === null || ! FuelReportCatalog::allows($request->user(), $definition), 404);
        $data = $request->validate(['action' => ['required', 'in:print,pdf,share'], 'filters' => ['nullable', 'array']]);
        $filters = array_intersect_key($data['filters'] ?? [], array_flip($definition->filters));
        $filters = array_filter($filters, fn ($v) => is_scalar($v) && strlen((string) $v) <= 64);
        $this->exporter->auditClientAction($request->user(), $key, $data['action'], $filters);

        return response()->json(['data' => ['recorded' => true]], 201);
    }

    /** @return array<string,mixed> */
    protected function run(Request $request, string $key): array
    {
        return $this->engine->run(
            $request->user(),
            $key,
            $request->query(),
            $this->accessibleStationIds(),
            fn (Builder $query) => $this->scopeToActiveBranch($query, $request),
        );
    }
}
