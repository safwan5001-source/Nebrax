'use client';

import { isDemo } from './demo';
import {
  clearPlatformSession,
  getPlatformAdministrator,
  getPlatformToken,
  platformApi,
  setPlatformAdministrator,
  setPlatformToken,
} from './platform-api';

export interface PlatformAdministrator {
  id: string;
  name: string;
  email: string;
}

export async function platformLogin(email: string, password: string): Promise<PlatformAdministrator> {
  const response = await platformApi<{ token: string; administrator: PlatformAdministrator }>('/platform/login', {
    method: 'POST',
    body: { email, password },
  });

  setPlatformToken(response.token);
  setPlatformAdministrator(response.administrator);

  return response.administrator;
}

export async function platformLogout(): Promise<void> {
  try {
    await platformApi('/platform/logout', { method: 'POST' });
  } catch {
    // نمسح الجلسة محلياً حتى إن انقطعت الشبكة أثناء الخروج.
  }
  clearPlatformSession();
}

export function currentPlatformAdministrator(): PlatformAdministrator | null {
  if (isDemo()) return { id: 'demo-platform-administrator', name: 'مدير المنصة التجريبي', email: 'platform-demo@nibras.test' };
  return getPlatformAdministrator<PlatformAdministrator>();
}

export function isPlatformAuthenticated(): boolean {
  return isDemo() || getPlatformToken() !== null;
}
