import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  POS_NEW_TAB_REL,
  POS_NEW_TAB_TARGET,
  POS_RETURN_HREF,
  POS_SIDEBAR_LAUNCH_ITEMS,
  POS_START_HREF,
  POS_UNSAVED_EXIT_ACTIONS,
  posNavNewTabAnchorProps,
  posReturnToNebraxProps,
  posSidebarItemsOpeningInNewTab,
  posStartNewTabProps,
} from '@/lib/pos-workspace';

function source(file: string) {
  return readFileSync(resolve(process.cwd(), file), 'utf8');
}

describe('فتح مساحة POS في تبويب مستقل', () => {
  it('يعيد href وtarget وrel الدلالية لبدء البيع', () => {
    expect(posStartNewTabProps()).toEqual({
      href: '/pos',
      target: '_blank',
      rel: 'noopener noreferrer',
    });
    expect(POS_START_HREF).toBe('/pos');
    expect(POS_NEW_TAB_TARGET).toBe('_blank');
    expect(POS_NEW_TAB_REL).toBe('noopener noreferrer');
  });

  it('يضع target وrel فقط عندما يُطلب تبويب جديد', () => {
    expect(posNavNewTabAnchorProps(true)).toEqual({
      target: '_blank',
      rel: 'noopener noreferrer',
    });
    expect(posNavNewTabAnchorProps(false)).toEqual({});
    expect(posNavNewTabAnchorProps(undefined)).toEqual({});
  });

  it('يجعل posStart وحده عنصر الشريط الذي يفتح تبويباً جديداً', () => {
    const newTab = posSidebarItemsOpeningInNewTab();
    expect(newTab).toEqual([{ key: 'posStart', href: '/pos', openInNewTab: true }]);
    expect(POS_SIDEBAR_LAUNCH_ITEMS.filter((item) => !item.openInNewTab).map((item) => item.href)).toEqual([
      '/pos/sessions',
      '/pos/report',
      '/pos/audit',
      '/pos/settings',
    ]);
  });

  it('يربط الشريط المساعد في موقعي الرابط دون window.open', () => {
    const sidebar = source('src/components/layout/sidebar.tsx');
    expect(sidebar).toContain('POS_SIDEBAR_LAUNCH_ITEMS');
    expect(sidebar.match(/\{\.\.\.posNavNewTabAnchorProps\(item\.openInNewTab\)\}/g)).toHaveLength(2);
    expect(sidebar).not.toContain('window.open');
  });

  it('يبقي تخطيط POS مستقلاً عن شريط ERP', () => {
    const layout = source('src/app/(pos)/layout.tsx');
    expect(layout).not.toContain("from '@/components/layout/sidebar'");
    expect(layout).not.toContain('<Sidebar');
    expect(layout).toContain('100dvh');
    expect(layout).toContain("router.replace('/login')");
  });

  it('يجعل العودة إلى النظام انتقالاً إلى لوحة التحكم دون window.close', () => {
    expect(posReturnToNebraxProps()).toEqual({ href: '/dashboard' });
    expect(POS_RETURN_HREF).toBe('/dashboard');
    const topbar = source('src/components/pos/pos-topbar.tsx');
    expect(topbar).toContain('href={POS_RETURN_HREF}');
    expect(topbar).not.toContain('window.close');
    expect(topbar).not.toContain('window.open');
  });

  it('يبقي حارس السلة غير المحفوظة على إغلاق الجلسة والخروج فقط', () => {
    expect(POS_UNSAVED_EXIT_ACTIONS).toEqual(['close_session', 'logout']);
    const page = source('src/app/(pos)/pos/page.tsx');
    expect(page).toContain("setUnsavedExitAction('close_session')");
    expect(page).toContain("setUnsavedExitAction('logout')");
    expect(page).not.toMatch(/setUnsavedExitAction\(['"]return/);
    expect(page).not.toContain('window.close');
  });
});
