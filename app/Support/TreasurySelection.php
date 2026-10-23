<?php

namespace App\Support;

use InvalidArgumentException;

/**
 * الاختيار الذي يمرّره المستدعي إلى `TreasurySelectionResolver` (TREASURY-T3) — قيمة غير قابلة للتعديل.
 *
 *  • `entity($id)`         — معرّف كيان `cash_bank_accounts` (العقد الجديد).
 *  • `ledgerAccount($id)`  — معرّف **حساب الأستاذ** المخزَّن في أعمدة `cash_account_id` القائمة (مدفوعات، فواتير، استردادات…).
 *                            يُحلّ إلى الكيان المربوط به بمفتاح فريد `(tenant_id, account_id)`؛ لا يُخمَّن من رمز الحساب أبداً.
 *  • `none()`              — لم يُختر شيء ⇒ تقرّر السياسة.
 *
 * `null` وحده يعني «غير مُرسَل»؛ نصٌّ فارغ اختيارٌ صريح غير صالح (يُرفض) لا يتحوّل إلى الافتراضي بصمت.
 */
final class TreasurySelection
{
    public const KIND_ENTITY = 'entity';
    public const KIND_LEDGER_ACCOUNT = 'ledger_account';
    public const KIND_NONE = 'none';

    private function __construct(
        public readonly string $kind,
        public readonly ?string $id,
    ) {}

    public static function entity(?string $id): self
    {
        return $id === null ? self::none() : new self(self::KIND_ENTITY, $id);
    }

    public static function ledgerAccount(?string $id): self
    {
        return $id === null ? self::none() : new self(self::KIND_LEDGER_ACCOUNT, $id);
    }

    public static function none(): self
    {
        return new self(self::KIND_NONE, null);
    }

    public function isExplicit(): bool
    {
        return $this->kind !== self::KIND_NONE;
    }

    /** @internal يحرس البنّائين من نوع غير معروف إن أُضيف بنّاء لاحقاً بلا تحديث المحلِّل. */
    public function assertKnown(): void
    {
        if (! in_array($this->kind, [self::KIND_ENTITY, self::KIND_LEDGER_ACCOUNT, self::KIND_NONE], true)) {
            throw new InvalidArgumentException("نوع اختيار الخزينة غير معروف: {$this->kind}");
        }
    }
}
