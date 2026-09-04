<?php
namespace App\Http\Requests;
use Illuminate\Foundation\Http\FormRequest;
class PlatformDocumentFileScanExceptionRequest extends FormRequest { public function authorize():bool{return true;} public function rules():array{return ['tenant_id'=>['required','uuid','exists:tenants,id'],'reason'=>['required','string','max:500'],'expires_at'=>['nullable','date','after:now'],'current_password'=>['required','string','max:255']];} }
