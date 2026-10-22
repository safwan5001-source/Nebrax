<?php

namespace App\Services\Accounting;

use App\Models\Account;
use App\Models\CashBankAccount;
use App\Models\User;
use App\Support\ResolvedTreasury;
use App\Support\TreasurySelection;
use App\Support\TreasurySelectionException as Failure;
use App\Support\TreasurySelectionPolicy;
use App\Tenancy\BranchContext;
use Illuminate\Support\Str;
use InvalidArgumentException;

/**
 * عقد اختيار الخزينة/الحساب البنكي الموحَّد للترحيل المالي (TREASURY-T3).
 *
 * **يقرأ فقط**: لا قيد، لا كتابة، لا تهيئة (لا يستدعي `CashBankAccountService::bootstrapDefaults()`)، ولا يعرف شيئاً عن الفواتير أو
 * السندات — يعيد `ResolvedTreasury` يُرحَّل المستدعي على حسابه الدفتري. لم يُربط بأي مسار ترحيل بعد (T4 وما بعدها)؛ يحرس ذلك اختبار ساكن.
 *
 * القواعد (كلها فشل صريح `TreasurySelectionException`، لا بديل صامت):
 *  1. **اختيار صريح** (كيان، أو حساب أستاذ من أعمدة `cash_account_id` القائمة) يتقدّم دائماً: يُحلّ في نطاق المستأجر الحالي وحده —
 *     معرّف مستأجر آخر مثل معرّف غير موجود (`not_found`)؛ ثم النوع المطلوب، ثم الكيان نشط، ثم حسابه الدفتري موجود (للمستأجر نفسه)
 *     ونشط وحركي (غير تجميعي) وأصل. لا يُشتقّ شيء من رمز الحساب ولا من بادئته (111x/112x).
 *  2. **غياب الاختيار** تقرّره `TreasurySelectionPolicy`: `MainOfType` (السلوك القائم) ⇒ الكيان الرئيسي من النوع؛ لا رئيسي ⇒
 *     `ambiguous_default` إن وُجد أكثر من مرشّح نشط وإلا `no_default` — ولا يُرقَّى مرشّح إلى رئيسي. رئيسي معطَّل ⇒ `inactive`
 *     (لا يُستبدل بكيان نشط آخر). `ExplicitRequired` ⇒ `explicit_required`.
 *  3. **التفويض اختياري وصريح**: عند تمرير `$authorize` ('deposit'|'withdraw') يُطبَّق نطاق الكيان نفسه `CashBankAccount::allows()` بفرع
 *     الطلب (`not_permitted`، ويفشل مغلقاً دون فاعل). بدونه لا يُجري المحلِّل تفويضاً — يبقى على المستدعي كما في
 *     `CashBankAccountService::assertAllowed` اليوم؛ لا يُعطي المحلِّل صلاحيةً ولا يتجاوزها.
 *
 * تطابق السلوك القائم (`CashBankAccountService::resolveForPayment`) للحالات المتوافقة مُثبَت باختبار؛ الفرق المقصود: لا تهيئة ضمنية،
 * أخطاء مميَّزة برمز، وفحص حساب الأستاذ الدفتري صراحةً.
 */
class TreasurySelectionResolver
{
    private const TYPES = ['cash', 'bank'];
    private const ACTIONS = ['deposit', 'withdraw'];

    public function resolve(
        TreasurySelection $selection,
        string $type,
        TreasurySelectionPolicy $policy = TreasurySelectionPolicy::MainOfType,
        ?string $authorize = null,
        ?User $actor = null,
    ): ResolvedTreasury {
        if (! in_array($type, self::TYPES, true)) {
            throw new InvalidArgumentException("نوع الخزينة المطلوب غير معروف: {$type}");
        }
        if ($authorize !== null && ! in_array($authorize, self::ACTIONS, true)) {
            throw new InvalidArgumentException("نوع التفويض غير معروف: {$authorize}");
        }
        $selection->assertKnown();

        $viaDefault = ! $selection->isExplicit();
        // معرّف صريح ليس UUID (نص فارغ، رمز حساب «1110»…) ⇒ غير موجود، لا استعلام ولا خطأ قاعدة بيانات ولا تخمين من الرمز.
        if ($selection->isExplicit() && ! Str::isUuid((string) $selection->id)) {
            throw Failure::for(Failure::NOT_FOUND);
        }
        $entity = match ($selection->kind) {
            TreasurySelection::KIND_ENTITY => CashBankAccount::query()->find($selection->id),
            TreasurySelection::KIND_LEDGER_ACCOUNT => CashBankAccount::query()->where('account_id', $selection->id)->first(),
            default => $this->defaultFor($type, $policy),
        };

        if (! $entity) {
            throw Failure::for(Failure::NOT_FOUND);
        }
        if ($entity->type !== $type) {
            throw Failure::for(Failure::WRONG_TYPE);
        }
        if (! $entity->is_active) {
            throw Failure::for(Failure::INACTIVE);
        }

        // حساب الأستاذ يُقرأ في نطاق المستأجر الحالي: ربطٌ بحساب مستأجر آخر (بيانات تالفة) يظهر مفقوداً لا يُستعمل.
        $account = Account::query()->find($entity->account_id);
        if (! $account) {
            throw Failure::for(Failure::GL_ACCOUNT_MISSING);
        }
        if (! $account->is_active) {
            throw Failure::for(Failure::GL_ACCOUNT_INACTIVE);
        }
        if ($account->is_group || $account->type !== 'asset') {
            throw Failure::for(Failure::GL_ACCOUNT_INVALID);
        }

        if ($authorize !== null && ! $entity->allows($authorize, $actor, app(BranchContext::class)->id())) {
            throw Failure::for(Failure::NOT_PERMITTED);
        }

        $entity->setRelation('account', $account);

        return new ResolvedTreasury(
            entity: $entity,
            entityId: (string) $entity->id,
            accountId: (string) $account->id,
            type: (string) $entity->type,
            name: (string) $entity->name,
            currency: (string) $entity->currency,
            viaDefault: $viaDefault,
        );
    }

    /** الافتراضي عند غياب الاختيار الصريح — لا يُرقّي مرشّحاً ولا يستبدل رئيسياً معطَّلاً. */
    private function defaultFor(string $type, TreasurySelectionPolicy $policy): CashBankAccount
    {
        if ($policy === TreasurySelectionPolicy::ExplicitRequired) {
            throw Failure::for(Failure::EXPLICIT_REQUIRED);
        }

        $candidates = CashBankAccount::query()->where('type', $type)->get();
        $mains = $candidates->where('is_main', true);

        if ($mains->count() === 1) {
            return $mains->first();
        }
        // فهرس فريد يمنع أكثر من رئيسي لنوع، لكن بيانات تالفة لا تُحسم بالتخمين.
        if ($mains->count() > 1) {
            throw Failure::for(Failure::AMBIGUOUS_DEFAULT);
        }

        throw Failure::for($candidates->where('is_active', true)->count() > 1 ? Failure::AMBIGUOUS_DEFAULT : Failure::NO_DEFAULT);
    }
}
