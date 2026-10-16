<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/**
 * سقف إنفاق المساعد الذكي (AI-02A) — صف لكل (فترة شهرية UTC × global | tenant).
 *
 * **ليس نموذج أعمال مستأجر** عمداً (لا `BaseModel`): الصف العالمي مملوك للمنصة ولا `tenant_id` له،
 * وصف المستأجر تضبطه المنصة لا المستأجر نفسه. لا مسار API يكتبه؛ الكتابة الوحيدة عبر
 * `AiBudgetService`. العدّادات تُحدَّث بجمل UPDATE شرطية ذرّية لا بحفظ النموذج.
 */
class AiBudget extends Model
{
    use HasUuids;

    public $incrementing = false;

    protected $keyType = 'string';

    protected $fillable = ['budget_key', 'tenant_id', 'period', 'cap_tokens', 'cap_cost_micro_usd'];

    protected $casts = [
        'cap_tokens' => 'integer',
        'cap_cost_micro_usd' => 'integer',
        'reserved_tokens' => 'integer',
        'used_tokens' => 'integer',
        'reserved_cost_micro_usd' => 'integer',
        'used_cost_micro_usd' => 'integer',
    ];
}
