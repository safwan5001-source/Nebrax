/**
 * توليد أمثلة الطلبات **حتميّاً من العقد** (لا نصوص مكتوبة يدويّاً تتباعد عن الحقيقة).
 *
 * القواعد (§14): لا سرّ حقيقيّ قطّ — المفتاح والأصل متغيّرا بيئة (`$AWJ_API_KEY`,
 * `$AWJ_API_BASE`)؛ عمليّات الكتابة تُضمّن `Idempotency-Key` حين يفرضه العقد؛ الجسم
 * هو **مثال العقد نفسه** فلا حقل خارج المخطّط ولا مبلغ إلا بالوحدات الصغرى. الأصل لا
 * يُثبَّت بمضيف إنتاج (العقد يجعله متغيّر بيئة)، فيبقى المثال صحيحاً لأيّ نشر.
 */
import type { ApiOperation } from './openapi-types';

export interface CodeExample {
  language: 'bash' | 'javascript';
  label: string;
  code: string;
}

const KEY_VAR = '$AWJ_API_KEY';
const BASE_VAR = '$AWJ_API_BASE'; // الأصل + /api/v1 (متغيّر بيئة، لا مضيف مثبَّت)

/** يستبدل مَعالم المسار `{id}` بعنصر نائب مقروء `<id>`. */
function renderPath(path: string): string {
  return path.replace(/\{(\w+)\}/g, '<$1>');
}

/** مَعالم الاستعلام التمثيليّة لعمليّات القوائم (صفحة/حجم من العقد). */
function listQuery(op: ApiOperation): string {
  const hasPage = op.parameters.some((param) => param.name === 'page');
  return op.method === 'get' && hasPage ? '?page=1&per_page=25' : '';
}

function prettyBody(example: unknown): string {
  return JSON.stringify(example, null, 2);
}

/** مثال cURL — سطر لكل ترويسة، والجسم من مثال العقد. */
export function buildCurl(op: ApiOperation): string {
  const url = `${BASE_VAR}${renderPath(op.path)}${listQuery(op)}`;
  const lines = [`curl -X ${op.method.toUpperCase()} "${url}"`];

  if (op.requiresAuth) lines.push(`-H "Authorization: Bearer ${KEY_VAR}"`);
  lines.push('-H "Accept: application/json"');

  if (op.requestBody) lines.push('-H "Content-Type: application/json"');
  if (op.idempotency) lines.push('-H "Idempotency-Key: $(uuidgen)"');

  if (op.requestBody?.example != null) {
    lines.push(`-d '${prettyBody(op.requestBody.example)}'`);
  }

  return lines.join(' \\\n  ');
}

/** مثال JavaScript (fetch) — نفس العقد، بمفتاح ومفتاح idempotency حقيقيَّي النمط. */
export function buildJavaScript(op: ApiOperation): string {
  const url = `\`\${AWJ_API_BASE}${renderPath(op.path)}${listQuery(op)}\``;
  const headers: string[] = [];
  if (op.requiresAuth) headers.push('    Authorization: `Bearer ${AWJ_API_KEY}`,');
  headers.push('    Accept: "application/json",');
  if (op.requestBody) headers.push('    "Content-Type": "application/json",');
  if (op.idempotency) headers.push('    "Idempotency-Key": crypto.randomUUID(),');

  const init = [`  method: "${op.method.toUpperCase()}",`, '  headers: {', ...headers, '  },'];
  if (op.requestBody?.example != null) {
    const body = prettyBody(op.requestBody.example)
      .split('\n')
      .map((line, index) => (index === 0 ? line : `  ${line}`))
      .join('\n');
    init.push(`  body: JSON.stringify(${body}),`);
  }

  return [
    `const res = await fetch(${url}, {`,
    ...init,
    '});',
    'const data = await res.json();',
  ].join('\n');
}

export function buildExamples(op: ApiOperation): CodeExample[] {
  return [
    { language: 'bash', label: 'cURL', code: buildCurl(op) },
    { language: 'javascript', label: 'JavaScript', code: buildJavaScript(op) },
  ];
}
