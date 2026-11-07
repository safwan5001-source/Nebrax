<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/** استبدال كامل لمحتوى المسودة. `costs` غائبة ⇒ تبقى التكاليف القائمة. المحطة لا تتغيّر. */
class UpdateFuelOpeningBalanceRequest extends FormRequest
{
    public function authorize(): bool
    {
        abort_unless(\App\Services\FuelOpeningBalanceService::enabled(), 404);

        return true;
    }

    public function rules(): array
    {
        $rules = (new StoreFuelOpeningBalanceRequest())->rules();
        unset($rules['fuel_station_id'], $rules['idempotency_key']);

        return $rules;
    }
}
