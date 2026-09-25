/**
 * LIVE-PREVIEW-2 (`AWJ_APP_BUILDER_LIVE_RUNTIME_PREVIEW_V1.md`) — a narrow,
 * pure TypeScript port of `mobile/lib/app/binding_resolution.dart`'s
 * "collection/template hydration" + "visibility handling" pipeline.
 *
 * **This file is a derived mirror, not an independently evolving
 * interpreter.** `mobile/lib/app/binding_resolution.dart` is the one source
 * of truth for what `$item.*` substitution, `binding.collect` repetition,
 * and `visibility` evaluation mean — every function here must produce the
 * exact same output as its Dart counterpart for the exact same input. This
 * is the same pattern the backend already uses twice (`CompatibilityResolver.php`
 * mirrors `compatibility.dart`; `RuntimeCapabilities.php` mirrors
 * `registry_identifiers.dart`) — a documented literal port, not a second,
 * independently-designed schema interpreter (Decision Gate 2 of the
 * horizon). Drift between this file and the Dart source is made detectable,
 * not merely promised by comment, by `contracts/app-builder/
 * binding-visibility-conformance.v1.json`: a single canonical fixture set
 * both `runtime-contract.test.ts` (this port) and
 * `mobile/test/app/binding_visibility_conformance_test.dart` (the Dart
 * original) load and assert against. A behavior change on either side that
 * is not reflected in that shared file fails that side's own conformance
 * test — see `runtime-contract.test.ts`'s header for how CI enforces this.
 *
 * **LIVE-PREVIEW-2 scope note**: this module is the shared contract only.
 * It is not yet consumed by `canvas.tsx` — wiring live resource data and
 * visibility signals into the actual Preview render is LIVE-PREVIEW-3
 * (binding/collection) and LIVE-PREVIEW-4 (visibility/action/theme), per
 * the horizon's own task breakdown. No runtime capability is broadened
 * here: every fail-closed rule below is preserved exactly as Dart defines
 * it, never loosened.
 */

import type { AppSchemaBinding, AppSchemaComponent, VisibilityNode } from '@/lib/app-builder';
import { isVisibilityLeaf } from '@/lib/app-builder';

const ITEM_REF_PREFIX = '$item.';

/**
 * Mirrors `mobile/lib/schema/visibility_vocabulary.dart`'s `VisibilityOperator`
 * wire values literally — an identity dictionary only, never a general
 * expression engine.
 */
const VisibilityOperator = {
  equals: 'equals',
  notEquals: 'notEquals',
  greaterThan: 'gt',
  lessThan: 'lt',
  greaterThanOrEqual: 'gte',
  lessThanOrEqual: 'lte',
  inList: 'in',
  isTrue: 'isTrue',
  isFalse: 'isFalse',
} as const;

/** Mirrors `binding_resolution.dart`'s `readFieldPath` exactly: descends only through plain-object keys, fails closed to `null` the moment a segment is missing or the current value is not an object — never throws. */
export function readFieldPath(value: unknown, path: string): unknown {
  let current: unknown = value;
  for (const segment of path.split('.')) {
    if (current !== null && typeof current === 'object' && !Array.isArray(current)) {
      current = (current as Record<string, unknown>)[segment];
    } else {
      return null;
    }
  }
  // A JS object-key miss yields `undefined`; Dart's `Map` lookup for the
  // same miss yields `null` — normalize so this port's fail-closed "missing
  // field" value matches the Dart source exactly, not JavaScript's own.
  return current === undefined ? null : current;
}

function isItemRef(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(ITEM_REF_PREFIX);
}

function resolveItemRef(ref: string, item: unknown): unknown {
  const path = ref.slice(ITEM_REF_PREFIX.length);
  if (path.length === 0) return null;
  return readFieldPath(item, path);
}

function substituteValue(value: unknown, item: unknown): unknown {
  if (isItemRef(value)) return resolveItemRef(value, item);
  if (Array.isArray(value)) return value.map((entry) => substituteValue(entry, item));
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, entryValue] of Object.entries(value as Record<string, unknown>)) {
      result[key] = substituteValue(entryValue, item);
    }
    return result;
  }
  return value;
}

/** Mirrors `substituteItemRefsInProps` exactly — every exact `"$item.<field>"` string value, at any nesting depth, replaced by that field's value read off `item`. */
export function substituteItemRefsInProps(
  props: Record<string, unknown> | undefined,
  item: unknown
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props ?? {})) {
    result[key] = substituteValue(value, item);
  }
  return result;
}

/** Mirrors `substituteItemRefsInAction` exactly — only `params` values resolve per-item; `type` is fixed at authoring time. */
export function substituteItemRefsInAction(
  action: AppSchemaComponent['action'] | undefined,
  item: unknown
): AppSchemaComponent['action'] | undefined {
  if (!action) return undefined;
  return { type: action.type, params: substituteItemRefsInProps(action.params, item) };
}

function itemId(item: unknown): string | null {
  if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
    const id = (item as Record<string, unknown>).id;
    if (typeof id === 'string' && id.length > 0) return id;
  }
  return null;
}

/**
 * Mirrors `_instantiateTemplateDescendant` exactly: a descendant several
 * levels inside a repeated template. Its own `binding` is dropped (never
 * evaluated) — the Dart source's deliberate deferral of nested/template
 * binding evaluation, mirrored bit-for-bit here even though the doc
 * comment on the Dart side describes it as "preserved structurally"; the
 * executable behavior (not the comment) is this port's contract.
 */
function instantiateTemplateDescendant(node: AppSchemaComponent, item: unknown): AppSchemaComponent {
  return {
    type: node.type,
    id: node.id,
    optional: node.optional ?? false,
    props: substituteItemRefsInProps(node.props, item),
    children: (node.children ?? []).map((child) => instantiateTemplateDescendant(child, item)),
    ...(node.action ? { action: substituteItemRefsInAction(node.action, item) } : {}),
    ...(node.visibility ? { visibility: node.visibility } : {}),
  };
}

/** Mirrors `_instantiateTemplate` exactly, including its id-disambiguation rule: `<templateId>-<item.id>` when the item has a non-empty string `id`, else `<templateId>-<index>`. */
function instantiateTemplate(template: AppSchemaComponent, item: unknown, index: number): AppSchemaComponent {
  const id = itemId(item);
  const instanceId = `${template.id}-${id ?? index}`;
  return {
    type: template.type,
    id: instanceId,
    optional: template.optional ?? false,
    props: substituteItemRefsInProps(template.props, item),
    children: (template.children ?? []).map((child) => instantiateTemplateDescendant(child, item)),
    ...(template.action ? { action: substituteItemRefsInAction(template.action, item) } : {}),
    ...(template.visibility ? { visibility: template.visibility } : {}),
  };
}

/**
 * Mirrors `_repeatTemplate` exactly: repeats `node`'s single authored child
 * once per entry in `items`. Fails closed to zero children (never throws)
 * unless `node` declares exactly one template child — a `collect` binding
 * with no authored template, or more than one, has nothing well-defined to
 * repeat.
 */
function repeatTemplate(node: AppSchemaComponent, items: unknown[]): AppSchemaComponent {
  const templateChildren = node.children ?? [];
  const children =
    templateChildren.length === 1
      ? items.map((item, index) => instantiateTemplate(templateChildren[0], item, index))
      : [];
  return {
    type: node.type,
    id: node.id,
    optional: node.optional ?? false,
    props: node.props ?? {},
    children,
    ...(node.action ? { action: node.action } : {}),
    ...(node.visibility ? { visibility: node.visibility } : {}),
  };
}

function resolveBoundNode(
  node: AppSchemaComponent,
  binding: AppSchemaBinding,
  resourceData: Record<string, unknown>
): AppSchemaComponent {
  const resolvedResource = resourceData[binding.resource];

  // `collect` always means "repeat" — already proven safe for this schema
  // by CompatibilityResolver (a contractually list-typed target). If the
  // *runtime* value is not actually a list (defensive case only), this
  // fails closed to zero items rather than falling through to single-item
  // `itemProps` semantics, which would silently mix two binding modes.
  if (binding.collect) {
    const target = readFieldPath(resolvedResource, binding.collect);
    return repeatTemplate(node, Array.isArray(target) ? target : []);
  }

  // "collection is the resource result itself" — no `collect` needed when
  // the resource's own wire shape is already a list.
  if (Array.isArray(resolvedResource)) {
    return repeatTemplate(node, resolvedResource);
  }

  // Single-item binding: the resolved resource itself is "the item" —
  // existing `itemProps` semantics, unchanged.
  const newProps: Record<string, unknown> = { ...(node.props ?? {}) };
  for (const [propKey, fieldPath] of Object.entries(binding.itemProps ?? {})) {
    newProps[propKey] = readFieldPath(resolvedResource, fieldPath);
  }
  return {
    type: node.type,
    id: node.id,
    optional: node.optional ?? false,
    props: newProps,
    children: (node.children ?? []).map((child) => resolveNodeBindings(child, resourceData)),
    ...(node.action ? { action: node.action } : {}),
    ...(node.visibility ? { visibility: node.visibility } : {}),
  };
}

/**
 * Mirrors `resolveNodeBindings` exactly: resolves every `binding` node
 * under (and including) `root` against already-fetched raw resource data,
 * producing an ordinary, fully-literal `AppSchemaComponent` tree — no node
 * in the result carries a `binding`, and no unresolved `$item.*` string
 * remains anywhere in it.
 */
export function resolveNodeBindings(
  root: AppSchemaComponent,
  resourceData: Record<string, unknown>
): AppSchemaComponent {
  const binding = root.binding;
  if (!binding) {
    return {
      ...root,
      optional: root.optional ?? false,
      props: root.props ?? {},
      children: (root.children ?? []).map((child) => resolveNodeBindings(child, resourceData)),
    };
  }
  return resolveBoundNode(root, binding, resourceData);
}

function compareOp(a: unknown, b: unknown, test: (comparison: number) => boolean): boolean {
  if (typeof a === 'number' && typeof b === 'number') return test(a === b ? 0 : a < b ? -1 : 1);
  return false;
}

/**
 * Mirrors `evaluateVisibility` exactly against `VisibilitySignal`'s closed
 * vocabulary — resolved to whatever the caller currently knows about
 * cart/customer/product context. Never a free expression; an operator
 * outside the closed set fails closed to `false` (hidden), matching the
 * Dart source's own "unreachable once past CompatibilityResolver — fails
 * closed regardless" comment.
 */
export function evaluateVisibility(condition: VisibilityNode, signals: Record<string, unknown>): boolean {
  if (!isVisibilityLeaf(condition)) {
    if ('all' in condition) return condition.all.every((branch) => evaluateVisibility(branch, signals));
    return condition.any.some((branch) => evaluateVisibility(branch, signals));
  }

  const actual = signals[condition.signal];
  const expected = condition.value;
  switch (condition.operator) {
    case VisibilityOperator.isTrue:
      return actual === true;
    case VisibilityOperator.isFalse:
      return actual === false;
    case VisibilityOperator.equals:
      return actual === expected;
    case VisibilityOperator.notEquals:
      return actual !== expected;
    case VisibilityOperator.greaterThan:
      return compareOp(actual, expected, (c) => c > 0);
    case VisibilityOperator.lessThan:
      return compareOp(actual, expected, (c) => c < 0);
    case VisibilityOperator.greaterThanOrEqual:
      return compareOp(actual, expected, (c) => c >= 0);
    case VisibilityOperator.lessThanOrEqual:
      return compareOp(actual, expected, (c) => c <= 0);
    case VisibilityOperator.inList:
      return Array.isArray(expected) && expected.some((candidate) => candidate === actual);
    default:
      return false; // unreachable once past CompatibilityResolver — fails closed (hidden) regardless.
  }
}

/**
 * Mirrors `pruneInvisible` exactly: removes every node whose own
 * `visibility` condition evaluates to `false` against `signals` (and, with
 * it, that node's whole subtree). Visibility is presentation-only — unlike
 * `CompatibilityResolver`'s optional/required fallback rule, a hidden node
 * is simply dropped regardless of its `optional` flag, and hiding a node is
 * never treated as (or a substitute for) authorization.
 */
export function pruneInvisible(node: AppSchemaComponent, signals: Record<string, unknown>): AppSchemaComponent | null {
  if (node.visibility && !evaluateVisibility(node.visibility, signals)) return null;

  const children: AppSchemaComponent[] = [];
  for (const child of node.children ?? []) {
    const kept = pruneInvisible(child, signals);
    if (kept) children.push(kept);
  }
  return { ...node, children };
}
