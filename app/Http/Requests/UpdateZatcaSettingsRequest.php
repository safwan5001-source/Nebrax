<?php

namespace App\Http\Requests;

use App\Services\Accounting\ZatcaCredentialService;
use App\Support\ZatcaIcvScope;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Validator;

class UpdateZatcaSettingsRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'icv_scope'       => ['nullable', 'in:' . implode(',', ZatcaIcvScope::ALL)],
            'submission_mode'   => ['nullable', 'in:manual,automatic'],
            'active_environment' => ['nullable', 'in:' . implode(',', ZatcaCredentialService::ENVIRONMENTS)],
        ];
    }

    /**
     * الحارس على الخادم لا في الواجهة وحدها.
     *
     * تعطيل الخيار في الشاشة يمنع الضغطة لا الطلب. ولأن الضرر هنا لا يظهر
     * وقت الضبط بل وقت التكامل مع الهيئة — بعد أن تكون سلاسل كثيرة قد
     * كُتبت — يُرفض التفعيل هنا صراحةً برسالة تشرح الشرط الناقص.
     */
    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator) {
            if ($this->input('icv_scope') !== ZatcaIcvScope::BRANCH) {
                return;
            }

            $reason = ZatcaIcvScope::unavailableReason();

            if ($reason !== null) {
                $validator->errors()->add('icv_scope', match ($reason) {
                    'no_branch_vat_number' => 'ترقيم ICV لكل فرع يتطلّب رقماً ضريبياً مستقلاً لكل فرع، وهو غير متاح في النظام حالياً.',
                    'icv_index_not_branch_scoped' => 'ترقيم ICV لكل فرع يتطلّب توسيع القيد الفريد للعدّاد ليشمل الفرع أولاً.',
                    default => 'ترقيم ICV لكل فرع غير متاح حالياً.',
                });
            }
        });
    }
}
