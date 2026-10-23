// IMP-H2-S4b — قبول المؤسسة لـAI Actions (`GET/PUT /ai-actions-settings`). الخادم هو السلطة: الواجهة لا تفترض نجاحاً
// وتعرض الحالة المُعادة منه فقط. القبول لا يمنح تنفيذاً: كل استيراد يمرّ بمعاينته وموافقته كما كان.
import { api } from '@/lib/api';
import type { Lang } from './product-execution';

export type EnablementReason = 'platform_disabled' | 'tenant_not_enabled' | 'enabled';

export type AccessCapability = 'preview' | 'review' | 'execution';
export interface AccessDecision {
  allowed: boolean;
  reason: string;
}

export interface Enablement {
  platform_enabled: boolean;
  tenant_enabled: boolean;
  effective: boolean;
  reason: EnablementReason;
  // IMP-X-01c: موافقة مالك المؤسسة على التنفيذ + سبب الإتاحة (فقط حين تكون بوابة المشغّل مفتوحة، وإلا `null`). حقول اختيارية: خادم أقدم لا يرسلها.
  execution_approved?: boolean;
  controls_enforced?: boolean;
  access?: Record<string, Record<AccessCapability, AccessDecision>> | null;
}

export async function fetchEnablement(): Promise<Enablement> {
  return (await api<{ data: Enablement }>('/ai-actions-settings')).data;
}

export async function saveEnablement(enabled: boolean): Promise<Enablement> {
  return (await api<{ data: Enablement }>('/ai-actions-settings', { method: 'PUT', body: { enabled } })).data;
}

export async function saveExecutionApproval(approved: boolean): Promise<Enablement> {
  return (await api<{ data: Enablement }>('/ai-actions-settings/execution-approval', { method: 'PUT', body: { approved } })).data;
}

/** أضعف قدرة تنفيذ بين الأنواع: يكفي أن يُمنع نوع واحد لتُعرَض علة التنفيذ (الأنواع المسجَّلة اليوم واحد). */
export function executionBlockReason(state: Enablement): string | null {
  const decisions = Object.values(state.access ?? {}).map((type) => type.execution).filter(Boolean);
  const denied = decisions.find((decision) => !decision.allowed);
  return denied ? denied.reason : null;
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
    approvalTitle: string;
    approvalHint: string;
    approvalToggle: string;
    approvalOwnerOnly: string;
    approvalNeedsEnable: string;
    executionReasons: Record<string, string>;
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
    approvalTitle: 'موافقة مالك المؤسسة على التنفيذ',
    approvalHint: 'تنفيذ أي استيراد بالمساعد يتطلب منحة من إدارة المنصة وموافقتك كمالك. تستطيع سحب الموافقة في أي وقت، فيتوقف التنفيذ الجاري خلال صفٍّ واحد. إيقاف AI Actions للمؤسسة يسحبها تلقائياً. المعاينة والموافقة قبل التنفيذ تبقيان كما هما.',
    approvalToggle: 'أوافق على تنفيذ AI Actions لهذه المؤسسة',
    approvalOwnerOnly: 'موافقة التنفيذ لمالك المؤسسة وحده.',
    approvalNeedsEnable: 'فعّل AI Actions للمؤسسة أولاً.',
    executionReasons: {
      platform_unavailable: 'التنفيذ غير متاح حالياً من إدارة المنصة.',
      tenant_not_granted: 'لم تمنح إدارة المنصة هذه المؤسسة صلاحية التنفيذ بعد.',
      execution_tenant_not_granted: 'لم تمنح إدارة المنصة هذه المؤسسة صلاحية التنفيذ بعد.',
      tenant_owner_not_approved: 'بانتظار موافقتك كمالك على التنفيذ.',
      tenant_not_enabled: 'AI Actions غير مفعّلة لهذه المؤسسة.',
      tenant_inactive: 'المؤسسة غير نشطة.',
    },
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
    approvalTitle: 'Owner approval for execution',
    approvalHint: 'Running any assistant import needs a grant from the platform administration and your approval as the owner. You can withdraw it at any time and a running execution stops within one row. Turning AI Actions off for the organization withdraws it automatically. Preview and approval before execution stay as they are.',
    approvalToggle: 'I approve AI Actions execution for this organization',
    approvalOwnerOnly: 'Only the organization owner can approve execution.',
    approvalNeedsEnable: 'Enable AI Actions for the organization first.',
    executionReasons: {
      platform_unavailable: 'Execution is not available from the platform administration right now.',
      tenant_not_granted: 'The platform administration has not granted this organization execution yet.',
      execution_tenant_not_granted: 'The platform administration has not granted this organization execution yet.',
      tenant_owner_not_approved: 'Waiting for your approval as the owner.',
      tenant_not_enabled: 'AI Actions are not enabled for this organization.',
      tenant_inactive: 'The organization is inactive.',
    },
  },
};
