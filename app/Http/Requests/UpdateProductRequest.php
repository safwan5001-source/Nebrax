<?php

namespace App\Http\Requests;

/**
 * تعديل منتج — كقواعد الإنشاء، عدا `initial_quantity`.
 *
 * نفس عِلّة `UpdatePartnerRequest` حرفياً: الكمية الابتدائية ليست عموداً في
 * `products`؛ يستهلكها `InventoryService::recordOpeningStock` عند الإنشاء
 * فتولّد قيد رصيد افتتاحي (مدين 1140 المخزون / دائن 3130) وحركة مخزون.
 * عند التعديل كانت تسقط صامتاً، فيظنّ المستخدم أنه عدّل مخزوناً افتتاحياً.
 *
 * تعديل الكميات يكون بحركة مخزون (استلام/إخراج/تسوية) لا بتحرير حقل.
 */
class UpdateProductRequest extends StoreProductRequest
{
    public function rules(): array
    {
        return array_merge(parent::rules(), [
            'initial_quantity' => ['prohibited'],
        ]);
    }

    public function messages(): array
    {
        return [
            'initial_quantity.prohibited' => 'الكمية الابتدائية تُسجَّل عند إنشاء المنتج وتولّد قيداً مرحّلاً — لا تُعدَّل من هنا. استخدم حركة مخزون (استلام أو تسوية).',
        ];
    }
}
