'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { alertSound, type AlertSoundState } from '@/lib/alert-sound';
import { useCan, useCurrentUser } from '@/lib/use-can';
import { AlertEngine } from './alert-engine';
import { acknowledgeOrder, type AcknowledgeOutcome } from './acknowledge-order';
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
  /** إقرار الطلب (R-10): يُسكت محلياً فوراً ثم يطلب الخادم؛ الفشل العابر يُرجع التنبيه. */
  acknowledge: (orderId: string) => Promise<AcknowledgeOutcome>;
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
  const controls = useRef<{ acknowledge: (id: string) => Promise<AcknowledgeOutcome> } | null>(null);
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
    // اللقطة كما وصلت (من محرّكنا أو من القائد)؛ العرض = اللقطة مطروحاً منها المُسكَت محلياً (يُحسب عند كل تغيير فيعود التنبيه إن تراجع الإسكات).
    let raw: AlertSnapshot = EMPTY_SNAPSHOT;
    const view = (): AlertSnapshot => {
      const ids = silenced.ids();

      return ids.size === 0 ? raw : { ...raw, pending: raw.pending.filter((p) => !ids.has(p.orderId)) };
    };
    const syncSound = (): void => {
      if (owner) alertSound.syncActive(view().pending.map((p) => p.orderId));
      else alertSound.stopAll();
    };
    const render = (): void => {
      setSnapshot(view());
      syncSound();
    };
    const apply = (s: AlertSnapshot): void => {
      raw = s;
      render();
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
    const offSilence = coordinator.onSilence(() => {
      engine.reproject();
      render(); // المتابع لا محرّك له: يُعاد حساب العرض محلياً.
    });
    const offSound = alertSound.subscribe((event) => {
      if (event.type === 'state') {
        setSoundState(event.state);
        coordinator.presenceChanged();
      }
    });

    controls.current = {
      acknowledge: async (orderId) => {
        // إسكات متفائل فوري (الصوت يتوقف قبل رد الخادم) ثم الإقرار الخادمي الذي يُسكت بقية الأجهزة عبر التغذية/المصالحة (≤ دورة استطلاع).
        silenced.add([orderId]);
        coordinator.broadcastSilence([orderId]);
        engine.reproject();
        render();

        const outcome = await acknowledgeOrder(orderId);
        if (outcome.ok) {
          if (coordinator.currentRole === 'leader') engine.refresh();
        } else if (outcome.settled) {
          // لا يستدعي التنبيه أصلاً (ملغى/غير جاهز/خارج النطاق): نُبقي الإسكات ونطلب الحقيقة من الخادم.
          if (coordinator.currentRole === 'leader') engine.refresh();
        } else {
          // فشل عابر (شبكة/5xx/403): الإقرار الصريح لم يحدث ⇒ يعود التنبيه ولا نوهم أن الآخرين أُسكتوا.
          silenced.remove([orderId]);
          engine.reproject();
          render();
        }

        return outcome;
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

  const acknowledge = useCallback(
    async (orderId: string): Promise<AcknowledgeOutcome> => (controls.current ? controls.current.acknowledge(orderId) : { ok: false, settled: false, status: null, reason: null }),
    [],
  );
  // يجب أن يُستدعيا متزامنَين داخل معالج نقر (WebKit/autoplay): أول عبارة فيهما `alertSound.unlock()`.
  const enableSound = useCallback(() => alertSound.unlock(), []);
  const testSound = useCallback(async () => {
    const unlocked = alertSound.unlock();
    await unlocked;

    return alertSound.playOnce();
  }, []);

  return { status, config, snapshot, role, soundState, soundOwner, acknowledge, enableSound, testSound };
}
