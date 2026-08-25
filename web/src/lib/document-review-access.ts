export function canViewDocumentCenter(permissions?: string[], role?: string): boolean {
  return permissions?.includes('documents.center.view') ?? ['owner', 'admin'].includes(role ?? '');
}
