<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\PartnerStatementImportRequest;
use App\Http\Requests\PartnerStatementInspectRequest;
use App\Services\ImportPreviewService;
use App\Services\PartnerStatementImportService;
use App\Support\ImportJobDomain;
use Illuminate\Http\JsonResponse;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * استيراد كشف حساب طرف (IMP-PS-A1): قالب · عقد الحقول · فحص · معاينة. الطرف/الدور/الفترة/السياسات خيارات مجمَّدة للتشغيلة. **بلا `apply` متزامن**: التنفيذ عبر `POST /import-jobs`
 * (مجال `partner_statement`) المربوط بمعاينةٍ أحادية الاستعمال. يكتب جداول تجهيز المقارنة وحدها — لا قيد ولا مستند ولا رصيد.
 */
class PartnerStatementImportController extends ApiController
{
    public function __construct(protected PartnerStatementImportService $imports) {}

    public function template(): StreamedResponse
    {
        $content = $this->domain(fn () => $this->imports->template());

        return response()->streamDownload(static fn () => print($content), 'nebrax-partner-statement-import-template.csv', ['Content-Type' => 'text/csv; charset=UTF-8']);
    }

    public function fields(): JsonResponse
    {
        return response()->json(['data' => ['fields' => $this->imports->fieldContract(), 'directions' => \App\Support\PartnerStatementImportFields::DIRECTIONS]]);
    }

    /** يقرأ الملف وحده ولا يقرأ بيانات أي طرف (لا حاجة إلى الطرف لفحص الأعمدة). */
    public function inspect(PartnerStatementInspectRequest $request): JsonResponse
    {
        $data = $this->domain(fn () => $this->imports->inspect($request->file('file')));

        return response()->json(['data' => $data]);
    }

    public function preview(PartnerStatementImportRequest $request): JsonResponse
    {
        $data = $this->domain(function () use ($request): array {
            $options = $request->importOptions();
            $preview = $this->imports->preview($request->file('file'), $options, $request->user()?->id);
            // وحدة الملف الذرّية: لا خطّة صفوف — الربط بالملف والخيارات القانونية وحدها (التطبيق يعيد التحقق كاملاً).
            $preview['binding'] = app(ImportPreviewService::class)->issue(
                ImportJobDomain::PARTNER_STATEMENT, $request->file('file'), null, $options, $request->user()?->id, null,
            );

            return $preview;
        });

        return response()->json(['data' => $data]);
    }
}
