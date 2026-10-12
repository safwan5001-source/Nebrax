/**
 * @vitest-environment jsdom
 */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useDocumentHistory } from "../history/use-document-history";

afterEach(cleanup);

type Doc = { n: number };
const doc = (n: number): Doc => ({ n });

describe("useDocumentHistory (CUST-H5-1)", () => {
  it("reports canUndo/canRedo and returns the restored document", () => {
    let clock = 0;
    const { result } = renderHook(() => useDocumentHistory<Doc>(doc(0), { now: () => clock }));
    expect(result.current.canUndo).toBe(false);

    act(() => result.current.begin("v1", doc(0)));
    act(() => {
      clock += 5000;
      result.current.record("v1", doc(1));
    });
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(false);

    let restored: Doc | null = null;
    act(() => {
      restored = result.current.undo("v1");
    });
    expect(restored).toEqual(doc(0));
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(true);

    act(() => {
      restored = result.current.redo("v1");
    });
    expect(restored).toEqual(doc(1));
  });

  it("two undos in the same handler see each other's effect (synchronous ref state)", () => {
    const { result } = renderHook(() => useDocumentHistory<Doc>(doc(0), { now: () => 0 }));
    act(() => {
      result.current.begin("v1", doc(0));
      result.current.record("v1", doc(1));
      result.current.record("v1", doc(2));
    });
    let first: Doc | null = null;
    let second: Doc | null = null;
    act(() => {
      first = result.current.undo("v1");
      second = result.current.undo("v1");
    });
    expect(first).toEqual(doc(1));
    expect(second).toEqual(doc(0));
  });

  it("coalesces grouped edits through the injected clock", () => {
    let clock = 0;
    const { result } = renderHook(() => useDocumentHistory<Doc>(doc(0), { now: () => clock }));
    act(() => result.current.begin("v1", doc(0)));
    act(() => {
      result.current.record("v1", doc(1), "text");
      clock += 100;
      result.current.record("v1", doc(2), "text");
    });
    let restored: Doc | null = null;
    act(() => {
      restored = result.current.undo("v1");
    });
    expect(restored).toEqual(doc(0));
    expect(result.current.canUndo).toBe(false);
  });

  it("a callback bound to a previous Version cannot touch the new session", () => {
    const { result } = renderHook(() => useDocumentHistory<Doc>(doc(0), { now: () => 0 }));
    act(() => {
      result.current.begin("v1", doc(0));
      result.current.record("v1", doc(1));
    });
    act(() => result.current.begin("v2", doc(10)));
    expect(result.current.canUndo).toBe(false);
    let late: Doc | null = doc(-1);
    act(() => {
      result.current.record("v1", doc(99)); // late callback from v1
      late = result.current.undo("v1");
    });
    expect(late).toBeNull();
    expect(result.current.canUndo).toBe(false);
  });

  it("markSaved clears the stacks; end() disables the session", () => {
    const { result } = renderHook(() => useDocumentHistory<Doc>(doc(0), { now: () => 0 }));
    act(() => {
      result.current.begin("v1", doc(0));
      result.current.record("v1", doc(1));
    });
    act(() => result.current.markSaved("v1", doc(1), false));
    expect(result.current.canUndo).toBe(false);
    act(() => result.current.record("v1", doc(2)));
    expect(result.current.canUndo).toBe(true);
    act(() => result.current.end());
    expect(result.current.canUndo).toBe(false);
    let none: Doc | null = doc(-1);
    act(() => {
      none = result.current.undo("v1");
    });
    expect(none).toBeNull();
  });
});
