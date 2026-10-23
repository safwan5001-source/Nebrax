<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\PartnerImportRequest;
use App\Services\ImportPreviewService;
use App\Services\PartnerImportService;
use App\Support\ImportJobDomain;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * استيراد العملاء والموردين (IMP-H3-S2): قالب · عقد الحقول · فحص · معاينة. **بلا `apply` متزامن** (القاعدة 10): التنفيذ عبر
 * `POST /import-jobs` (مجال `partner_master`) المربوط بمعاينةٍ أحادية الاستعمال تصدرها `preview` هنا. لا يلمس الأستاذ ولا يقبل رصيداً افتتاحياً (D-01).
 */
class PartnerImportController extends ApiController
{
    public function __construct(protected PartnerImportService $imports) {}

    /** قالب CSV بترويسة عربية وسطرَي مثال — النوع يحدّده المدخل لا الملف. */
    public function template(Request $request): StreamedResponse
    {
        $type = $this->typeOrFail($request);
        $content = $this->domain(fn () => $this->imports->template($type));

        return response()->streamDownload(
            static fn () => print($content),
            "nebrax-{$type}s-import-template.csv",
            ['Content-Type' => 'text/csv; charset=UTF-8']
        );
    }

    /** عقد الحقول — تستهلكه شاشة مطابقة الأعمدة. */
    public function fields(): JsonResponse
    {
        return response()->json(['data' => ['fields' => $this->imports->fieldContract()]]);
    }

    /** فحص الملف: أعمدته وعيّناته ومطابقتها المقترحة. لا كتابة. */
    public function inspect(PartnerImportRequest $request): JsonResponse
    {
        $data = $this->domain(fn () => $this->imports->inspect($request->file('file')));

        return response()->json(['data' => $data]);
    }

    /** معاينة: عدّادات وحالة كل صف. **لا كتابة إطلاقاً.** تُصدِر ربطاً أحادي الاستعمال للتشغيلة الدائمة. */
    public function preview(PartnerImportRequest $request): JsonResponse
    {
        $data = $this->domain(function () use ($request): array {
            ['preview' => $preview, 'plan' => $plan] = $this->imports->previewWithPlan($request->file('file'), $request->importOptions());
            $preview['binding'] = app(ImportPreviewService::class)->issue(
                ImportJobDomain::PARTNER_MASTER, $request->file('file'), null, $request->importOptions(), $request->user()?->id, $plan,
            );

            return $preview;
        });

        return response()->json(['data' => $data]);
    }

    private function typeOrFail(Request $request): string
    {
        $type = $request->validate(['type' => ['required', 'in:'.implode(',', PartnerImportService::TYPES)]])['type'];

        return (string) $type;
    }
}
