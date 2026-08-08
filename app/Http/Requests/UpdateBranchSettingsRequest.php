<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class UpdateBranchSettingsRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'main_branch_id'         => ['nullable', 'uuid'],
            'share_customers'        => ['nullable', 'boolean'],
            'share_products'         => ['nullable', 'boolean'],
            'share_suppliers'        => ['nullable', 'boolean'],
            'share_cost_centers'     => ['nullable', 'boolean'],
            'account_branch_scoping' => ['nullable', 'boolean'],
        ];
    }
}
