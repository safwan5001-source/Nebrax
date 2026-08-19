import type { AssignmentUsage } from './components/print-template-assignment-contract';
import {
  TEMPLATE_CENTER_FAMILIES,
  type TemplateCenterFamilyId,
} from './template-center-catalog';
import type { DocumentTypeId } from '@/modules/documents/types';

export type TemplateLibraryRevisionStatus = 'all' | 'draft' | 'published' | 'unassigned';
export type TemplateLibraryUsage = 'all' | AssignmentUsage;
export type TemplateLibraryAssignmentScope = 'all' | 'company' | string;

export interface TemplateLibraryRevision {
  id: string;
  version: number;
  status: 'draft' | 'published' | 'superseded';
  document_types: DocumentTypeId[];
  created_at?: string | null;
  published_at?: string | null;
}

export interface TemplateLibraryTemplate {
  id: string;
  name: string;
  status: 'draft' | 'published' | 'archived';
  document_types: DocumentTypeId[];
  draft_revision?: TemplateLibraryRevision | null;
  published_revision?: TemplateLibraryRevision | null;
  updated_at?: string | null;
}

export interface TemplateLibraryAssignment {
  id: string;
  branch_id: string | null;
  scope: 'company' | 'branch';
  document_type: DocumentTypeId;
  usage: AssignmentUsage;
  print_template_revision_id: string;
}

export interface TemplateLibraryFilters {
  query: string;
  family: TemplateCenterFamilyId | 'all';
  documentType: DocumentTypeId | 'all';
  revisionStatus: TemplateLibraryRevisionStatus;
  usage: TemplateLibraryUsage;
  assignmentScope: TemplateLibraryAssignmentScope;
}

export function templateFamilyForDocumentType(type: DocumentTypeId): TemplateCenterFamilyId | null {
  return TEMPLATE_CENTER_FAMILIES.find((family) => family.documentTypes.includes(type))?.id ?? null;
}

export function assignmentsForTemplate(
  template: TemplateLibraryTemplate,
  assignments: readonly TemplateLibraryAssignment[],
): TemplateLibraryAssignment[] {
  const revisionId = template.published_revision?.id;
  return revisionId
    ? assignments.filter((assignment) => assignment.print_template_revision_id === revisionId)
    : [];
}

export function filterTemplateLibrary(
  templates: readonly TemplateLibraryTemplate[],
  assignments: readonly TemplateLibraryAssignment[],
  filters: TemplateLibraryFilters,
  labelForDocumentType: (type: DocumentTypeId) => string,
): TemplateLibraryTemplate[] {
  const normalizedQuery = filters.query.trim().toLocaleLowerCase();
  const familyTypes = filters.family === 'all'
    ? null
    : TEMPLATE_CENTER_FAMILIES.find((family) => family.id === filters.family)?.documentTypes ?? [];

  return templates.filter((template) => {
    const documentTypes = template.draft_revision?.document_types
      ?? template.published_revision?.document_types
      ?? template.document_types;
    const templateAssignments = assignmentsForTemplate(template, assignments);
    const hasDraft = template.draft_revision != null;
    const hasPublished = template.published_revision != null;
    const isUnassigned = hasPublished && templateAssignments.length === 0;

    if (filters.family !== 'all' && !documentTypes.some((type) => familyTypes?.includes(type))) return false;
    if (filters.documentType !== 'all' && !documentTypes.includes(filters.documentType)) return false;
    if (filters.revisionStatus === 'draft' && !hasDraft) return false;
    if (filters.revisionStatus === 'published' && !hasPublished) return false;
    if (filters.revisionStatus === 'unassigned' && !isUnassigned) return false;
    if (filters.usage !== 'all' && !templateAssignments.some((assignment) => assignment.usage === filters.usage)) return false;
    if (filters.assignmentScope !== 'all' && !templateAssignments.some((assignment) => (
      filters.assignmentScope === 'company'
        ? assignment.scope === 'company'
        : assignment.branch_id === filters.assignmentScope
    ))) return false;

    return !normalizedQuery || template.name.toLocaleLowerCase().includes(normalizedQuery)
      || documentTypes.some((type) => labelForDocumentType(type).toLocaleLowerCase().includes(normalizedQuery));
  });
}
