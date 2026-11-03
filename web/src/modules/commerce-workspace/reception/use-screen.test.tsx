// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFullscreen, useWakeLock } from './use-screen';

function installWakeLock(request: () => Promise<unknown>) {
  Object.defineProperty(navigator, 'wakeLock', { value: { request }, configurable: true });
}
function sentinel() {
  const listeners = new Set<() => void>();

  return {
    release: vi.fn().mockImplementation(async () => { listeners.forEach((l) => l()); }),
    addEventListener: (_: string, l: () => void) => listeners.add(l),
  };
}
const setVisibility = (v: 'visible' | 'hidden') => {
  Object.defineProperty(document, 'visibilityState', { value: v, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
};
const tick = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };

describe('useWakeLock (تحسين لا ضمان)', () => {
  afterEach(() => { cleanup(); delete (navigator as unknown as { wakeLock?: unknown }).wakeLock; setVisibility('visible'); });

  it('متصفح بلا واجهة القفل ⇒ unsupported ولا طلب', async () => {
    delete (navigator as unknown as { wakeLock?: unknown }).wakeLock;
    const { result } = renderHook(() => useWakeLock());
    await tick();
    expect(result.current.state).toBe('unsupported');
    act(() => result.current.toggle());
    expect(result.current.state).toBe('unsupported');
  });

  it('لا طلب تلقائي عند الفتح؛ النقر يطلب القفل فيصير active، والنقر الثاني يحرّره', async () => {
    const lock = sentinel();
    const request = vi.fn().mockResolvedValue(lock);
    installWakeLock(request);
    const { result } = renderHook(() => useWakeLock());
    await tick();
    expect(request).not.toHaveBeenCalled();
    expect(result.current.state).toBe('off');

    act(() => result.current.toggle());
    await tick();
    expect(request).toHaveBeenCalledWith('screen');
    expect(result.current.state).toBe('active');

    act(() => result.current.toggle());
    await tick();
    expect(lock.release).toHaveBeenCalledTimes(1);
    expect(result.current.state).toBe('off');
  });

  it('رفض الجهاز (توفير البطارية مثلاً) ⇒ denied ولا يُعاد الطلب وحده', async () => {
    const request = vi.fn().mockRejectedValue(new DOMException('battery', 'NotAllowedError'));
    installWakeLock(request);
    const { result } = renderHook(() => useWakeLock());
    act(() => result.current.toggle());
    await tick();
    expect(result.current.state).toBe('denied');
    setVisibility('visible');
    await tick();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('تحرير النظام للقفل (إخفاء التبويب) ⇒ released ثم يُعاد تلقائياً عند العودة للظهور', async () => {
    const first = sentinel();
    const second = sentinel();
    const request = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    installWakeLock(request);
    const { result } = renderHook(() => useWakeLock());
    act(() => result.current.toggle());
    await tick();
    expect(result.current.state).toBe('active');

    setVisibility('hidden');
    await act(async () => { await first.release(); }); // المتصفح يحرّر عند الإخفاء
    expect(result.current.state).toBe('released');

    setVisibility('visible');
    await tick();
    expect(request).toHaveBeenCalledTimes(2);
    expect(result.current.state).toBe('active');
  });

  it('إزالة المكوّن تحرّر القفل', async () => {
    const lock = sentinel();
    installWakeLock(vi.fn().mockResolvedValue(lock));
    const { result, unmount } = renderHook(() => useWakeLock());
    act(() => result.current.toggle());
    await tick();
    unmount();
    await tick();
    expect(lock.release).toHaveBeenCalled();
  });
});

describe('useFullscreen', () => {
  beforeEach(() => {
    Object.defineProperty(document, 'fullscreenEnabled', { value: true, configurable: true });
    Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true });
  });
  afterEach(() => { cleanup(); delete (document as unknown as { fullscreenEnabled?: unknown }).fullscreenEnabled; });

  it('غير مدعوم ⇒ unsupported', async () => {
    Object.defineProperty(document, 'fullscreenEnabled', { value: false, configurable: true });
    const { result } = renderHook(() => useFullscreen());
    await tick();
    expect(result.current.state).toBe('unsupported');
  });

  it('النقر يطلب ملء الشاشة للصفحة كلها (documentElement) وحدث التغيّر يحدّث الحالة', async () => {
    const request = vi.fn().mockResolvedValue(undefined);
    document.documentElement.requestFullscreen = request;
    const { result } = renderHook(() => useFullscreen());
    await tick();
    expect(result.current.state).toBe('off');
    act(() => result.current.toggle());
    expect(request).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, 'fullscreenElement', { value: document.documentElement, configurable: true });
    act(() => { document.dispatchEvent(new Event('fullscreenchange')); });
    expect(result.current.state).toBe('on');
  });

  it('رفض الطلب ⇒ denied', async () => {
    document.documentElement.requestFullscreen = vi.fn().mockRejectedValue(new Error('no'));
    const { result } = renderHook(() => useFullscreen());
    await tick();
    act(() => result.current.toggle());
    await tick();
    expect(result.current.state).toBe('denied');
  });
});
