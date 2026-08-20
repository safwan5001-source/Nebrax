<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\ReverseManualJournalRequest;
use App\Http\Requests\StoreManualJournalRequest;
use App\Http\Resources\ManualJournalResource;
use App\Models\Account;
use App\Models\CostCenter;
use App\Models\ManualJournal;
use App\Models\Partner;
use App\Services\Accounting\ManualJournalService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ManualJournalController extends ApiController
{
    public function __construct(protected ManualJournalService $journals) {}

    public function index(Request $request): JsonResponse
    {
        $query = ManualJournal::query()->with(['lines.account', 'lines.costCenter'])->latest('entry_date');

        if ($request->filled('status')) {
            $query->where('status', $request->query('status'));
        }

        return ManualJournalResource::collection(
            $this->scopeToActiveBranch($query, $request)->get()
        )->response();
    }

    public function store(StoreManualJournalRequest $request): JsonResponse
    {
        $data = $request->validated();
        $this->assertReferences($data['lines']);

        $journal = $this->domain(fn () => $this->journals->create([
            'entry_date' => $data['entry_date'] ?? null,
            'description' => $data['description'] ?? null,
            'created_by' => $request->user()?->id,
        ], $data['lines']));

        return (new ManualJournalResource($journal))->response()->setStatusCode(201);
    }

    public function show(Request $request, string $id): JsonResponse
    {
        return (new ManualJournalResource(
            $this->visibleJournal($request, $id)->load(['lines.account', 'lines.costCenter', 'journalEntry.lines'])
        ))->response();
    }

    public function update(StoreManualJournalRequest $request, string $id): JsonResponse
    {
        $journal = $this->visibleJournal($request, $id);
        $data = $request->validated();
        $this->assertReferences($data['lines']);

        $updated = $this->domain(fn () => $this->journals->update($journal, $data, $data['lines']));

        return (new ManualJournalResource($updated))->response();
    }

    /** نسخ أي مسودة أو قيد مرحّل إلى مسودة مستقلة، بلا أثر محاسبي حتى الترحيل الجديد. */
    public function duplicate(Request $request, string $id): JsonResponse
    {
        $journal = $this->visibleJournal($request, $id);
        $copy = $this->domain(fn () => $this->journals->duplicate($journal, $request->user()?->id));

        return (new ManualJournalResource($copy))->response()->setStatusCode(201);
    }

    public function destroy(Request $request, string $id): JsonResponse
    {
        $journal = $this->visibleJournal($request, $id);
        $this->domain(fn () => $this->journals->deleteDraft($journal));

        return response()->json(['message' => 'deleted']);
    }

    public function post(Request $request, string $id): JsonResponse
    {
        $journal = $this->visibleJournal($request, $id);
        $posted = $this->domain(fn () => $this->journals->post($journal));

        return (new ManualJournalResource($posted))->response();
    }

    /** العكس محصور في القيود اليدوية؛ المستندات التشغيلية تعالج بعمليات عكس مصادرها. */
    public function reverse(ReverseManualJournalRequest $request, string $id): JsonResponse
    {
        $journal = $this->visibleJournal($request, $id);
        $data = $request->validated();
        $reversed = $this->domain(fn () => $this->journals->reverse(
            $journal,
            $data['entry_date'] ?? null,
            $data['reason']
        ));

        return (new ManualJournalResource($reversed))->response();
    }

    /** القيود اليدوية مستندات محاسبية بلا Scope فرع عالمي؛ التصفح والإجراء يُقيدان صراحةً. */
    private function visibleJournal(Request $request, string $id): ManualJournal
    {
        return $this->scopeToActiveBranch(ManualJournal::query(), $request)->whereKey($id)->firstOrFail();
    }

    /** المراجع في الإنشاء/التعديل يجب أن تكون مرئية وضمن المستأجر، لا مجرد UUID صالحاً. */
    private function assertReferences(array $lines): void
    {
        foreach ($lines as $line) {
            Account::findOrFail($line['account_id']);
            $this->assertTenantOwned(CostCenter::class, $line['cost_center_id'] ?? null, 'مركز التكلفة');
            if (! empty($line['partner_id'])) {
                Partner::findOrFail($line['partner_id']);
            }
        }
    }
}
