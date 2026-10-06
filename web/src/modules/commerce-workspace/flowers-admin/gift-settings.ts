/**
 * FLOWERS-H2-1 / ADR-15 — عميل سياسة الإهداء لقناة المتجر (`gift-settings`).
 *
 * الخادم سلطة القيم والحدود؛ هذا العميل يعكس السقف (500) لرسالة تحقّق مبكرة فقط. لا حقول جديدة: الحقول
 * الأربعة المدعومة اليوم حرفياً. كل كتابة تُرسل الحقول الأربعة كاملةً فلا يتغيّر شيء مخزَّن بالإيقاف وحده.
 */

import { api } from '@/lib/api';
import { adminCall, bool, num, obj, storePath, type AdminResult } from './admin-http';

/** مرآة `CommerceGiftSetting::MAX_LENGTH_CEILING` / `DEFAULT_MAX_LENGTH`. */
export const GIFT_MESSAGE_MAX_CEILING = 500;
export const GIFT_MESSAGE_DEFAULT_LENGTH = 250;

export type GiftPolicy = {
  enabled: boolean;
  messageMaxLength: number;
  allowHideSender: boolean;
  recipientPhoneRequired: boolean;
};

export function mapGiftPolicy(payload: unknown): GiftPolicy | null {
  const row = obj(obj(obj(payload)?.data)?.gift_settings);
  if (!row || typeof row.enabled !== 'boolean') return null;
  const length = num(row.message_max_length, GIFT_MESSAGE_DEFAULT_LENGTH);

  return {
    enabled: row.enabled,
    messageMaxLength: Number.isInteger(length) && length >= 1 ? length : GIFT_MESSAGE_DEFAULT_LENGTH,
    allowHideSender: bool(row.allow_hide_sender, true),
    recipientPhoneRequired: bool(row.recipient_phone_required, true),
  };
}

/** يتحقق من إدخال الطول النصي: عددٌ صحيح ضمن 1…السقف. يعيد العدد أو `null`. */
export function parseMessageLength(input: string): number | null {
  const trimmed = input.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);

  return value >= 1 && value <= GIFT_MESSAGE_MAX_CEILING ? value : null;
}

export const giftPoliciesEqual = (a: GiftPolicy, b: GiftPolicy): boolean =>
  a.enabled === b.enabled
  && a.messageMaxLength === b.messageMaxLength
  && a.allowHideSender === b.allowHideSender
  && a.recipientPhoneRequired === b.recipientPhoneRequired;

const path = (storeId: string) => storePath(storeId, 'gift-settings');

export function loadGiftPolicy(storeId: string): Promise<AdminResult<GiftPolicy>> {
  return adminCall(async () => mapGiftPolicy(await api<unknown>(path(storeId))));
}

export function saveGiftPolicy(storeId: string, policy: GiftPolicy): Promise<AdminResult<GiftPolicy>> {
  return adminCall(async () =>
    mapGiftPolicy(
      await api<unknown>(path(storeId), {
        method: 'PUT',
        body: {
          is_enabled: policy.enabled,
          message_max_length: policy.messageMaxLength,
          allow_hide_sender: policy.allowHideSender,
          recipient_phone_required: policy.recipientPhoneRequired,
        },
      }),
    ),
  );
}
