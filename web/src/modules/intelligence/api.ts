import { api } from '@/lib/api';
import type {
  AssistantStatus,
  AuditEvent,
  MessageResponse,
  SettingsPayload,
  ToolName,
  ToolRunResponse,
} from './contract';

/**
 * طبقة النداءات الوحيدة للمساعد. كل طلب يمرّ عبر `lib/api` (توكن Sanctum + الفرع النشط) إلى Laravel؛ لا مفاتيح
 * مزوّدين ولا نداء خارجي من المتصفح. لا شيء من نصوص المحادثة أو النتائج يُخزَّن هنا.
 */

export async function fetchStatus(): Promise<AssistantStatus> {
  const res = await api<{ data: AssistantStatus }>('/ai-assistant/status');
  return res.data;
}

export async function sendMessage(input: { message: string; locale: 'ar' | 'en'; branchIds?: string[] }): Promise<MessageResponse> {
  const res = await api<{ data: MessageResponse }>('/ai-assistant/messages', {
    method: 'POST',
    body: {
      message: input.message,
      locale: input.locale,
      ...(input.branchIds && input.branchIds.length > 0 ? { scope: { branch_ids: input.branchIds } } : {}),
    },
  });
  return res.data;
}

export async function runTool(input: {
  tool: ToolName;
  arguments: Record<string, string>;
  branchIds?: string[];
}): Promise<ToolRunResponse> {
  const res = await api<{ data: ToolRunResponse }>('/ai-assistant/tools/run', {
    method: 'POST',
    body: {
      tool: input.tool,
      arguments: input.arguments,
      ...(input.branchIds && input.branchIds.length > 0 ? { scope: { branch_ids: input.branchIds } } : {}),
    },
  });
  return res.data;
}

export async function saveSettings(payload: SettingsPayload): Promise<AssistantStatus> {
  const res = await api<{ data: AssistantStatus }>('/ai-assistant/settings', { method: 'PUT', body: payload });
  return res.data;
}

export async function fetchAuditEvents(perPage = 10): Promise<AuditEvent[]> {
  const res = await api<{ data: AuditEvent[] }>(`/ai-assistant/audit-events?per_page=${perPage}`);
  return res.data;
}
