import { api } from './api';

export interface SystemUpdate {
  id: string;
  status: 'draft' | 'published';
  target_type: 'all' | 'tenants' | 'users';
  title_ar: string;
  title_en: string;
  content_ar: string;
  content_en: string;
  published_at: string | null;
  created_at: string;
}

export interface PaginatedSystemUpdates {
  data: SystemUpdate[];
  meta?: { current_page: number; last_page: number; per_page: number; total: number };
}

export function fetchSystemUpdates(page = 1): Promise<PaginatedSystemUpdates> {
  return api<PaginatedSystemUpdates>(`/system-updates?page=${page}`);
}
