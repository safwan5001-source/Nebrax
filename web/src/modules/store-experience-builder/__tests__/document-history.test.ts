import { describe, expect, it } from "vitest";
import {
  DEFAULT_COALESCE_WINDOW_MS,
  DEFAULT_MAX_HISTORY_ENTRIES,
  canRedo,
  canUndo,
  createHistory,
  markSaved,
  recordEdit,
  redo,
  resetHistory,
  undo,
  type DocumentHistory,
} from "../history/document-history";
import {
  DEFAULT_PRESENTATION_CONFIG,
  clonePresentationConfig,
  normalizePresentationConfig,
  presentationConfigsEqual,
  type StorefrontPresentationConfig,
} from "../presentation/config";
import { deleteSection, duplicateSection, moveSection, setSectionVisible } from "../presentation/section-ops";

const V1 = "version-1";
const V2 = "version-2";

type Doc = { n: number };
const doc = (n: number): Doc => ({ n });

function edit(state: DocumentHistory<Doc>, n: number, at = 0, group?: string, scope = V1) {
  return recordEdit(state, scope, doc(n), { now: at, group });
}

describe("document-history — core (CUST-H5-1)", () => {
  it("starts with nothing to undo or redo", () => {
    const s = createHistory(V1, doc(0));
    expect(canUndo(s)).toBe(false);
    expect(canRedo(s)).toBe(false);
  });

  it("each ungrouped edit is its own step; undo/redo walk them in order", () => {
    let s = createHistory(V1, doc(0));
    s = edit(s, 1);
    s = edit(s, 2);
    s = edit(s, 3);
    expect(s.present).toEqual(doc(3));
    s = undo(s, V1);
    expect(s.present).toEqual(doc(2));
    s = undo(s, V1);
    expect(s.present).toEqual(doc(1));
    s = redo(s, V1);
    expect(s.present).toEqual(doc(2));
    s = redo(s, V1);
    expect(s.present).toEqual(doc(3));
    expect(canRedo(s)).toBe(false);
  });

  it("an edit that changes nothing is not a step and keeps the redo branch", () => {
    let s = edit(createHistory(V1, doc(0)), 1);
    s = undo(s, V1);
    const same = recordEdit(s, V1, doc(0), { now: 0 });
    expect(same).toBe(s);
    expect(canRedo(same)).toBe(true);
  });

  it("a new edit after undo drops the redo branch", () => {
    let s = createHistory(V1, doc(0));
    s = edit(s, 1);
    s = edit(s, 2);
    s = undo(s, V1);
    s = undo(s, V1);
    expect(canRedo(s)).toBe(true);
    s = edit(s, 9);
    expect(canRedo(s)).toBe(false);
    expect(s.future).toEqual([]);
    expect(undo(s, V1).present).toEqual(doc(0));
  });

  it("undo and redo at the ends return the same state reference", () => {
    const s = createHistory(V1, doc(0));
    expect(undo(s, V1)).toBe(s);
    expect(redo(s, V1)).toBe(s);
  });

  it("history is bounded: the oldest step drops first", () => {
    let s = createHistory(V1, doc(0));
    const total = DEFAULT_MAX_HISTORY_ENTRIES + 25;
    for (let i = 1; i <= total; i += 1) s = edit(s, i);
    expect(s.past).toHaveLength(DEFAULT_MAX_HISTORY_ENTRIES);
    // The earliest reachable state is total - max, never the original 0.
    let cursor = s;
    while (canUndo(cursor)) cursor = undo(cursor, V1);
    expect(cursor.present).toEqual(doc(total - DEFAULT_MAX_HISTORY_ENTRIES));
  });

  it("honours a custom maxEntries and never goes below one step", () => {
    let s = createHistory(V1, doc(0));
    for (let i = 1; i <= 5; i += 1) s = recordEdit(s, V1, doc(i), { now: 0 }, { maxEntries: 0 });
    expect(s.past).toHaveLength(1);
    expect(undo(s, V1).present).toEqual(doc(4));
  });
});

describe("document-history — grouping", () => {
  it("a burst with one group key inside the window is a single undo step", () => {
    let s = createHistory(V1, doc(0));
    s = edit(s, 1, 0, "text:headline");
    s = edit(s, 2, 300, "text:headline");
    s = edit(s, 3, 700, "text:headline");
    expect(s.past).toHaveLength(1);
    s = undo(s, V1);
    expect(s.present).toEqual(doc(0));
    expect(canUndo(s)).toBe(false);
  });

  it("the window slides: each edit extends it", () => {
    let s = createHistory(V1, doc(0));
    s = edit(s, 1, 0, "g");
    s = edit(s, 2, 900, "g");
    s = edit(s, 3, 1800, "g");
    expect(s.past).toHaveLength(1);
  });

  it("a pause longer than the window starts a new step", () => {
    let s = createHistory(V1, doc(0));
    s = edit(s, 1, 0, "g");
    s = edit(s, 2, DEFAULT_COALESCE_WINDOW_MS + 1, "g");
    expect(s.past).toHaveLength(2);
  });

  it("a different group key starts a new step", () => {
    let s = createHistory(V1, doc(0));
    s = edit(s, 1, 0, "text:headline");
    s = edit(s, 2, 10, "text:subheadline");
    expect(s.past).toHaveLength(2);
  });

  it("an ungrouped edit never coalesces, even right after a grouped one", () => {
    let s = createHistory(V1, doc(0));
    s = edit(s, 1, 0, "g");
    s = edit(s, 2, 10);
    s = edit(s, 3, 20, "g");
    expect(s.past).toHaveLength(3);
  });

  it("undo ends the burst: the next grouped edit is a fresh step", () => {
    let s = createHistory(V1, doc(0));
    s = edit(s, 1, 0, "g");
    s = edit(s, 2, 10, "g");
    s = undo(s, V1);
    s = redo(s, V1);
    s = edit(s, 3, 20, "g");
    expect(s.past).toHaveLength(2);
    expect(undo(s, V1).present).toEqual(doc(2));
  });

  it("a burst that returns to where it began leaves no step behind", () => {
    let s = createHistory(V1, doc(0));
    s = edit(s, 1, 0, "g");
    s = edit(s, 0, 10, "g");
    expect(s.present).toEqual(doc(0));
    expect(canUndo(s)).toBe(false);
  });

  it("a coalesced edit still drops the redo branch", () => {
    let s = createHistory(V1, doc(0));
    s = edit(s, 1, 0, "other");
    s = edit(s, 2, 5000, "g");
    s = edit(s, 3, 5100, "g");
    s = undo(s, V1);
    expect(canRedo(s)).toBe(true);
    s = edit(s, 4, 9000, "g");
    expect(canRedo(s)).toBe(false);
  });

  it("a clock that goes backwards does not coalesce", () => {
    let s = createHistory(V1, doc(0));
    s = edit(s, 1, 5000, "g");
    s = edit(s, 2, 100, "g");
    expect(s.past).toHaveLength(2);
  });
});

describe("document-history — scope and boundaries", () => {
  it("operations for another Version are ignored entirely", () => {
    let s = createHistory(V1, doc(0));
    s = edit(s, 1);
    expect(edit(s, 5, 0, undefined, V2)).toBe(s);
    expect(undo(s, V2)).toBe(s);
    expect(redo(s, V2)).toBe(s);
    expect(markSaved(s, V2, doc(9), false)).toBe(s);
  });

  it("a null scope (no open Version) can never undo or redo", () => {
    const s = createHistory<Doc>(null, doc(0));
    expect(canUndo(s)).toBe(false);
    expect(recordEdit(s, V1, doc(1), { now: 0 })).toBe(s);
  });

  it("resetHistory replaces scope and clears both stacks (Version switch / discard / publish)", () => {
    let s = createHistory(V1, doc(0));
    s = edit(s, 1);
    s = edit(s, 2);
    s = undo(s, V1);
    const fresh = resetHistory(V2, doc(7));
    expect(fresh.scopeKey).toBe(V2);
    expect(canUndo(fresh)).toBe(false);
    expect(canRedo(fresh)).toBe(false);
    // The old Version can no longer drive the new session.
    expect(undo(fresh, V1)).toBe(fresh);
  });

  it("successful Save is a hard boundary: both stacks clear and the saved document is present", () => {
    let s = createHistory(V1, doc(0));
    s = edit(s, 1);
    s = edit(s, 2);
    s = undo(s, V1);
    s = markSaved(s, V1, doc(1), false);
    expect(s.present).toEqual(doc(1));
    expect(canUndo(s)).toBe(false);
    expect(canRedo(s)).toBe(false);
  });

  it("Save adopts the server-normalised document, not the local one", () => {
    let s = edit(createHistory(V1, doc(0)), 1);
    s = markSaved(s, V1, doc(100), false);
    expect(s.present).toEqual(doc(100));
  });

  it("an edit made while Save was in flight survives, and can be undone only back to the saved document", () => {
    let s = createHistory(V1, doc(0));
    s = edit(s, 1);
    s = edit(s, 2); // sent
    s = edit(s, 3); // typed while the PUT was in flight
    s = markSaved(s, V1, doc(2), true);
    expect(s.present).toEqual(doc(3));
    expect(s.past).toEqual([doc(2)]);
    expect(canRedo(s)).toBe(false);
    s = undo(s, V1);
    expect(s.present).toEqual(doc(2));
    // The pre-Save history (doc 0/1) is unreachable.
    expect(canUndo(s)).toBe(false);
  });

  it("an in-flight edit that reverted to the saved document leaves a clean session", () => {
    let s = createHistory(V1, doc(0));
    s = edit(s, 1);
    s = edit(s, 2);
    s = edit(s, 1);
    s = markSaved(s, V1, doc(1), true);
    expect(canUndo(s)).toBe(false);
  });

  it("a failed Save has no engine call — the history is untouched by construction", () => {
    let s = createHistory(V1, doc(0));
    s = edit(s, 1);
    const before = s;
    // (Failure path calls nothing; this documents that nothing else can clear the stacks.)
    expect(s).toBe(before);
    expect(canUndo(s)).toBe(true);
  });
});

// ── Representative documents ───────────────────────────────────────────────

function cfg(): StorefrontPresentationConfig {
  return clonePresentationConfig(DEFAULT_PRESENTATION_CONFIG);
}

const presentationOptions = { equals: presentationConfigsEqual };

describe("document-history — real presentation documents", () => {
  it("round-trips structural section edits (move / hide / duplicate / delete)", () => {
    const base = normalizePresentationConfig(cfg());
    let s = createHistory<StorefrontPresentationConfig>(V1, base);
    const states: StorefrontPresentationConfig[] = [base];
    const apply = (next: StorefrontPresentationConfig | null) => {
      expect(next).not.toBeNull();
      const normalized = normalizePresentationConfig(next as StorefrontPresentationConfig);
      s = recordEdit(s, V1, normalized, { now: 0 }, presentationOptions);
      states.push(normalized);
    };

    const ids = base.homepage.sections.map((section) => section.id);
    apply(moveSection(s.present, ids[1], -1));
    apply(setSectionVisible(s.present, ids[2], false));
    const dup = duplicateSection(s.present, s.present.homepage.sections[0].id, " copy");
    if (dup) apply(dup.config);
    const del = deleteSection(s.present, s.present.homepage.sections[s.present.homepage.sections.length - 1].id);
    if (del) apply(del.config);

    for (let i = states.length - 1; i > 0; i -= 1) {
      expect(presentationConfigsEqual(s.present, states[i])).toBe(true);
      s = undo(s, V1);
    }
    expect(presentationConfigsEqual(s.present, base)).toBe(true);
    expect(canUndo(s)).toBe(false);
    for (let i = 1; i < states.length; i += 1) {
      s = redo(s, V1);
      expect(presentationConfigsEqual(s.present, states[i])).toBe(true);
    }
  });

  it("undo restores global and nested design edits without touching unrelated fields", () => {
    const base = normalizePresentationConfig(cfg());
    const edited = normalizePresentationConfig({
      ...base,
      branding: { ...base.branding, displayName: "متجر الورد" },
    });
    let s = createHistory<StorefrontPresentationConfig>(V1, base);
    s = recordEdit(s, V1, edited, { now: 0 }, presentationOptions);
    const back = undo(s, V1).present;
    expect(back.branding.displayName).toBe(base.branding.displayName);
    expect(presentationConfigsEqual(back, base)).toBe(true);
  });

  it("history snapshots are not corrupted by a later edit to a copy of the present document", () => {
    const base = normalizePresentationConfig(cfg());
    let s = createHistory<StorefrontPresentationConfig>(V1, base);
    const next = normalizePresentationConfig({ ...base, branding: { ...base.branding, displayName: "A" } });
    s = recordEdit(s, V1, next, { now: 0 }, presentationOptions);
    const snapshot = JSON.stringify(s.past[0]);
    const further = clonePresentationConfig(s.present);
    further.branding.displayName = "B";
    s = recordEdit(s, V1, further, { now: 10 }, presentationOptions);
    expect(JSON.stringify(s.past[0])).toBe(snapshot);
  });
});

// ── Property-style: random operation sequences vs a reference model ───────

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("document-history — invariants over random operation sequences", () => {
  it.each([1, 2, 3, 7, 42, 1337, 9001, 20261012])("seed %i", (seed) => {
    const rand = mulberry32(seed);
    const MAX = 8;
    const options = { maxEntries: MAX };
    let s = createHistory<Doc>(V1, doc(0));
    // Reference model: explicit stacks, no grouping (every edit ungrouped).
    let present = 0;
    let past: number[] = [];
    let future: number[] = [];
    let counter = 0;

    for (let step = 0; step < 400; step += 1) {
      const roll = rand();
      if (roll < 0.5) {
        counter += 1;
        s = recordEdit(s, V1, doc(counter), { now: step }, options);
        past.push(present);
        if (past.length > MAX) past.shift();
        present = counter;
        future = [];
      } else if (roll < 0.75) {
        s = undo(s, V1);
        if (past.length > 0) {
          future.unshift(present);
          present = past.pop() as number;
        }
      } else if (roll < 0.95) {
        s = redo(s, V1);
        if (future.length > 0) {
          past.push(present);
          present = future.shift() as number;
        }
      } else {
        // Save boundary.
        s = markSaved(s, V1, doc(present), false, options);
        past = [];
        future = [];
      }

      expect(s.present).toEqual(doc(present));
      expect(s.past).toEqual(past.map(doc));
      expect(s.future).toEqual(future.map(doc));
      expect(s.past.length).toBeLessThanOrEqual(MAX);
      expect(canUndo(s)).toBe(past.length > 0);
      expect(canRedo(s)).toBe(future.length > 0);
    }
  });

  it("undo×k then redo×k is the identity", () => {
    const rand = mulberry32(5);
    let s = createHistory<Doc>(V1, doc(0));
    for (let i = 1; i <= 30; i += 1) s = edit(s, i);
    const target = s.present;
    const k = 1 + Math.floor(rand() * 20);
    for (let i = 0; i < k; i += 1) s = undo(s, V1);
    for (let i = 0; i < k; i += 1) s = redo(s, V1);
    expect(s.present).toEqual(target);
    expect(canRedo(s)).toBe(false);
  });
});
