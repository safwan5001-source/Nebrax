<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\ImportInventoryOpeningRequest;
use App\Http\Resources\InventoryOpeningResource;
use App\Models\InventoryOpening;
use App\Services\Accounting\InventoryOpeningService;
use App\Services\InventoryOpeningImportService;
use App\Support\Money;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * الأرصدة الافتتاحية للمخزون — استيراد ملف إلى مسودة، ثم ترحيلٌ صريح.
 *
 * الترحيل **فعلٌ منفصل بمسار مستقلّ**: رفع الملف لا يفتح رصيداً بالخطأ، ويبقى
 * بين الرفع والأثر المحاسبي قرارٌ بشريّ يراجع المسودة.
 */
class InventoryOpeningController extends ApiController
{
    public function __construct(
        protected InventoryOpeningImportService $imports,
        protected InventoryOpeningService $openings
    ) {}

    public function index(Request $request): JsonResponse
    {
        $request->validate(['status' => ['nullable', 'in:draft,posted']]);

        // المستند `CompanyWide` عمداً (يضمّ مخازن فروع متعددة) فلا تصفية بالفرع
        // النشط هنا: إخفاؤه عن فرعٍ كان سيخفي أرصدته الافتتاحية عن صاحبها.
        $query = InventoryOpening::withCount('lines')->latest();
        if ($status = $request->query('status')) {
            $query->where('status', $status);
        }

        return InventoryOpeningResource::collection($query->get())->response();
    }

    public function show(string $id): JsonResponse
    {
        $opening = InventoryOpening::with(['lines.product', 'lines.warehouse'])->findOrFail($id);

        return (new InventoryOpeningResource($opening))->response();
    }

    /** قالب CSV فارغ بترويسة عربية. */
    public function template(): StreamedResponse
    {
        $content = $this->imports->template();

        return response()->streamDownload(
            static fn () => print($content),
            'nebrax-inventory-opening-template.csv',
            ['Content-Type' => 'text/csv; charset=UTF-8']
        );
    }

    /** عقد الحقول — تستهلكه شاشة مطابقة الأعمدة. */
    public function fields(): JsonResponse
    {
        return response()->json(['data' => ['fields' => $this->imports->fieldContract()]]);
    }

    /** فحص الملف: أعمدته وعيّناته ومطابقتها المقترحة. لا كتابة. */
    public function inspect(ImportInventoryOpeningRequest $request): JsonResponse
    {
        $data = $this->domain(fn () => $this->imports->inspect($request->file('file')));

        return response()->json(['data' => $data]);
    }

    /** معاينة: عدّادات وحالة كل صف. **لا كتابة إطلاقاً.** */
    public function preview(ImportInventoryOpeningRequest $request): JsonResponse
    {
        $data = $this->domain(
            fn () => $this->imports->preview($request->file('file'), $request->importOptions())
        );

        return response()->json(['data' => $this->presentPreview($data)]);
    }

    /** إنشاء مسودة من ملف اجتاز التحقق. لا حركة ولا قيد بعد. */
    public function apply(ImportInventoryOpeningRequest $request): JsonResponse
    {
        $opening = $this->domain(fn () => $this->imports->apply(
            $request->file('file'),
            $request->importOptions(),
            $request->user()?->id
        ));

        return (new InventoryOpeningResource($opening->load(['lines.product', 'lines.warehouse'])))
            ->response()->setStatusCode(201);
    }

    /** الترحيل: حركات + متوسط + أرصدة مخازن + قيدٌ واحد، في معاملة واحدة. */
    public function post(string $id): JsonResponse
    {
        $opening = InventoryOpening::findOrFail($id);
        $posted = $this->domain(fn () => $this->openings->post($opening, request()->user()?->id));

        return (new InventoryOpeningResource($posted->load(['lines.product', 'lines.warehouse'])))->response();
    }

    public function destroy(string $id): JsonResponse
    {
        $opening = InventoryOpening::findOrFail($id);
        $this->domain(fn () => $this->openings->deleteDraft($opening));

        return response()->json(['message' => 'تم الحذف.']);
    }

    /**
     * تحويل المبالغ إلى ريالٍ بشريّ في **طبقة العرض وحدها** — كما تفعل موارد
     * المستندات الأخرى. الخدمة تبقى بالهللات، وهي مصدر الحقيقة.
     *
     * @param  array<string, mixed>  $preview
     * @return array<string, mixed>
     */
    private function presentPreview(array $preview): array
    {
        $preview['counters']['total_value'] = Money::toRiyal((int) $preview['counters']['total_value']);

        $preview['rows'] = array_map(static function (array $row): array {
            $row['unit_cost'] = $row['unit_cost'] === null ? null : Money::toRiyal((int) $row['unit_cost']);
            $row['total_cost'] = $row['total_cost'] === null ? null : Money::toRiyal((int) $row['total_cost']);

            return $row;
        }, $preview['rows']);

        return $preview;
    }
}
