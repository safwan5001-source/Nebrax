'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { alertSound, type AlertSoundState } from '@/lib/alert-sound';
import { useCan, useCurrentUser } from '@/lib/use-can';
import { AlertEngine } from './alert-engine';
import { fetchAlertConfig, fetchAttention, fetchFeedHead, fetchFeedPage } from './alerts-api';
import { EMPTY_SNAPSHOT, type AlertConfig, type AlertSnapshot } from './contract';
import { createLeaseLocks } from './lease-locks';
import { SilencedStore, cursorStore } from './silenced-store';
import { TabCoordinator, type LockManagerLike, type TabRole } from './tab-coordinator';

/**
 * ربط مركز التنبيه بالمتصفح (COPS-H3-3، ADR-30): إعداد الخادم (مفعَّل؟) ⇒ منسّق تبويبات ⇒ (القائد فقط) محرّك استطلاع ⇒ لقطة تُبثّ للجميع ⇒ حامل الصوت وحده يشغّل الصوت.
 * بوابة مغلقة/صلاحية غائبة/تفضيل شخصي موقوف ⇒ لا استطلاع ولا اشتراك ولا صوت. لا يكتب شيئاً على الخادم (الإقرار الخادمي H3-4).
 */
export interface OrderAlertsState {
  status: 'off' | 'loading' | 'on';
  config: AlertConfig | null;
  snapshot: AlertSnapshot;
  role: TabRole;
  soundState: AlertSoundState;
  soundOwner: boolean;
  silence: (orderId: string) => void;
  enableSound: () => Promise<AlertSoundState>;
  testSound: () => Promise<boolean>;
}

function newTabId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `tab-${Math.random().toString(36).slice(2)}-${Date.now()}`;
}

export function useOrderAlerts(): OrderAlertsState {
  const user = useCurrentUser();
  const { can, hydrated } = useCan();
  const allowed = hydrated && can('commerce.orders.view');
  const optedOut = (user?.preferences as { commerce_alerts?: { enabled?: boolean } } | undefined)?.commerce_alerts?.enabled === false;
  const scope = user ? `${user.tenant_id}:${user.id}` : null;

  const [status, setStatus] = useState<OrderAlertsState['status']>('off');
  const [config, setConfig] = useState<AlertConfig | null>(null);
  const [snapshot, setSnapshot] = useState<AlertSnapshot>(EMPTY_SNAPSHOT);
  const [role, setRole] = useState<TabRole>('follower');
  const [soundState, setSoundState] = useState<AlertSoundState>(alertSound.state);
  const [soundOwner, setSoundOwner] = useState(false);
  const controls = useRef<{ silence: (id: string) => void } | null>(null);
  const interactedAt = useRef(Date.now());

  // 1) إعداد الخادم مرة لكل (مستخدم، تركيب). مغلق/غير مصرَّح ⇒ off بلا أي استطلاع.
  useEffect(() => {
    if (!allowed || optedOut || !scope) {
      setStatus('off');
      setConfig(null);
      return;
    }
    let cancelled = false;
    setStatus('loading');
    fetchAlertConfig()
      .then((c) => {
        if (cancelled) return;
        setConfig(c);
        setStatus(c.enabled ? 'on' : 'off');
      })
      .catch(() => {
        if (!cancelled) setStatus('off');
      });

    return () => {
      cancelled = true;
    };
  }, [allowed, optedOut, scope]);

  // 2) المنسّق + المحرّك + الصوت.
  useEffect(() => {
    if (status !== 'on' || !config || !scope || typeof window === 'undefined') return;

    const tabId = newTabId();
    const storage = window.localStorage;
    const silenced = new SilencedStore(storage, scope);
    const cursor = cursorStore(storage, scope);
    const locks: LockManagerLike = typeof navigator !== 'undefined' && navigator.locks
      ? { request: (name, options, cb) => navigator.locks.request(name, options, cb as never) as unknown as Promise<void> }
      : createLeaseLocks(storage, tabId);

    const coordinator = new TabCoordinator({
      scope,
      tabId,
      locks,
      createChannel: (name) => (typeof BroadcastChannel !== 'undefined' ? (new BroadcastChannel(name) as never) : null),
      getPresence: () => ({ visible: document.visibilityState !== 'hidden', armed: alertSound.state === 'armed', interactedAt: interactedAt.current }),
    });
    const engine = new AlertEngine({
      fetchFeedPage,
      fetchFeedHead,
      fetchAttention,
      loadCursor: cursor.load,
      saveCursor: cursor.save,
      silenced: () => silenced.ids(),
    });

    let owner = false;
    let latest: AlertSnapshot = EMPTY_SNAPSHOT;
    const syncSound = (): void => {
      if (owner) alertSound.syncActive(latest.pending.map((p) => p.orderId));
      else alertSound.stopAll();
    };
    const apply = (s: AlertSnapshot): void => {
      latest = s;
      setSnapshot(s);
      syncSound();
    };

    const offEngine = engine.subscribe((s) => {
      apply(s);
      coordinator.publishSnapshot(s);
    });
    const offSnapshot = coordinator.onSnapshot(apply);
    const offRole = coordinator.onRole((r) => {
      setRole(r);
      if (r === 'leader') engine.start(config);
      else engine.stop();
    });
    const offOwner = coordinator.onSoundOwner((isOwner) => {
      owner = isOwner;
      setSoundOwner(isOwner);
      syncSound();
    });
    const offSilence = coordinator.onSilence((received) => {
      silenced.absorb(received); // التخزين قد يكون ممتلئاً/محجوباً هنا: نحتفظ بالمعرّفات المبثوثة في الذاكرة
      engine.reproject();
      // المتابع لا محرّك له: يُعاد حساب pending محلياً من اللقطة بإزالة المُسكَت.
      const ids = silenced.ids();
      apply({ ...latest, pending: latest.pending.filter((p) => !ids.has(p.orderId)) });
    });
    const offSound = alertSound.subscribe((event) => {
      if (event.type === 'state') {
        setSoundState(event.state);
        coordinator.presenceChanged();
      }
    });

    controls.current = {
      silence: (orderId) => {
        silenced.add([orderId]);
        coordinator.broadcastSilence([orderId]);
        engine.reproject();
        const ids = silenced.ids();
        apply({ ...latest, pending: latest.pending.filter((p) => !ids.has(p.orderId)) });
      },
    };

    const touch = (): void => {
      interactedAt.current = Date.now();
    };
    let lastFocusRefresh = 0;
    const onVisibility = (): void => {
      coordinator.presenceChanged();
      if (document.visibilityState === 'visible' && coordinator.currentRole === 'leader') engine.refresh();
    };
    const onOnline = (): void => {
      if (coordinator.currentRole === 'leader') engine.refresh();
    };
    const onFocus = (): void => {
      const now = Date.now();
      if (now - lastFocusRefresh < 5_000) return;
      lastFocusRefresh = now;
      if (coordinator.currentRole === 'leader') engine.refresh();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', onOnline);
    window.addEventListener('focus', onFocus);
    window.addEventListener('pointerdown', touch, { passive: true });
    window.addEventListener('keydown', touch);

    coordinator.start();

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('pointerdown', touch);
      window.removeEventListener('keydown', touch);
      offEngine();
      offSnapshot();
      offRole();
      offOwner();
      offSilence();
      offSound();
      coordinator.stop();
      engine.stop();
      alertSound.stopAll();
      controls.current = null;
      setSnapshot(EMPTY_SNAPSHOT);
      setRole('follower');
      setSoundOwner(false);
    };
  }, [status, config, scope]);

  // 3) شارة عنوان التبويب (أفضل جهد حين لا يُرى التبويب).
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const base = document.title.replace(/^\(\d+\)\s/, '');
    document.title = status === 'on' && snapshot.pending.length > 0 ? `(${snapshot.pending.length}) ${base}` : base;

    return () => {
      document.title = document.title.replace(/^\(\d+\)\s/, '');
    };
  }, [status, snapshot.pending.length]);

  const silence = useCallback((orderId: string) => controls.current?.silence(orderId), []);
  // يجب أن يُستدعيا متزامنَين داخل معالج نقر (WebKit/autoplay): أول عبارة فيهما `alertSound.unlock()`.
  const enableSound = useCallback(() => alertSound.unlock(), []);
  const testSound = useCallback(async () => {
    const unlocked = alertSound.unlock();
    await unlocked;

    return alertSound.playOnce();
  }, []);

  return { status, config, snapshot, role, soundState, soundOwner, silence, enableSound, testSound };
}
