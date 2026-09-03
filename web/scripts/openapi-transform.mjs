/**
 * تحويل نقيّ (بلا إدخال/إخراج) لعقد OpenAPI 3.1 الرسمي للـ Public API إلى **نموذج
 * مُنتقى** تستهلكه شاشة التوثيق في بوابة المطوّرين. يعمل هذا الملف في وقت البناء/الاختبار
 * فقط (Node)، ولا يُشحن إلى المتصفّح: المتصفّح يستورد الناتج الثابت وحده
 * (`openapi-model.generated.ts`).
 *
 * لماذا تحويل مُنتقى لا تمرير خام؟ لأن الشاشة تحتاج جداول حقول مسطّحة، ونطاقات، ورؤوساً
 * بارزة، ودلالة idempotency — لا مخطّط JSON خام تُغرَق به العين (§12/§364). المصدر الوحيد
 * للحقيقة يبقى ملف الـ YAML؛ اختبار الانحراف يُعيد الاشتقاق ويقارن، فلا يتباعد الناتج.
 *
 * الحتمية شرط: لا طوابع زمنية ولا ترتيب عشوائي — يُعاد ترتيب المجاميع (النطاقات/الرؤوس)
 * كي يطابق ناتجُ التحويل الملفَّ المُودَع بالضبط في اختبار الانحراف.
 */

/** يفكّ مؤشّر مرجع محلّي مثل `#/components/schemas/Partner`. */
function derefPointer(ref, spec) {
  const parts = String(ref).replace(/^#\//, '').split('/');
  let node = spec;
  for (const part of parts) {
    node = node?.[decodeURIComponent(part.replace(/~1/g, '/').replace(/~0/g, '~'))];
    if (node === undefined) return undefined;
  }
  return node;
}

/**
 * يعيد المخطّط بعد فكّ `$ref`، ويفكّ صيغة القابلية للعدم الشائعة في 3.1
 * (`oneOf`/`anyOf` من فرعٍ واحد + `{ type: null }`) إلى فرعها غير الصفري مع علَم
 * `nullable`. بذلك يظهر `branch_id` نوعاً «string · uuid» قابلاً للعدم لا «object».
 */
function resolveSchema(schema, spec, depth = 0) {
  let node = schema ?? {};
  let rn = null;
  if (depth > 12) return { schema: node, refName: null, nullable: false };

  if (node && typeof node === 'object' && typeof node.$ref === 'string') {
    rn = refName(node.$ref);
    node = derefPointer(node.$ref, spec) ?? {};
  }

  // allOf: دمج فرعٍ مرجعيّ مع قيوده الشقيقة (مثل `{ allOf: [MinorAmount], minimum: 0 }`).
  if (Array.isArray(node?.allOf)) {
    const { allOf, ...own } = node;
    let merged = {};
    for (const branch of allOf) {
      const inner = resolveSchema(branch, spec, depth + 1);
      if (inner.refName && !rn) rn = inner.refName;
      merged = { ...merged, ...inner.schema };
    }
    node = { ...merged, ...own };
  }

  const composite = node?.oneOf ?? node?.anyOf;
  if (Array.isArray(composite)) {
    const nonNull = composite.filter((branch) => !(branch && branch.type === 'null'));
    const hasNull = composite.some((branch) => branch && branch.type === 'null');
    if (nonNull.length === 1) {
      const inner = resolveSchema(nonNull[0], spec, depth + 1);
      return { schema: inner.schema, refName: inner.refName ?? rn, nullable: hasNull || inner.nullable };
    }
  }

  return { schema: node, refName: rn, nullable: false };
}

function refName(ref) {
  return String(ref).split('/').pop() ?? '';
}

/** أنواع OpenAPI 3.1 nullable تأتي كـ `type: [x, 'null']`. */
function normalizeType(schema) {
  const raw = schema?.type;
  if (Array.isArray(raw)) {
    const nonNull = raw.filter((entry) => entry !== 'null');
    return { base: nonNull[0] ?? 'string', nullable: raw.includes('null') };
  }
  return { base: raw, nullable: false };
}

/** تسمية نوع بشرية مقروءة لعمود «النوع» في جدول الحقول. */
function typeLabel(schemaOrRef, spec) {
  const { schema, refName: rn } = resolveSchema(schemaOrRef, spec);
  if (rn && rn !== 'Uuid' && rn !== 'MinorAmount' && rn !== 'CurrencyCode') {
    return rn; // مخطّط مُسمّى (مثل PartnerAddress) — نعرض اسمه
  }
  const { base } = normalizeType(schema);
  const format = schema?.format;
  // مخطّطات القيم البسيطة المُسمّاة تحمل دلالة أوضح من نوعها الخام
  if (rn === 'Uuid' || format === 'uuid') return 'string · uuid';
  if (rn === 'MinorAmount') return 'integer · minor units';
  if (rn === 'CurrencyCode') return 'string · ISO-4217';
  if (base === 'array') {
    const items = typeLabel(schema.items ?? {}, spec);
    return `array of ${items}`;
  }
  if (format) return `${base ?? 'string'} · ${format}`;
  if (Array.isArray(schema?.enum)) return `${base ?? 'string'} · enum`;
  return base ?? 'object';
}

/** قيود مقروءة (enum، الطول، المدى، النمط، الافتراضي) لعمود «القيود». */
function constraintsOf(schemaOrRef, spec) {
  const { schema } = resolveSchema(schemaOrRef, spec);
  const bits = [];
  if (Array.isArray(schema?.enum)) {
    const values = schema.enum.filter((entry) => entry !== null).map((entry) => String(entry));
    bits.push(`enum: ${values.join(' · ')}`);
  }
  if (schema?.minLength != null || schema?.maxLength != null) {
    bits.push(`length ${schema.minLength ?? 0}–${schema.maxLength ?? '∞'}`);
  }
  if (schema?.minimum != null || schema?.maximum != null) {
    bits.push(`range ${schema.minimum ?? '−∞'}–${schema.maximum ?? '∞'}`);
  }
  if (schema?.pattern) bits.push(`pattern ${schema.pattern}`);
  if (schema?.default !== undefined) bits.push(`default ${JSON.stringify(schema.default)}`);
  return bits.length ? bits.join(' · ') : undefined;
}

function exampleValue(schemaOrRef, spec) {
  const { schema } = resolveSchema(schemaOrRef, spec);
  if (schema?.example !== undefined) return schema.example;
  if (Array.isArray(schema?.examples) && schema.examples.length) return schema.examples[0];
  return undefined;
}

/** يسطّح خصائص مخطّط كائن إلى صفوف جدول حقول (مستوى واحد؛ المتداخل يُسمّى بنوعه). */
function flattenFields(schemaOrRef, spec) {
  const { schema } = resolveSchema(schemaOrRef, spec);
  const properties = schema?.properties ?? {};
  const required = new Set(schema?.required ?? []);
  return Object.entries(properties).map(([name, propRef]) => {
    const { schema: prop, nullable: composedNullable } = resolveSchema(propRef, spec);
    const nullable = composedNullable || normalizeType(prop).nullable;
    const example = exampleValue(propRef, spec);
    return {
      name,
      type: typeLabel(propRef, spec),
      required: required.has(name),
      nullable,
      readOnly: prop?.readOnly === true,
      description: prop?.description ? collapse(prop.description) : undefined,
      constraints: constraintsOf(propRef, spec),
      example: example === undefined ? undefined : JSON.stringify(example),
    };
  });
}

/** يطوي الفراغ المتعدّد في وصف YAML مطويّ إلى سطر واحد نظيف. */
function collapse(text) {
  return String(text).replace(/\s+/g, ' ').trim();
}

/** يبني مثال جسم الطلب: يفضّل مثال الوسيط الصريح، وإلا يشتقّ من مثال المخطّط. */
function requestExample(mediaType, spec) {
  if (mediaType?.example !== undefined) return mediaType.example;
  return exampleValue(mediaType?.schema ?? {}, spec) ?? null;
}

/** يجمع مَعاملات مستوى المسار ومستوى العملية، ويفكّ مراجعها. */
function collectParameters(pathItem, operation, spec) {
  const merged = [...(pathItem.parameters ?? []), ...(operation.parameters ?? [])];
  return merged.map((paramRef) => {
    const { schema: param } = resolveSchema(paramRef, spec);
    return {
      name: param.name,
      in: param.in,
      required: param.required === true || param.in === 'path',
      description: param.description ? collapse(param.description) : undefined,
      type: typeLabel(param.schema ?? {}, spec),
      constraints: constraintsOf(param.schema ?? {}, spec),
    };
  });
}

/** يستخرج حقول `data` من مخطّط استجابة مغلَّف (`{ data, meta }`). */
function responseDataFields(schemaRef, spec) {
  const { schema } = resolveSchema(schemaRef, spec);
  const dataProp = schema?.properties?.data;
  if (!dataProp) return undefined;
  const { schema: dataSchema, refName: rn } = resolveSchema(dataProp, spec);
  const { base } = normalizeType(dataSchema);
  // قائمة مغلَّفة: data مصفوفة عناصر مُسمّاة — نعرض حقول العنصر
  if (base === 'array') {
    const fields = flattenFields(dataSchema.items ?? {}, spec);
    return { kind: 'list', itemType: typeLabel(dataSchema.items ?? {}, spec), fields };
  }
  return { kind: 'object', itemType: rn ?? 'object', fields: flattenFields(dataProp, spec) };
}

function buildResponses(operation, spec) {
  return Object.entries(operation.responses ?? {}).map(([status, responseRef]) => {
    const { schema: response } = resolveSchema(responseRef, spec);
    const media = response?.content?.['application/json'];
    const data = media?.schema ? responseDataFields(media.schema, spec) : undefined;
    return {
      status,
      description: response?.description ? collapse(response.description) : '',
      headers: Object.keys(response?.headers ?? {}),
      data,
    };
  });
}

/**
 * التحويل الرئيس: يأخذ كائن OpenAPI المُحلَّل ويعيد النموذج المُنتقى.
 * @param {any} spec
 */
export function transformOpenApi(spec) {
  const tagOrder = (spec.tags ?? []).map((tag) => tag.name);
  const tagMeta = new Map((spec.tags ?? []).map((tag) => [tag.name, tag.description ? collapse(tag.description) : undefined]));
  /** @type {Map<string, any[]>} */
  const opsByTag = new Map(tagOrder.map((name) => [name, []]));
  const scopeSet = new Set();

  for (const [path, pathItem] of Object.entries(spec.paths ?? {})) {
    for (const method of ['get', 'post', 'patch', 'put', 'delete']) {
      const operation = pathItem[method];
      if (!operation) continue;

      const parameters = collectParameters(pathItem, operation, spec);
      const idempotency = parameters.some((param) => param.name === 'Idempotency-Key');
      const scope = operation['x-required-scope'];
      if (scope) scopeSet.add(scope);

      const media = operation.requestBody?.content?.['application/json'];
      const requestBody = media
        ? {
            required: operation.requestBody?.required === true,
            contentType: 'application/json',
            fields: flattenFields(media.schema ?? {}, spec),
            example: requestExample(media, spec),
          }
        : undefined;

      const op = {
        id: operation.operationId,
        method,
        path,
        summary: operation.summary ? collapse(operation.summary) : undefined,
        description: operation.description ? collapse(operation.description) : undefined,
        tag: operation.tags?.[0] ?? 'Other',
        scope: scope ?? null,
        // الأمن: [] صريحة = بلا مصادقة (health)؛ غيرها يرث الأمن العام
        requiresAuth: Array.isArray(operation.security) ? operation.security.length > 0 : true,
        idempotency,
        parameters,
        requestBody,
        responses: buildResponses(operation, spec),
      };

      if (!opsByTag.has(op.tag)) opsByTag.set(op.tag, []);
      opsByTag.get(op.tag).push(op);
    }
  }

  const tags = [...opsByTag.entries()]
    .filter(([, operations]) => operations.length > 0)
    .map(([name, operations]) => ({ name, description: tagMeta.get(name), operations }));

  // مخطّطات متداخلة مُسمّاة يشير إليها أيّ حقل (مثل InvoiceLineCreate, PartnerAddress):
  // تُجمَع تعديّاً كي يتمكّن التوثيق من توسيع صفوفها بدل ترك «array of X» مبهماً (§12).
  const nestedSchemas = collectReferencedSchemas(tags, spec);

  const server = (spec.servers ?? [])[0] ?? {};
  const baseUrlVar = server.variables?.baseUrl ?? {};

  const events = spec.components?.schemas?.WebhookEventType?.enum ?? [];
  const errorCodes = spec.components?.schemas?.Error?.properties?.code?.enum ?? [];

  // رؤوس بارزة يوثّقها العقد صراحةً (للأمن والتوثيق) — بترتيب ثابت لا أبجديّ عشوائيّ.
  const headerNames = ['Idempotency-Key', 'X-Request-Id', 'X-RateLimit-Limit', 'X-RateLimit-Remaining', 'Retry-After', 'X-RateLimit-Reset', 'Idempotency-Replayed'];
  const paramHeaders = new Map(
    Object.values(spec.components?.parameters ?? {})
      .filter((param) => param.in === 'header')
      .map((param) => [param.name, param.description ? collapse(param.description) : undefined]),
  );
  const respHeaders = spec.components?.headers ?? {};
  const notableHeaders = headerNames
    .map((name) => {
      const key = Object.keys(respHeaders).find((headerKey) => headerKey.toLowerCase().replace(/[^a-z]/g, '') === name.toLowerCase().replace(/[^a-z]/g, ''));
      const description = paramHeaders.get(name) ?? (key ? collapse(respHeaders[key].description ?? '') : undefined);
      return description ? { name, description } : null;
    })
    .filter(Boolean);

  return {
    title: spec.info?.title ?? 'AWJ Public API',
    version: spec.info?.version ?? 'v1',
    auth: {
      scheme: 'bearerApiKey',
      type: spec.components?.securitySchemes?.bearerApiKey?.scheme ?? 'bearer',
      description: collapse(spec.components?.securitySchemes?.bearerApiKey?.description ?? ''),
    },
    server: {
      template: server.url ?? '{baseUrl}/api/v1',
      baseUrlDefault: baseUrlVar.default ?? 'https://api.example.com',
      baseUrlDescription: baseUrlVar.description ? collapse(baseUrlVar.description) : '',
    },
    scopes: [...scopeSet].sort(),
    events,
    errorCodes,
    notableHeaders,
    tags,
    schemas: nestedSchemas,
  };
}

/** يجمع المخطّطات الكائنيّة المُسمّاة التي تشير إليها حقولُ العمليّات، تعديّاً. */
function collectReferencedSchemas(tags, spec) {
  const nameRe = /^(?:array of )?([A-Za-z_][\w]*)$/;
  const pending = [];
  const push = (typeStr) => {
    const match = nameRe.exec(typeStr ?? '');
    if (match) pending.push(match[1]);
  };

  for (const tag of tags) {
    for (const op of tag.operations) {
      (op.requestBody?.fields ?? []).forEach((field) => push(field.type));
      for (const response of op.responses) {
        (response.data?.fields ?? []).forEach((field) => push(field.type));
      }
    }
  }

  const out = {};
  while (pending.length) {
    const name = pending.pop();
    if (out[name]) continue;
    const schema = spec.components?.schemas?.[name];
    if (!schema) continue;
    const { schema: resolved } = resolveSchema(schema, spec);
    if (resolved?.type !== 'object' || !resolved.properties) continue;
    const fields = flattenFields(schema, spec);
    out[name] = fields;
    fields.forEach((field) => push(field.type));
  }

  // ترتيب أبجديّ ثابت للمفاتيح — حتميّة ناتج اختبار الانحراف.
  return Object.fromEntries(Object.keys(out).sort().map((key) => [key, out[key]]));
}
