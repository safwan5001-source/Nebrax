<?php
namespace App\Models;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use LogicException;
class PlatformDocumentFileScanException extends Model {
 use HasUuids; public $incrementing=false; protected $keyType='string';
 protected $fillable=['tenant_id','reason','granted_by','granted_at','expires_at','revoked_at','revoked_by','revocation_reason'];
 protected function casts(): array{return ['granted_at'=>'immutable_datetime','expires_at'=>'immutable_datetime','revoked_at'=>'immutable_datetime'];}
 public function tenant(): BelongsTo{return $this->belongsTo(Tenant::class);} public function admissions(): HasMany{return $this->hasMany(DocumentFileScanExceptionAdmission::class,'platform_document_file_scan_exception_id');}
 public function isActive(?\DateTimeInterface $at=null): bool{$at??=now('UTC');return $this->revoked_at===null&&($this->expires_at===null||$this->expires_at->gt($at));}
 protected static function booted():void{static::updating(function():void{throw new LogicException('File scan exceptions are append-only.');});static::deleting(function():void{throw new LogicException('File scan exceptions are append-only.');});}
}
