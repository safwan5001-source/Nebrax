<?php
namespace App\Models;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;
class DocumentFileScanExceptionAdmission extends BaseModel {
 use HasUuids; public $incrementing=false; protected $keyType='string'; protected $fillable=['document_file_id','document_batch_id','tenant_id','branch_id','platform_document_file_scan_exception_id','admitted_at']; protected function casts():array{return ['admitted_at'=>'immutable_datetime'];}
 public function file():BelongsTo{return $this->belongsTo(DocumentFile::class,'document_file_id');} public function batch():BelongsTo{return $this->belongsTo(DocumentBatch::class,'document_batch_id');} public function exception():BelongsTo{return $this->belongsTo(PlatformDocumentFileScanException::class,'platform_document_file_scan_exception_id');}
 protected static function booted():void{static::updating(function():void{throw new LogicException('File scan exception admissions are immutable.');});static::deleting(function():void{throw new LogicException('File scan exception admissions are immutable.');});}
}
