type DemoField = {
  key: string;
  original: string | number | boolean | null;
  current: string | number | boolean | null;
  confidence_basis_points?: number;
  page?: number;
};

type DemoState = {
  version: number;
  status: string;
  purchaseDraft: { purchase_id: string; purchase_number: string; status: string; url: string } | null;
  fields: DemoField[];
  matches: Array<{
    id: string;
    subject_key: string;
    status: string;
    score_basis_points: number;
    strategy: string;
    candidates: Array<{
      id: string;
      label: string;
      candidate_type: string;
      sku?: string;
      unit?: string;
      score_basis_points: number;
      strategy: string;
      is_active: boolean;
    }>;
  }>;
  issues: Array<{
    id: string;
    code: string;
    severity: string;
    status: string;
    safe_message: string;
    subject_key: string | null;
  }>;
  history: Array<{
    id: string;
    action: string;
    reason: string | null;
    before: Record<string, string | number | boolean> | null;
    after: Record<string, string | number | boolean> | null;
    actor: { id: string; name: string };
    occurred_at: string;
  }>;
};

type HandlerResult = { handled: true; response: unknown } | { handled: true; error: Error } | { handled: false };

function staleError(): Error & { status: number } {
  return Object.assign(new Error('stale_review_version'), { status: 409 });
}

function initialState(): DemoState {
  return {
    version: 7,
    status: 'needs_review',
    purchaseDraft: null,
    fields: [
      { key: 'document_number', original: 'PI-2084', current: 'PI-2084', confidence_basis_points: 9800, page: 1 },
      { key: 'document_date', original: '2026-08-22', current: '2026-08-22', confidence_basis_points: 9500, page: 1 },
      { key: 'supplier_name', original: 'شركة الجزيرة للتوريدات الصناعية', current: 'شركة الجزيرة للتوريدات الصناعية', confidence_basis_points: 9100, page: 1 },
      { key: 'subtotal_minor', original: 250000, current: 250000, confidence_basis_points: 9200, page: 1 },
      { key: 'tax_minor', original: 37500, current: 37500, confidence_basis_points: 9200, page: 1 },
      { key: 'total_minor', original: 287500, current: 287500, confidence_basis_points: 9600, page: 1 },
    ],
    matches: [
      {
        id: 'demo-match-supplier',
        subject_key: 'supplier_name',
        status: 'suggested',
        score_basis_points: 9400,
        strategy: 'normalized_name',
        candidates: [
          { id: 'demo-candidate-supplier-1', label: 'شركة الجزيرة للتوريدات الصناعية', candidate_type: 'partner', score_basis_points: 9400, strategy: 'normalized_name', is_active: true },
          { id: 'demo-candidate-supplier-2', label: 'مؤسسة نجد للتوريدات', candidate_type: 'partner', score_basis_points: 6400, strategy: 'normalized_name', is_active: true },
        ],
      },
      {
        id: 'demo-match-line',
        subject_key: 'total_minor',
        status: 'confirmed',
        score_basis_points: 9900,
        strategy: 'amount_exact',
        candidates: [
          { id: 'demo-candidate-product-1', label: 'صمام صناعي قياس 2 بوصة', candidate_type: 'product', sku: 'VAL-2IN', unit: 'قطعة', score_basis_points: 9900, strategy: 'amount_exact', is_active: true },
        ],
      },
    ],
    issues: [
      {
        id: 'demo-issue-tax',
        code: 'tax_total_mismatch',
        severity: 'blocking',
        status: 'open',
        safe_message: 'يتطلب إجمالي الضريبة تأكيدًا قبل إكمال المراجعة.',
        subject_key: 'tax_minor',
      },
      {
        id: 'demo-issue-warning',
        code: 'missing_purchase_order',
        severity: 'warning',
        status: 'open',
        safe_message: 'لم يُعثر على رقم طلب شراء في دليل المستند.',
        subject_key: 'document_number',
      },
    ],
    history: [
      {
        id: 'demo-action-1',
        action: 'field_changed',
        reason: 'توحيد رقم المستند مع الصورة الأصلية.',
        before: { value: 'PI-208A' },
        after: { value: 'PI-2084' },
        actor: { id: 'demo-reviewer', name: 'أحمد المراجع' },
        occurred_at: '2026-08-25T09:30:00+03:00',
      },
    ],
  };
}

let state = initialState();

function completeReady(): boolean {
  return state.matches.every((match) => ['confirmed', 'rejected'].includes(match.status))
    && !state.issues.some((issue) => issue.severity === 'blocking' && ['open', 'reopened'].includes(issue.status));
}

function addHistory(action: string, reason: string | null, before: Record<string, string | number | boolean> | null, after: Record<string, string | number | boolean> | null) {
  state.history.unshift({
    id: `demo-action-${state.history.length + 1}`,
    action,
    reason,
    before,
    after,
    actor: { id: 'demo-user', name: 'مستخدم المعاينة' },
    occurred_at: new Date().toISOString(),
  });
}

function validVersion(body: Record<string, unknown>): boolean {
  return Number(body.expected_version) === state.version;
}

export function resetDocumentReviewDemo(): void {
  state = initialState();
}

export function handleDocumentReviewDemo(path: string, method: string, body?: unknown): HandlerResult {
  const clean = path.split('?')[0];
  const requestBody = (body ?? {}) as Record<string, unknown>;
  const reviewMatch = clean.match(/^\/document-batches\/(demo-batch-[^/]+)\/review$/);
  const changeMatch = clean.match(/^\/document-batches\/(demo-batch-[^/]+)\/review-changes$/);
  const completeMatch = clean.match(/^\/document-batches\/(demo-batch-[^/]+)\/complete-review$/);
  const revalidateMatch = clean.match(/^\/document-batches\/(demo-batch-[^/]+)\/revalidate-financial$/);
  const createDraftMatch = clean.match(/^\/document-batches\/(demo-batch-[^/]+)\/create-purchase-draft$/);

  if (method === 'GET' && clean === '/document-batches') {
    const query = new URLSearchParams(path.split('?')[1] ?? '');
    const search = query.get('search')?.toLowerCase() ?? '';
    const all = [
      {
        id: 'demo-batch-001', document_type: 'purchase_invoice', source_type: 'upload', status: state.status,
        version: state.version, created_at: '2026-08-25T09:00:00+03:00', files_count: 1,
        blocking_issues_count: state.issues.filter((issue) => issue.severity === 'blocking' && issue.status !== 'resolved').length,
        warning_issues_count: state.issues.filter((issue) => issue.severity === 'warning' && issue.status !== 'resolved').length,
        reviewer: { id: 'demo-reviewer', name: 'أحمد المراجع' },
      },
      {
        id: 'demo-batch-002', document_type: 'expense', source_type: 'email', status: 'needs_review',
        version: 2, created_at: '2026-08-24T11:15:00+03:00', files_count: 2,
        blocking_issues_count: 0, warning_issues_count: 1,
        reviewer: null,
      },
    ].filter((batch) => !search || `${batch.id} ${batch.document_type} ${batch.source_type}`.toLowerCase().includes(search));

    return { handled: true, response: { data: all, meta: { current_page: 1, last_page: 1, total: all.length } } };
  }

  if (method === 'GET' && reviewMatch) {
    return {
      handled: true,
      response: {
        data: {
          batch: {
            id: reviewMatch[1], document_type: 'purchase_invoice', status: state.status, version: state.version,
            reviewer: { id: 'demo-reviewer', name: 'أحمد المراجع' },
          },
          fields: state.fields,
          files: [{ id: 'demo-file-001', original_name: 'purchase-invoice-PI-2084.pdf', mime_type: 'application/pdf', page_count: 1, download_available: true }],
          matches: state.matches,
          issues: state.issues,
          history: state.history,
          purchase_draft: state.purchaseDraft,
          capabilities: { view: true, review: true, manage: true, build_draft: true },
        },
      },
    };
  }

  if (method === 'GET' && clean === '/document-files/demo-file-001/download-url') {
    return { handled: true, response: { url: 'about:blank', expires_at: '2026-08-25T10:00:00+03:00' } };
  }

  if (method === 'POST' && changeMatch) {
    if (String(requestBody.reason ?? '').includes('[stale]') || !validVersion(requestBody)) {
      return { handled: true, error: staleError() };
    }
    const target = String(requestBody.target_key ?? '').replace(/^fields\./, '');
    const field = state.fields.find((item) => item.key === target);
    if (field) {
      const before = field.current;
      field.current = requestBody.value as DemoField['current'];
      state.version += 1;
      addHistory('field_changed', String(requestBody.reason ?? ''), { value: before ?? '' }, { value: field.current ?? '' });
    }
    return { handled: true, response: { data: { id: 'demo-change' } } };
  }

  const confirm = clean.match(/^\/document-match-results\/(demo-match-[^/]+)\/confirm$/);
  if (method === 'POST' && confirm) {
    if (!validVersion(requestBody)) return { handled: true, error: staleError() };
    const match = state.matches.find((item) => item.id === confirm[1]);
    if (match) {
      match.status = 'confirmed';
      state.version += 1;
      addHistory('match_confirmed', String(requestBody.reason ?? ''), null, { candidate_id: String(requestBody.candidate_id ?? '') });
    }
    return { handled: true, response: { data: { id: 'demo-confirm' } } };
  }

  const reject = clean.match(/^\/document-match-results\/(demo-match-[^/]+)\/reject$/);
  if (method === 'POST' && reject) {
    if (!validVersion(requestBody)) return { handled: true, error: staleError() };
    const match = state.matches.find((item) => item.id === reject[1]);
    if (match) {
      match.status = 'rejected';
      state.version += 1;
      addHistory('match_rejected', String(requestBody.reason ?? ''), null, null);
    }
    return { handled: true, response: { data: { id: 'demo-reject' } } };
  }

  const issueAction = clean.match(/^\/document-issues\/(demo-issue-[^/]+)\/(resolve|reopen)$/);
  if (method === 'POST' && issueAction) {
    if (!validVersion(requestBody)) return { handled: true, error: staleError() };
    const issue = state.issues.find((item) => item.id === issueAction[1]);
    if (issue?.severity === 'blocking' && issue.code.startsWith('tax_') && issueAction[2] === 'resolve') {
      return { handled: true, error: new Error('financial_revalidation_required') };
    }
    if (issue) {
      issue.status = issueAction[2] === 'resolve' ? 'resolved' : 'open';
      state.version += 1;
      addHistory(issueAction[2] === 'resolve' ? 'issue_resolved' : 'issue_reopened', String(requestBody.reason ?? ''), null, { status: issue.status });
    }
    return { handled: true, response: { data: { id: 'demo-issue-action' } } };
  }

  if (method === 'POST' && revalidateMatch) {
    if (!validVersion(requestBody)) return { handled: true, error: staleError() };
    const taxIssue = state.issues.find((issue) => issue.code === 'tax_total_mismatch');
    if (taxIssue) {
      const taxField = state.fields.find((field) => field.key === 'tax_minor');
      taxIssue.status = taxField?.current === 37500 ? 'resolved' : 'open';
    }
    state.version += 1;
    addHistory('financial_revalidated', String(requestBody.reason ?? ''), null, { status: taxIssue?.status ?? 'resolved' });
    return { handled: true, response: { data: { id: 'demo-financial-revalidation' } } };
  }

  if (method === 'POST' && createDraftMatch) {
    if (state.purchaseDraft) {
      return { handled: true, response: { data: { ...state.purchaseDraft, transaction_type: 'purchase', idempotent_replay: true } } };
    }
    if (!validVersion(requestBody)) return { handled: true, error: staleError() };
    if (state.status !== 'ready_for_draft') return { handled: true, error: new Error('review_not_ready') };
    if (!String(requestBody.reason ?? '').trim()) return { handled: true, error: new Error('reason_required') };

    state.status = 'draft_created';
    state.version += 1;
    state.purchaseDraft = {
      purchase_id: 'demo-purchase-draft-001',
      purchase_number: 'PUR-DRAFT-2084',
      status: 'draft',
      url: '/purchases/demo-purchase-draft-001',
    };
    addHistory('purchase_draft_created', String(requestBody.reason), { status: 'ready_for_draft' }, { status: state.status, purchase_id: state.purchaseDraft.purchase_id });

    return { handled: true, response: { data: { ...state.purchaseDraft, transaction_type: 'purchase', idempotent_replay: false } } };
  }

  if (method === 'POST' && completeMatch) {
    if (state.status === 'ready_for_draft') return { handled: true, response: { data: { id: 'demo-complete' } } };
    if (!validVersion(requestBody)) return { handled: true, error: staleError() };
    if (!String(requestBody.reason ?? '').trim()) return { handled: true, error: new Error('reason_required') };
    if (!completeReady()) return { handled: true, error: new Error('review_not_ready') };
    state.status = 'ready_for_draft';
    state.version += 1;
    addHistory('review_completed', String(requestBody.reason), null, { status: state.status });
    return { handled: true, response: { data: { id: 'demo-complete' } } };
  }

  return { handled: false };
}
