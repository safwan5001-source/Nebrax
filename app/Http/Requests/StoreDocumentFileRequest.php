<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StoreDocumentFileRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            // هذه بوابة أولية فقط؛ DocumentFileInspector يعيد فحص bytes وMIME والأبعاد والصفحات.
            'file' => [
                'required',
                'file',
                'max:' . (int) config('document_center.intake.max_file_kilobytes', 20480),
                'mimes:pdf,jpg,jpeg,png,webp',
            ],
        ];
    }
}
