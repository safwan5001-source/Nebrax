/**
 * عقد استقبال مركز المستندات — مرآة `StoreDocumentBatchRequest` و`config/document_center.php`.
 * نقطة حقيقة واحدة للواجهة؛ لا تُخترَع أنواع أو حدود خارج ما يفرضه الخادم.
 */

export const DOCUMENT_TYPES = [
  'purchase_invoice',
  'sales_invoice',
  'expense',
  'delivery_note',
  'receipt',
  'credit_note',
  'debit_note',
] as const;

export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const ACCEPTED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export const ACCEPTED_FILE_EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png', '.webp'] as const;

/** مرآة `document_center.intake.max_file_kilobytes` الافتراضية (20480 KB). */
export const MAX_FILE_BYTES = 20_480 * 1024;

/** مرآة `document_center.intake.max_files_per_batch` الافتراضية. */
export const MAX_FILES_PER_BATCH = 10;

export type WorkflowStatusGroup = 'inbox' | 'review' | 'ready' | 'completed' | 'terminal';

export type IntakeFile = {
  id: string;
  batch_id: string;
  original_name: string;
  mime_type: string | null;
  size_bytes: number;
  page_count: number | null;
  scan_status: string;
  retention_until: string | null;
  created_at: string | null;
};

export type IntakeBatch = {
  id: string;
  document_type: DocumentType;
  source_type: string;
  status: string;
  schema_version: number;
  version: number;
  files?: IntakeFile[];
  created_at: string | null;
};

const INBOX_STATUSES = new Set([
  'draft',
  'receiving',
  'received',
  'queued',
  'processing',
]);

const TERMINAL_STATUSES = new Set([
  'failed',
  'quarantined',
  'duplicate',
  'cancelled',
]);

/** يبني `FormData` لمسار رفع الملف — اسم الحقل `file` كما يتوقعه الخادم. */
export function intakeFileFormData(file: File): FormData {
  const form = new FormData();
  form.append('file', file);
  return form;
}

export function isAcceptedMimeType(mime: string): boolean {
  return (ACCEPTED_MIME_TYPES as readonly string[]).includes(mime);
}

export function isAcceptedFile(file: File): boolean {
  if (file.size > MAX_FILE_BYTES) return false;
  if (isAcceptedMimeType(file.type)) return true;

  const lower = file.name.toLowerCase();
  return ACCEPTED_FILE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export function workflowStatusGroup(status: string): WorkflowStatusGroup {
  if (INBOX_STATUSES.has(status)) return 'inbox';
  if (status === 'needs_review') return 'review';
  if (status === 'ready_for_draft' || status === 'creating_draft') return 'ready';
  if (status === 'reviewed' || status === 'draft_created' || status === 'archived') return 'completed';
  if (TERMINAL_STATUSES.has(status)) return 'terminal';
  return 'inbox';
}

/** يُرجع قائمة الحالات لمجموعة فلترة الواجهة. */
export function statusesForGroup(group: WorkflowStatusGroup): string[] {
  switch (group) {
    case 'inbox':
      return [...INBOX_STATUSES];
    case 'review':
      return ['needs_review'];
    case 'ready':
      return ['ready_for_draft', 'creating_draft'];
    case 'completed':
      return ['reviewed', 'draft_created', 'archived'];
    case 'terminal':
      return [...TERMINAL_STATUSES];
    default:
      return [];
  }
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
