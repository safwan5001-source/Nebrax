// IMP-H2-S4b — قبول المؤسسة لـAI Actions (`GET/PUT /ai-actions-settings`). الخادم هو السلطة: الواجهة لا تفترض نجاحاً
// وتعرض الحالة المُعادة منه فقط. القبول لا يمنح تنفيذاً: كل استيراد يمرّ بمعاينته وموافقته كما كان.
import { api } from '@/lib/api';
import type { Lang } from './product-execution';

export type EnablementReason = 'platform_disabled' | 'tenant_not_enabled' | 'enabled';

export interface Enablement {
  platform_enabled: boolean;
  tenant_enabled: boolean;
  effective: boolean;
  reason: EnablementReason;
}

export async function fetchEnablement(): Promise<Enablement> {
  return (await api<{ data: Enablement }>('/ai-actions-settings')).data;
}

export async function saveEnablement(enabled: boolean): Promise<Enablement> {
  return (await api<{ data: Enablement }>('/ai-actions-settings', { method: 'PUT', body: { enabled } })).data;
}

export const ENABLEMENT_TEXT: Record<
  Lang,
  {
    title: string;
    hint: string;
    on: string;
    off: string;
    toggle: string;
    platformOff: string;
    reasons: Record<Exclude<EnablementReason, 'enabled'>, string>;
    saved: string;
    failed: string;
    loadFailed: string;
    askOwner: string;
  }
> = {
  ar: {
    title: 'AI Actions للمؤسسة',
    hint: 'تفعيلها يتيح مسودات الاستيراد المراجَعة فقط. لا يُنفَّذ شيء تلقائياً: كل استيراد يمرّ بمعاينته وموافقتك وضغطك على «تنفيذ».',
    on: 'مفعّلة',
    off: 'غير مفعّلة',
    toggle: 'تفعيل AI Actions لهذه المؤسسة',
    platformOff: 'غير متاحة على المنصة حالياً، فلا يمكن تفعيلها للمؤسسة. يمكنك إيقافها فقط.',
    reasons: {
      platform_disabled: 'AI Actions غير متاحة على المنصة حالياً.',
      tenant_not_enabled: 'AI Actions غير مفعّلة لهذه المؤسسة.',
    },
    saved: 'تم حفظ الإعداد.',
    failed: 'تعذّر حفظ الإعداد.',
    loadFailed: 'تعذّر تحميل حالة AI Actions.',
    askOwner: 'اطلب من مالك المؤسسة تفعيلها من الإعدادات.',
  },
  en: {
    title: 'AI Actions for this organization',
    hint: 'Enabling allows reviewed import drafts only. Nothing runs automatically: every import still goes through its preview, your approval and an explicit “Run”.',
    on: 'Enabled',
    off: 'Not enabled',
    toggle: 'Enable AI Actions for this organization',
    platformOff: 'Not available on the platform right now, so it cannot be enabled for the organization. You can only turn it off.',
    reasons: {
      platform_disabled: 'AI Actions are not available on the platform right now.',
      tenant_not_enabled: 'AI Actions are not enabled for this organization.',
    },
    saved: 'Setting saved.',
    failed: 'Could not save the setting.',
    loadFailed: 'Could not load the AI Actions status.',
    askOwner: 'Ask your organization owner to enable it in Settings.',
  },
};
