<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\DuplicatePrintTemplateRequest;
use App\Http\Requests\ResolvePrintTemplateAssignmentRequest;
use App\Http\Requests\StorePrintTemplateRequest;
use App\Http\Requests\UpdatePrintTemplateDraftRequest;
use App\Http\Requests\UpsertPrintTemplateAssignmentRequest;
use App\Http\Resources\PrintTemplateAssignmentResource;
use App\Http\Resources\PrintTemplateResource;
use App\Models\Branch;
use App\Models\PrintTemplate;
use App\Models\PrintTemplateAssignment;
use App\Services\PrintTemplates\PrintTemplateService;
use Illuminate\Http\JsonResponse;

/**
 * API مكتبة قوالب الطباعة.
 *
 * المتحكم يستقبل ويعيد المورد فقط؛ صحة تعريف القالب، عدم قابلية المراجعة
 * المنشورة للتعديل، وأولوية الفرع/المؤسسة كلها محكومة في الخدمة.
 */
class PrintTemplateController extends ApiController
{
    public function __construct(private readonly PrintTemplateService $templates)
    {
    }

    public function index(): JsonResponse
    {
        return PrintTemplateResource::collection(
            PrintTemplate::with(['publishedRevision', 'draftRevision'])->orderBy('name')->get()
        )->response();
    }

    public function show(string $id): PrintTemplateResource
    {
        return new PrintTemplateResource(
            PrintTemplate::with(['publishedRevision', 'draftRevision', 'revisions' => fn ($q) => $q->orderByDesc('version')])
                ->findOrFail($id)
        );
    }

    /**
     * يعيد المراجعة المنشورة المناسبة لمعاينة مستند حي: تجاوز الفرع أولاً ثم
     * افتراض المؤسسة. لا تنقل الواجهة قاعدة الأولوية إلى العميل ولا تستقبل
     * فرعاً من مستأجر آخر.
     */
    public function resolve(ResolvePrintTemplateAssignmentRequest $request): JsonResponse
    {
        $data = $request->validated();
        $branchId = $data['branch_id'] ?? null;
        $this->assertTenantOwned(Branch::class, $branchId, 'الفرع المحدد');

        $assignment = $this->templates->resolve(
            $data['document_type'],
            $data['usage'] ?? PrintTemplateAssignment::USAGE_PRINT,
            $branchId,
        );

        return response()->json([
            'data' => $assignment === null
                ? null
                : (new PrintTemplateAssignmentResource($assignment))->resolve($request),
        ]);
    }

    public function store(StorePrintTemplateRequest $request): JsonResponse
    {
        $template = $this->domain(fn () => $this->templates->create($request->validated(), $request->user()));

        return (new PrintTemplateResource($template))->response()->setStatusCode(201);
    }

    public function updateDraft(UpdatePrintTemplateDraftRequest $request, string $id): PrintTemplateResource
    {
        $template = PrintTemplate::findOrFail($id);
        $updated = $this->domain(fn () => $this->templates->updateDraft($template, $request->validated(), $request->user()));

        return new PrintTemplateResource($updated);
    }

    public function publish(string $id): PrintTemplateResource
    {
        $template = PrintTemplate::findOrFail($id);
        $published = $this->domain(fn () => $this->templates->publish($template));

        return new PrintTemplateResource($published);
    }

    public function duplicate(DuplicatePrintTemplateRequest $request, string $id): JsonResponse
    {
        $source = PrintTemplate::findOrFail($id);
        $copy = $this->domain(fn () => $this->templates->duplicate($source, $request->validated()['name'], $request->user()));

        return (new PrintTemplateResource($copy))->response()->setStatusCode(201);
    }

    public function assignments(): JsonResponse
    {
        return PrintTemplateAssignmentResource::collection(
            PrintTemplateAssignment::with('revision.template')
                ->orderBy('document_type')
                ->orderBy('usage')
                ->orderBy('branch_id')
                ->get()
        )->response();
    }

    public function assign(UpsertPrintTemplateAssignmentRequest $request): PrintTemplateAssignmentResource
    {
        $assignment = $this->domain(fn () => $this->templates->assign($request->validated(), $request->user()));

        return new PrintTemplateAssignmentResource($assignment);
    }

    /**
     * إزالة تعيين حي صريح؛ لا تحذف القالب أو مراجعته المنشورة، فتظل لقطات
     * المستندات السابقة قابلة للطباعة بلا تغيير.
     */
    public function unassign(ResolvePrintTemplateAssignmentRequest $request): JsonResponse
    {
        $this->domain(fn () => $this->templates->unassign($request->validated()));

        return response()->json(['data' => null]);
    }
}
