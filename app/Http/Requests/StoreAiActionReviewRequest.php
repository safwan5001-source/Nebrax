<?php
namespace App\Http\Requests;
use App\Support\UserRequestIdempotency;
use Illuminate\Foundation\Http\FormRequest;
class StoreAiActionReviewRequest extends FormRequest {
    protected function prepareForValidation(): void { $this->merge(['idempotency_key' => $this->header('Idempotency-Key')]); }
    public function authorize(): bool { return true; }
    public function rules(): array { return ['idempotency_key' => ['required','string','regex:'.UserRequestIdempotency::KEY_PATTERN], 'expected_version' => ['required','integer','min:1'], 'edits' => ['required','array','min:1','max:200'], 'edits.*.row_id' => ['required','string','max:128'], 'edits.*.fields' => ['required','array','min:1','max:24']]; }
}
