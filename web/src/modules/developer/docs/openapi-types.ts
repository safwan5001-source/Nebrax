/**
 * أنواع النموذج المُنتقى المشتقّ من عقد OpenAPI 3.1 (`docs/openapi/public-api-v1.yaml`).
 *
 * هذه الأنواع يدويّة ومستقرّة؛ الملف المولَّد `openapi-model.generated.ts` يستوردها
 * ويصدّر الثابت المطابق لها. أي تغيير في شكل النموذج يُحرَّر هنا وفي مُحوّل البناء
 * (`web/scripts/openapi-transform.mjs`) معاً، ويحرسه اختبار الانحراف.
 */

/** حقل واحد في جدول حقول (طلب أو استجابة) مشتقّ من مخطّط JSON. */
export interface ApiField {
  name: string;
  /** تسمية نوع بشرية، مثل `string · uuid` أو `array of Product`. */
  type: string;
  required: boolean;
  nullable: boolean;
  readOnly: boolean;
  description?: string;
  /** قيود مقروءة: enum، الطول، المدى، النمط، الافتراضي. */
  constraints?: string;
  /** مثال مُسلسَل كنصّ JSON، إن وُجد في العقد. */
  example?: string;
}

export interface ApiParameter {
  name: string;
  in: 'path' | 'query' | 'header';
  required: boolean;
  description?: string;
  type: string;
  constraints?: string;
}

export interface ApiRequestBody {
  required: boolean;
  contentType: string;
  fields: ApiField[];
  /** كائن المثال الخام من العقد (يُستعمل لتوليد أمثلة الشيفرة). */
  example: unknown;
}

export type ApiResponseData =
  | { kind: 'list'; itemType: string; fields: ApiField[] }
  | { kind: 'object'; itemType: string; fields: ApiField[] };

export interface ApiResponse {
  status: string;
  description: string;
  headers: string[];
  data?: ApiResponseData;
}

export interface ApiOperation {
  id: string;
  method: 'get' | 'post' | 'patch' | 'put' | 'delete';
  path: string;
  summary?: string;
  description?: string;
  tag: string;
  /** النطاق المطلوب (`x-required-scope`)، أو null لعمليّة بلا نطاق (health). */
  scope: string | null;
  requiresAuth: boolean;
  idempotency: boolean;
  parameters: ApiParameter[];
  requestBody?: ApiRequestBody;
  responses: ApiResponse[];
}

export interface ApiTag {
  name: string;
  description?: string;
  operations: ApiOperation[];
}

export interface OpenApiModel {
  title: string;
  version: string;
  auth: { scheme: string; type: string; description: string };
  server: { template: string; baseUrlDefault: string; baseUrlDescription: string };
  /** كل النطاقات المشار إليها في العمليّات (مرتّبة، بلا تكرار). */
  scopes: string[];
  /** كتالوج أنواع أحداث الـ Webhooks. */
  events: string[];
  /** رموز الأخطاء الثابتة القابلة للقراءة آليًّا. */
  errorCodes: string[];
  notableHeaders: { name: string; description: string }[];
  tags: ApiTag[];
  /** مخطّطات متداخلة مُسمّاة يشير إليها حقلٌ ما (اسم النوع → حقوله المسطّحة). */
  schemas: Record<string, ApiField[]>;
}
