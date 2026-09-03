/**
 * سياسة فتح مساحة نقطة البيع المخصّصة.
 *
 * «بدء البيع» وحده يفتح `/pos/start` في تبويب متصفح جديد عبر رابط دلالي
 * (`target="_blank"`) من إيماءة المستخدم مباشرة — بلا `window.open`
 * بعد انتظار شبكة، وبلا نافذة بأبعاد ثابتة.
 *
 * الجلسة المالية تبقى من الخادم (`GET /pos-sessions?mine=1` ثم فتح
 * صريح بـ `pos_shift_id`). هذا الملف لا يفتح وردية ولا يجعل localStorage
 * مصدر حقيقة محاسبية.
 */

export const POS_START_HREF = '/pos/start' as const;
export const POS_SELLING_HREF = '/pos' as const;
export const POS_RETURN_HREF = '/dashboard' as const;
export const POS_NEW_TAB_TARGET = '_blank' as const;
export const POS_NEW_TAB_REL = 'noopener noreferrer' as const;

export function posStartNewTabProps(): {
  href: typeof POS_START_HREF;
  target: typeof POS_NEW_TAB_TARGET;
  rel: typeof POS_NEW_TAB_REL;
} {
  return {
    href: POS_START_HREF,
    target: POS_NEW_TAB_TARGET,
    rel: POS_NEW_TAB_REL,
  };
}

export function posNavNewTabAnchorProps(openInNewTab?: boolean): {
  target?: typeof POS_NEW_TAB_TARGET;
  rel?: typeof POS_NEW_TAB_REL;
} {
  if (!openInNewTab) return {};
  const { target, rel } = posStartNewTabProps();
  return { target, rel };
}

export function posReturnToNebraxProps(): { href: typeof POS_RETURN_HREF } {
  return { href: POS_RETURN_HREF };
}

/**
 * حارس السلة غير المحفوظة: إغلاق الجلسة، تسجيل الخروج، أو العودة للنظام.
 * العودة لا تنهي الوردية؛ تؤكد فقط قبل مغادرة شاشة البيع.
 */
export const POS_UNSAVED_EXIT_ACTIONS = ['close_session', 'logout', 'return_to_system'] as const;
export type PosUnsavedExitAction = (typeof POS_UNSAVED_EXIT_ACTIONS)[number];

export function decidePosUnsavedExit(hasUnsavedCarts: boolean): 'guard' | 'proceed' {
  return hasUnsavedCarts ? 'guard' : 'proceed';
}

/** العودة للنظام وتسجيل الخروج لا يغلقان الوردية. الإغلاق وحده يفعل. */
export function posUnsavedExitEndsShift(action: PosUnsavedExitAction): boolean {
  return action === 'close_session';
}

/** عناصر مجموعة POS في الشريط. `posStart` وحده يفتح تبويباً جديداً. */
export const POS_SIDEBAR_LAUNCH_ITEMS = [
  { key: 'posStart', href: POS_START_HREF, openInNewTab: true },
  { key: 'posSessions', href: '/pos/sessions', openInNewTab: false },
  { key: 'posReport', href: '/pos/report', openInNewTab: false },
  { key: 'posAudit', href: '/pos/audit', openInNewTab: false },
  { key: 'posSettings', href: '/pos/settings', openInNewTab: false },
] as const;

export function posSidebarItemsOpeningInNewTab() {
  return POS_SIDEBAR_LAUNCH_ITEMS.filter((item) => item.openInNewTab);
}

