/**
 * سياسة فتح مساحة نقطة البيع المخصّصة.
 *
 * «بدء البيع» يفتح `/pos/start` في نفس تبويب الإدارة (رابط عادي بلا `_blank`).
 * مساحة البيع `/pos` وحدها تُفتح في تبويب متصفح جديد — بعد نجاح فتح الجلسة
 * أو اعتماد جلسة قائمة، ومن إيماءة المستخدم.
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
export const POS_WORKSPACE_WINDOW_NAME = 'awj-pos-workspace' as const;

export function posSellingNewTabProps(): {
  href: typeof POS_SELLING_HREF;
  target: typeof POS_NEW_TAB_TARGET;
  rel: typeof POS_NEW_TAB_REL;
} {
  return {
    href: POS_SELLING_HREF,
    target: POS_NEW_TAB_TARGET,
    rel: POS_NEW_TAB_REL,
  };
}

export function posNavNewTabAnchorProps(openInNewTab?: boolean): {
  target?: typeof POS_NEW_TAB_TARGET;
  rel?: typeof POS_NEW_TAB_REL;
} {
  if (!openInNewTab) return {};
  return { target: POS_NEW_TAB_TARGET, rel: POS_NEW_TAB_REL };
}

/**
 * يفتح تبويب POS نائباً من نقرة المستخدم قبل انتظار الشبكة.
 * الاسم الثابت يعيد استخدام تبويب نقطة البيع إن كان مفتوحاً.
 */
export function openPosSellingWorkspaceWindow(): Window | null {
  return window.open('about:blank', POS_WORKSPACE_WINDOW_NAME);
}

export function revealPosSellingWorkspace(win: Window | null): boolean {
  if (!win || win.closed) return false;
  win.location.replace(POS_SELLING_HREF);
  return true;
}

export function discardPosSellingWorkspace(win: Window | null): void {
  if (!win || win.closed) return;
  win.close();
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

/** عناصر مجموعة POS في الشريط. لا أحد منها يفتح تبويباً جديداً. */
export const POS_SIDEBAR_LAUNCH_ITEMS = [
  { key: 'posStart', href: POS_START_HREF, openInNewTab: false },
  { key: 'posSessions', href: '/pos/sessions', openInNewTab: false },
  { key: 'posReport', href: '/pos/report', openInNewTab: false },
  { key: 'posAudit', href: '/pos/audit', openInNewTab: false },
  { key: 'posSettings', href: '/pos/settings', openInNewTab: false },
] as const;

export function posSidebarItemsOpeningInNewTab() {
  return POS_SIDEBAR_LAUNCH_ITEMS.filter((item) => item.openInNewTab);
}
