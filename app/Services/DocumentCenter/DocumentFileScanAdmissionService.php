<?php
namespace App\Services\DocumentCenter;
use App\Models\DocumentFile;
use App\Models\DocumentFileScanExceptionAdmission;
use App\Models\PlatformDocumentFileScanException;
use App\Services\PlatformIntegrationResolver;
use App\Support\DocumentScanStatus;
use Illuminate\Support\Facades\DB;
use RuntimeException;
final class DocumentFileScanAdmissionService {
 public function __construct(private readonly PlatformIntegrationResolver $settings){}
 public function authorize(DocumentFile $file):bool{
  if($file->purged_at!==null||in_array($file->scan_status,[DocumentScanStatus::INFECTED,DocumentScanStatus::FAILED],true))return false;
  if($file->scan_status===DocumentScanStatus::CLEAN)return true;
  $batch=$file->batch()->first(); if($batch===null||$batch->tenant_id!==$file->tenant_id||$batch->branch_id!==$file->branch_id)return false;
  $existing=DocumentFileScanExceptionAdmission::query()->where('document_file_id',$file->id)->first(); if($existing!==null)return $existing->tenant_id===$file->tenant_id&&$existing->document_batch_id===$batch->id&&$existing->branch_id===$file->branch_id;
  if($file->scan_status!==DocumentScanStatus::PENDING||$this->settings->activeConfiguration('malware_scanner')!==[])return false;
  $exception=PlatformDocumentFileScanException::query()->where('tenant_id',$file->tenant_id)->latest('granted_at')->get()->first(fn(PlatformDocumentFileScanException $e):bool=>$e->isActive()); if($exception===null)return false;
  DB::transaction(function()use($file,$exception):void{$locked=DocumentFile::query()->whereKey($file->id)->lockForUpdate()->firstOrFail();$batch=$locked->batch()->lockForUpdate()->firstOrFail();if($locked->scan_status!==DocumentScanStatus::PENDING||$batch->tenant_id!==$locked->tenant_id||$batch->branch_id!==$locked->branch_id||$batch->tenant_id!==$exception->tenant_id)throw new RuntimeException('Tenant ownership mismatch; admission denied.');DocumentFileScanExceptionAdmission::query()->firstOrCreate(['document_file_id'=>$locked->id],['document_batch_id'=>$batch->id,'tenant_id'=>$locked->tenant_id,'branch_id'=>$locked->branch_id,'platform_document_file_scan_exception_id'=>$exception->id,'admitted_at'=>now('UTC')]);},3); return true;
 }
}
