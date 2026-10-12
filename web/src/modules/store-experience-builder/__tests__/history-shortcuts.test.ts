/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import {
  ariaKeyShortcuts,
  isNativeEditingTarget,
  resolveHistoryShortcut,
  shortcutHint,
  type ShortcutKeyEvent,
} from "../history/shortcuts";

function key(partial: Partial<ShortcutKeyEvent> & { key: string }): ShortcutKeyEvent {
  return { code: "", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...partial };
}

describe("resolveHistoryShortcut (CUST-H5-2 §3.1)", () => {
  it("Windows/Linux: Ctrl+Z undo, Ctrl+Y and Ctrl+Shift+Z redo", () => {
    expect(resolveHistoryShortcut(key({ key: "z", ctrlKey: true }), false)).toBe("undo");
    expect(resolveHistoryShortcut(key({ key: "y", ctrlKey: true }), false)).toBe("redo");
    expect(resolveHistoryShortcut(key({ key: "Z", ctrlKey: true, shiftKey: true }), false)).toBe("redo");
  });

  it("macOS: Cmd+Z undo, Cmd+Shift+Z redo; Cmd+Y is not a redo", () => {
    expect(resolveHistoryShortcut(key({ key: "z", metaKey: true }), true)).toBe("undo");
    expect(resolveHistoryShortcut(key({ key: "Z", metaKey: true, shiftKey: true }), true)).toBe("redo");
    expect(resolveHistoryShortcut(key({ key: "y", metaKey: true }), true)).toBeNull();
  });

  it("uses the platform's own modifier only", () => {
    expect(resolveHistoryShortcut(key({ key: "z", metaKey: true }), false)).toBeNull();
    expect(resolveHistoryShortcut(key({ key: "z", ctrlKey: true }), true)).toBeNull();
    expect(resolveHistoryShortcut(key({ key: "z", ctrlKey: true, metaKey: true }), false)).toBeNull();
  });

  it("ignores Alt combinations, a bare key, and Ctrl+Shift+Y", () => {
    expect(resolveHistoryShortcut(key({ key: "z", ctrlKey: true, altKey: true }), false)).toBeNull();
    expect(resolveHistoryShortcut(key({ key: "z" }), false)).toBeNull();
    expect(resolveHistoryShortcut(key({ key: "Y", ctrlKey: true, shiftKey: true }), false)).toBeNull();
    expect(resolveHistoryShortcut(key({ key: "x", ctrlKey: true }), false)).toBeNull();
  });

  it("works on an Arabic layout through the physical key position", () => {
    // Arabic layout: the Z position types «ئ», the Y position «ل» + modifier — `code` still names the physical key.
    expect(resolveHistoryShortcut(key({ key: "ئ", code: "KeyZ", ctrlKey: true }), false)).toBe("undo");
    expect(resolveHistoryShortcut(key({ key: "غ", code: "KeyY", ctrlKey: true }), false)).toBe("redo");
    expect(resolveHistoryShortcut(key({ key: "ئ", code: "KeyZ", metaKey: true, shiftKey: true }), true)).toBe("redo");
  });

  it("a Latin layout that moved Z elsewhere (Dvorak) follows the letter, not the position", () => {
    expect(resolveHistoryShortcut(key({ key: ";", code: "KeyZ", ctrlKey: true }), false)).toBe("undo");
    expect(resolveHistoryShortcut(key({ key: "q", code: "KeyZ", ctrlKey: true }), false)).toBeNull();
  });
});

describe("isNativeEditingTarget", () => {
  const el = (html: string) => {
    document.body.innerHTML = html;
    return document.body.firstElementChild as HTMLElement;
  };

  it("protects text-like inputs, textareas, contenteditable, textbox/combobox roles", () => {
    expect(isNativeEditingTarget(el('<input type="text">'))).toBe(true);
    expect(isNativeEditingTarget(el("<input>"))).toBe(true);
    expect(isNativeEditingTarget(el('<input type="search">'))).toBe(true);
    expect(isNativeEditingTarget(el('<input type="number">'))).toBe(true);
    expect(isNativeEditingTarget(el("<textarea></textarea>"))).toBe(true);
    expect(isNativeEditingTarget(el('<div contenteditable="true"><span id="in">x</span></div>').querySelector("#in"))).toBe(true);
    expect(isNativeEditingTarget(el('<div role="textbox" tabindex="0"></div>'))).toBe(true);
    expect(isNativeEditingTarget(el('<div role="combobox" tabindex="0"></div>'))).toBe(true);
  });

  it("lets the shortcut through from non-text controls and plain content", () => {
    expect(isNativeEditingTarget(el('<input type="checkbox">'))).toBe(false);
    expect(isNativeEditingTarget(el('<input type="range">'))).toBe(false);
    expect(isNativeEditingTarget(el('<input type="radio">'))).toBe(false);
    expect(isNativeEditingTarget(el('<input type="color">'))).toBe(false);
    expect(isNativeEditingTarget(el("<button>x</button>"))).toBe(false);
    expect(isNativeEditingTarget(el("<div>x</div>"))).toBe(false);
    expect(isNativeEditingTarget(null)).toBe(false);
    expect(isNativeEditingTarget(document)).toBe(false);
  });
});

describe("shortcut labels", () => {
  it("shows the platform's own hint and a standards-shaped aria-keyshortcuts", () => {
    expect(shortcutHint("undo", false)).toBe("Ctrl+Z");
    expect(shortcutHint("redo", false)).toBe("Ctrl+Y");
    expect(shortcutHint("undo", true)).toBe("⌘Z");
    expect(shortcutHint("redo", true)).toBe("⇧⌘Z");
    expect(ariaKeyShortcuts("undo", false)).toBe("Control+Z");
    expect(ariaKeyShortcuts("redo", false)).toBe("Control+Y Control+Shift+Z");
    expect(ariaKeyShortcuts("redo", true)).toBe("Meta+Shift+Z");
  });
});
