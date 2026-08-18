import type { AssignmentUsage } from './components/print-template-assignment-contract';
import type { DocumentTypeId } from '@/modules/documents/types';

export type TemplateCreationStep = 1 | 2 | 3;

export type TemplateCreationSource =
  | { kind: 'base' }
  | { kind: 'published'; templateId: string; revisionId: string; version: number };

export interface TemplateCreationDraft {
  documentType: DocumentTypeId;
  usage: AssignmentUsage;
  source: TemplateCreationSource;
  name: string;
}

export interface TemplateCreationCandidate {
  id: string;
  name: string;
  document_types: readonly DocumentTypeId[];
  published_revision?: {
    id: string;
    version: number;
    document_types: readonly DocumentTypeId[];
  } | null;
}

export interface PublishedTemplateSource {
  templateId: string;
  revisionId: string;
  name: string;
  version: number;
  documentTypes: readonly DocumentTypeId[];
}

export function initialTemplateCreationDraft(documentType: DocumentTypeId, name = ''): TemplateCreationDraft {
  return {
    documentType,
    usage: 'print',
    source: { kind: 'base' },
    name,
  };
}

/** لا تعرض P44 إلا مراجعات منشورة صالحة لنوع المستند المختار. */
export function publishedSourcesForDocumentType(
  templates: readonly TemplateCreationCandidate[],
  documentType: DocumentTypeId,
): PublishedTemplateSource[] {
  return templates.flatMap((template) => {
    const revision = template.published_revision;
    const types = revision?.document_types ?? template.document_types;
    if (!revision || !types.includes(documentType)) return [];

    return [{
      templateId: template.id,
      revisionId: revision.id,
      name: template.name,
      version: revision.version,
      documentTypes: types,
    }];
  });
}

export function sourceSupportsDocumentType(
  source: TemplateCreationSource,
  templates: readonly TemplateCreationCandidate[],
  documentType: DocumentTypeId,
): boolean {
  if (source.kind === 'base') return true;
  return publishedSourcesForDocumentType(templates, documentType).some((candidate) => (
    candidate.templateId === source.templateId && candidate.revisionId === source.revisionId
  ));
}

export function canContinueTemplateCreation(
  step: TemplateCreationStep,
  draft: TemplateCreationDraft,
  templates: readonly TemplateCreationCandidate[],
): boolean {
  if (step === 1) return Boolean(draft.documentType && draft.usage);
  if (step === 2) return sourceSupportsDocumentType(draft.source, templates, draft.documentType);
  return draft.name.trim().length > 0;
}

export function creationStepLabel(step: TemplateCreationStep): 'details' | 'source' | 'review' {
  return step === 1 ? 'details' : step === 2 ? 'source' : 'review';
}
