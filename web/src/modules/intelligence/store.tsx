'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useCurrentUser } from '@/lib/use-can';
import { fetchStatus, readDocument, runTool, sendMessage } from './api';
import { classifyError, type ClassifiedError } from './state';
import type {
  AssistantStatus,
  DocumentProjection,
  FinancialResult,
  MessageResponse,
  ToolCall,
  ToolName,
} from './contract';
import { MESSAGE_MAX_CHARS } from './contract';

/**
 * حالة المساعد في الذاكرة فقط (AI-03).
 *
 * - **لا تخزين متصفح** لأي نص محادثة أو ردّ أو نتيجة مالية (لا localStorage ولا sessionStorage ولا تحليلات).
 * - **هوية الجلسة** = (مستأجر ‖ مستخدم). أي تغيّر فيها (خروج، دخول بحساب آخر، تبديل مستأجر) يصفّر كل شيء ويبطل
 *   كل طلب طائر: الرقم الدوري `epoch` يُقارَن عند عودة كل استجابة، فلا تتسرّب نتيجة مستأجر سابق إلى الشاشة.
 * - ردّ متأخر لطلب أحدث منه (`seq`) يُهمَل أيضاً.
 * - لا طلب مالي إلا بنقرة صريحة من المستخدم وبعد أن تكون الحالة المقروءة للتوّ `ready`.
 */

export type StatusPhase = 'idle' | 'loading' | 'ready' | 'error';

export interface ChatEntry {
  id: string;
  role: 'user' | 'assistant' | 'notice';
  text?: string;
  error?: ClassifiedError;
  toolCalls?: ToolCall[];
  /** AI-07ب: الجواب مبنيّ على مستند (أعداد فقط). */
  basedOnDocument?: { ref: string; fields_sent: number; lines_sent: number; redacted: number };
  /** معرّفات التشغيلات المقابلة لـ`toolCalls` بالترتيب (للانتقال إلى المساحة). */
  runIds?: string[];
}

export interface FinancialRun {
  id: string;
  source: 'canvas' | 'assistant';
  requestId: string;
  tool: ToolName;
  result: FinancialResult;
  /** نطاق **التفويض** من مسار المحادثة (`scope_kind: authorization`) — ليس مرشّح بيانات. غائب في التشغيل الصريح. */
  authorizationScope?: MessageResponse['scope'];
}

/** نتيجة قراءة مستند (AI-04) — في الذاكرة فقط، وتُمحى بتبدّل الهوية أو بإغلاق التبويب. */
export interface DocumentRun {
  requestId: string;
  documentId: string;
  projection: DocumentProjection;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface IntelligenceStore {
  identity: string;
  statusPhase: StatusPhase;
  status: AssistantStatus | null;
  statusError: ClassifiedError | null;
  refreshStatus: () => Promise<AssistantStatus | null>;
  /** يعتمد حالة طازجة أعادها الخادم (بعد حفظ الموافقة) دون قراءة إضافية. */
  applyStatus: (next: AssistantStatus) => void;
  panelOpen: boolean;
  openPanel: () => void;
  closePanel: () => void;
  entries: ChatEntry[];
  chatPending: boolean;
  send: (text: string, options?: { documentId?: string }) => Promise<void>;
  clearConversation: () => void;
  runs: FinancialRun[];
  activeRun: FinancialRun | null;
  setActiveRunId: (id: string | null) => void;
  financialPending: boolean;
  financialError: ClassifiedError | null;
  dismissFinancialError: () => void;
  runFinancial: (input: { tool: ToolName; arguments: Record<string, string>; branchIds?: string[] }) => Promise<boolean>;
  /** AI-04: آخر مستند قُرئ (مستند واحد في الذاكرة)، وحالة طلبه وخطؤه. */
  documentRun: DocumentRun | null;
  documentPending: boolean;
  documentError: ClassifiedError | null;
  dismissDocumentError: () => void;
  /** قراءة صريحة لمستند واحد بمعرّفه من الشاشة؛ لا طلب إلا والحالة المقروءة للتوّ `document: ready`. */
  readDocument: (documentId: string) => Promise<boolean>;
  clearDocument: () => void;
}

const Context = createContext<IntelligenceStore | null>(null);

const MAX_ENTRIES = 30;
const MAX_RUNS = 6;

let counter = 0;
const nextId = (prefix: string) => `${prefix}-${++counter}`;

export function IntelligenceProvider({ children, locale = 'ar' }: { children: React.ReactNode; locale?: 'ar' | 'en' }) {
  const user = useCurrentUser();
  const identity = user ? `${user.tenant_id}:${user.id}` : '';

  const epoch = useRef(0);
  const statusSeq = useRef(0);
  const chatSeq = useRef(0);
  const financialSeq = useRef(0);
  const documentSeq = useRef(0);
  const statusRef = useRef<AssistantStatus | null>(null);

  const [statusPhase, setStatusPhase] = useState<StatusPhase>('idle');
  const [status, setStatus] = useState<AssistantStatus | null>(null);
  const [statusError, setStatusError] = useState<ClassifiedError | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [chatPending, setChatPending] = useState(false);
  const [runs, setRuns] = useState<FinancialRun[]>([]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [financialPending, setFinancialPending] = useState(false);
  const [financialError, setFinancialError] = useState<ClassifiedError | null>(null);
  const [documentRun, setDocumentRun] = useState<DocumentRun | null>(null);
  const [documentPending, setDocumentPending] = useState(false);
  const [documentError, setDocumentError] = useState<ClassifiedError | null>(null);

  // تغيّرت الهوية: صفّر كل شيء وأبطل ما في الطيران.
  const lastIdentity = useRef(identity);
  useEffect(() => {
    if (lastIdentity.current === identity) return;
    lastIdentity.current = identity;
    epoch.current += 1;
    statusSeq.current += 1;
    chatSeq.current += 1;
    financialSeq.current += 1;
    documentSeq.current += 1;
    statusRef.current = null;
    setStatusPhase('idle');
    setStatus(null);
    setStatusError(null);
    setPanelOpen(false);
    setEntries([]);
    setChatPending(false);
    setRuns([]);
    setActiveRunId(null);
    setFinancialPending(false);
    setFinancialError(null);
    setDocumentRun(null);
    setDocumentPending(false);
    setDocumentError(null);
  }, [identity]);

  const refreshStatus = useCallback(async (): Promise<AssistantStatus | null> => {
    if (!identity) return null;
    const myEpoch = epoch.current;
    const mySeq = ++statusSeq.current;
    setStatusPhase((phase) => (phase === 'ready' ? phase : 'loading'));
    try {
      const next = await fetchStatus();
      if (myEpoch !== epoch.current || mySeq !== statusSeq.current) return null;
      statusRef.current = next;
      setStatus(next);
      setStatusError(null);
      setStatusPhase('ready');
      return next;
    } catch (error) {
      if (myEpoch !== epoch.current || mySeq !== statusSeq.current) return null;
      statusRef.current = null;
      setStatus(null);
      setStatusError(classifyError(error));
      setStatusPhase('error');
      return null;
    }
  }, [identity]);

  const applyStatus = useCallback((next: AssistantStatus) => {
    statusSeq.current += 1; // يُبطل أي قراءة أقدم لا تزال في الطيران
    statusRef.current = next;
    setStatus(next);
    setStatusError(null);
    setStatusPhase('ready');
  }, []);

  const openPanel = useCallback(() => {
    setPanelOpen(true);
    void refreshStatus(); // كل فتح يقرأ الحالة طازجةً: صلاحية/موافقة قد تغيّرت منذ آخر مرة.
  }, [refreshStatus]);
  const closePanel = useCallback(() => setPanelOpen(false), []);

  const registerRuns = useCallback((calls: ToolCall[], source: FinancialRun['source'], requestId: string, scope?: MessageResponse['scope']) => {
    if (calls.length === 0) return [] as string[];
    const created = calls.map<FinancialRun>((call) => ({
      id: nextId('run'),
      source,
      requestId,
      tool: call.tool,
      result: call.result,
      authorizationScope: scope,
    }));
    setRuns((previous) => [...created, ...previous].slice(0, MAX_RUNS));
    return created.map((run) => run.id);
  }, []);

  const send = useCallback(async (raw: string, options?: { documentId?: string }) => {
    const text = raw.trim();
    if (!text || text.length > MESSAGE_MAX_CHARS) return;
    if (!identity || chatPending) return;
    // لا طلب محادثة إلا والحالة المقروءة جاهزة: لا نُجرّب ثم نكتشف الرفض.
    if (statusRef.current?.chat !== 'ready') return;
    // سؤال عن مستند: لا يُرسَل إلا والحالة المقروءة للتوّ `document_ask: ready` ومعرّف UUID صالح.
    const documentId = options?.documentId;
    if (documentId && (statusRef.current?.document_ask !== 'ready' || !UUID.test(documentId))) return;

    const myEpoch = epoch.current;
    const mySeq = ++chatSeq.current;
    setEntries((previous) => [...previous, { id: nextId('u'), role: 'user' as const, text }].slice(-MAX_ENTRIES));
    setChatPending(true);
    try {
      const data = await sendMessage({ message: text, locale, ...(documentId ? { documentId: documentId.toLowerCase() } : {}) });
      if (myEpoch !== epoch.current || mySeq !== chatSeq.current) return;
      const runIds = registerRuns(data.tool_calls, 'assistant', data.request_id, data.scope);
      setEntries((previous) => [
        ...previous,
        { id: nextId('a'), role: 'assistant' as const, text: data.message.content, toolCalls: data.tool_calls, runIds, ...(data.document ? { basedOnDocument: data.document } : {}) },
      ].slice(-MAX_ENTRIES));
      if (runIds[0]) setActiveRunId(runIds[0]);
    } catch (error) {
      if (myEpoch !== epoch.current || mySeq !== chatSeq.current) return;
      const classified = classifyError(error);
      setEntries((previous) => [...previous, { id: nextId('n'), role: 'notice' as const, error: classified }].slice(-MAX_ENTRIES));
      if (classified.refreshStatus) void refreshStatus();
    } finally {
      if (myEpoch === epoch.current && mySeq === chatSeq.current) setChatPending(false);
    }
  }, [identity, chatPending, locale, registerRuns, refreshStatus]);

  const runFinancial = useCallback(async (input: { tool: ToolName; arguments: Record<string, string>; branchIds?: string[] }): Promise<boolean> => {
    if (!identity) return false;
    // «لا طلب مالي غير مصرَّح»: الحالة المقروءة للتوّ يجب أن تكون جاهزة قبل أي نداء.
    if (statusRef.current?.financial !== 'ready') return false;

    const myEpoch = epoch.current;
    const mySeq = ++financialSeq.current;
    setFinancialPending(true);
    setFinancialError(null);
    try {
      const data = await runTool(input);
      if (myEpoch !== epoch.current || mySeq !== financialSeq.current) return false;
      const runIds = registerRuns(data.tool_calls, 'canvas', data.request_id);
      if (runIds[0]) setActiveRunId(runIds[0]);
      return true;
    } catch (error) {
      if (myEpoch !== epoch.current || mySeq !== financialSeq.current) return false;
      const classified = classifyError(error);
      setFinancialError(classified);
      if (classified.refreshStatus) void refreshStatus();
      return false;
    } finally {
      if (myEpoch === epoch.current && mySeq === financialSeq.current) setFinancialPending(false);
    }
  }, [identity, registerRuns, refreshStatus]);

  const readDocumentRun = useCallback(async (documentId: string): Promise<boolean> => {
    if (!identity || !UUID.test(documentId)) return false;
    // «لا طلب غير مصرَّح»: الحالة المقروءة للتوّ يجب أن تكون جاهزة قبل أي نداء، ولا يُرسَل نصّ مستخدم أصلاً.
    if (statusRef.current?.document !== 'ready') return false;

    const myEpoch = epoch.current;
    const mySeq = ++documentSeq.current;
    setDocumentPending(true);
    setDocumentError(null);
    try {
      const data = await readDocument(documentId.toLowerCase());
      if (myEpoch !== epoch.current || mySeq !== documentSeq.current) return false;
      const call = data.tool_calls[0];
      if (!call) return false;
      setDocumentRun({ requestId: data.request_id, documentId: documentId.toLowerCase(), projection: call.result });
      return true;
    } catch (error) {
      if (myEpoch !== epoch.current || mySeq !== documentSeq.current) return false;
      // لا نُبقي نتيجة سابقة لمستند آخر ظاهرةً بجوار خطأ هذا الطلب.
      setDocumentRun(null);
      const classified = classifyError(error);
      setDocumentError(classified);
      if (classified.refreshStatus) void refreshStatus();
      return false;
    } finally {
      if (myEpoch === epoch.current && mySeq === documentSeq.current) setDocumentPending(false);
    }
  }, [identity, refreshStatus]);

  const value = useMemo<IntelligenceStore>(() => ({
    identity,
    statusPhase,
    status,
    statusError,
    refreshStatus,
    applyStatus,
    panelOpen,
    openPanel,
    closePanel,
    entries,
    chatPending,
    send,
    clearConversation: () => setEntries([]),
    runs,
    activeRun: runs.find((run) => run.id === activeRunId) ?? null,
    setActiveRunId,
    financialPending,
    financialError,
    dismissFinancialError: () => setFinancialError(null),
    runFinancial,
    documentRun,
    documentPending,
    documentError,
    dismissDocumentError: () => setDocumentError(null),
    readDocument: readDocumentRun,
    clearDocument: () => { documentSeq.current += 1; setDocumentRun(null); setDocumentError(null); setDocumentPending(false); },
  }), [identity, statusPhase, status, statusError, refreshStatus, applyStatus, panelOpen, openPanel, closePanel, entries, chatPending, send, runs, activeRunId, financialPending, financialError, runFinancial, documentRun, documentPending, documentError, readDocumentRun]);

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useIntelligence(): IntelligenceStore {
  const store = useContext(Context);
  if (!store) throw new Error('useIntelligence must be used inside <IntelligenceProvider>.');
  return store;
}

/** نسخة اختيارية: الشريط العلوي يعمل خارج المزوّد (اختبارات/صفحات بلا مزوّد) فلا يرمي. */
export function useOptionalIntelligence(): IntelligenceStore | null {
  return useContext(Context);
}
