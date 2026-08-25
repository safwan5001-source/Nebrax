<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\DocumentBatch;
use App\Models\DocumentExtractionResult;
use App\Models\DocumentIssue;
use App\Models\DocumentMatchResult;
use App\Services\DocumentCenter\DocumentReviewService;
use App\Services\DocumentCenter\ReviewedDocumentProjector;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class DocumentReviewController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $batches = DocumentBatch::query()->withCount('files')->latest()->paginate(min(100, max(1, (int) $request->integer('per_page', 25))));
        return response()->json(['data' => $batches->items(), 'meta' => ['current_page' => $batches->currentPage(), 'last_page' => $batches->lastPage()]]);
    }
    public function review(DocumentBatch $batch): JsonResponse
    {
        $result = DocumentExtractionResult::query()->where('document_batch_id', $batch->id)->latest('extracted_at')->firstOrFail();
        return response()->json(['data' => ['batch' => $batch, 'reviewed' => app(ReviewedDocumentProjector::class)->project($result), 'matches' => DocumentMatchResult::query()->where('document_extraction_result_id', $result->id)->with('candidates')->get(), 'issues' => DocumentIssue::query()->where('document_extraction_result_id', $result->id)->get()]]);
    }
    public function change(Request $request, DocumentBatch $batch, DocumentReviewService $service): JsonResponse { $data = $request->validate(['expected_version' => ['required','integer','min:1'], 'target_key' => ['required','string','max:160'], 'value' => ['required'], 'reason' => ['required','string','max:500']]); $result = DocumentExtractionResult::query()->where('document_batch_id', $batch->id)->latest('extracted_at')->firstOrFail(); return response()->json(['data' => $service->change($batch, $result, $data['expected_version'], $data['target_key'], $data['value'], $data['reason'], $request->user()->id)], 201); }
    public function decide(Request $request, DocumentMatchResult $match, DocumentReviewService $service): JsonResponse { $data = $request->validate(['expected_version'=>['required','integer','min:1'],'candidate_id'=>['nullable','uuid'],'reason'=>['required','string','max:500']]); return response()->json(['data'=>$service->decide($match,$data['candidate_id'] ?? null,$request->boolean('confirm'),$data['expected_version'],$data['reason'],$request->user()->id)]); }
    public function issue(Request $request, DocumentIssue $issue, DocumentReviewService $service): JsonResponse { $data=$request->validate(['expected_version'=>['required','integer','min:1'],'reason'=>['required','string','max:500']]); return response()->json(['data'=>$service->issue($issue,$request->boolean('resolve'),$data['expected_version'],$data['reason'],$request->user()->id)]); }
    public function complete(Request $request, DocumentBatch $batch, DocumentReviewService $service): JsonResponse { $data=$request->validate(['expected_version'=>['required','integer','min:1']]); $result=DocumentExtractionResult::query()->where('document_batch_id',$batch->id)->latest('extracted_at')->firstOrFail(); return response()->json(['data'=>$service->complete($batch,$result,$data['expected_version'],$request->user()->id)]); }
}
