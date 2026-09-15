import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearPersistedIdempotencyKey,
  readPersistedIdempotencyKey,
  resolveIdempotencyKey,
  writePersistedIdempotencyKey,
} from "../checkout-idempotency";

describe("commerce/checkout-idempotency", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("resolveIdempotencyKey generates and persists a new key for a fresh identity", () => {
    const key = resolveIdempotencyKey("checkout-a");

    expect(typeof key).toBe("string");
    expect(key.length).toBeGreaterThanOrEqual(8);
    expect(readPersistedIdempotencyKey("checkout-a")).toBe(key);
  });

  it("resolveIdempotencyKey returns the same key on a later call for the same identity — reload/remount", () => {
    const first = resolveIdempotencyKey("checkout-a");
    const second = resolveIdempotencyKey("checkout-a");

    expect(second).toBe(first);
  });

  it("resolveIdempotencyKey returns a different key for a different identity — a new checkout never reuses an old key", () => {
    const forA = resolveIdempotencyKey("checkout-a");
    const forB = resolveIdempotencyKey("checkout-b");

    expect(forB).not.toBe(forA);
  });

  it("a null identity never touches storage and always returns a fresh ephemeral key", () => {
    const first = resolveIdempotencyKey(null);
    const second = resolveIdempotencyKey(null);

    expect(first).not.toBe(second);
    expect(localStorage.length).toBe(0);
  });

  it("clearPersistedIdempotencyKey removes only the given identity's entry, leaving others intact", () => {
    const keyA = resolveIdempotencyKey("checkout-a");
    resolveIdempotencyKey("checkout-b");

    clearPersistedIdempotencyKey("checkout-a");

    expect(readPersistedIdempotencyKey("checkout-a")).toBeNull();
    expect(readPersistedIdempotencyKey("checkout-b")).not.toBeNull();

    // After clearing, resolving the same identity again mints a genuinely
    // new key rather than resurrecting the cleared one.
    const regenerated = resolveIdempotencyKey("checkout-a");
    expect(regenerated).not.toBe(keyA);
  });

  it("writePersistedIdempotencyKey followed by readPersistedIdempotencyKey round-trips exactly", () => {
    writePersistedIdempotencyKey("checkout-c", "explicit-key-123");

    expect(readPersistedIdempotencyKey("checkout-c")).toBe("explicit-key-123");
  });

  it("readPersistedIdempotencyKey returns null when nothing was ever written for that identity", () => {
    expect(readPersistedIdempotencyKey("never-seen")).toBeNull();
  });

  describe("storage-unavailable fallback", () => {
    it("readPersistedIdempotencyKey returns null instead of throwing when localStorage.getItem throws", () => {
      const spy = vi
        .spyOn(Storage.prototype, "getItem")
        .mockImplementation(() => {
          throw new Error("storage disabled");
        });

      expect(() => readPersistedIdempotencyKey("checkout-a")).not.toThrow();
      expect(readPersistedIdempotencyKey("checkout-a")).toBeNull();

      spy.mockRestore();
    });

    it("writePersistedIdempotencyKey silently no-ops instead of throwing when localStorage.setItem throws", () => {
      const spy = vi
        .spyOn(Storage.prototype, "setItem")
        .mockImplementation(() => {
          throw new Error("quota exceeded");
        });

      expect(() =>
        writePersistedIdempotencyKey("checkout-a", "some-key"),
      ).not.toThrow();

      spy.mockRestore();
    });

    it("clearPersistedIdempotencyKey silently no-ops instead of throwing when localStorage.removeItem throws", () => {
      const spy = vi
        .spyOn(Storage.prototype, "removeItem")
        .mockImplementation(() => {
          throw new Error("storage disabled");
        });

      expect(() => clearPersistedIdempotencyKey("checkout-a")).not.toThrow();

      spy.mockRestore();
    });

    it("resolveIdempotencyKey still returns a usable key when storage is fully unavailable, just without persistence", () => {
      const getSpy = vi
        .spyOn(Storage.prototype, "getItem")
        .mockImplementation(() => {
          throw new Error("storage disabled");
        });
      const setSpy = vi
        .spyOn(Storage.prototype, "setItem")
        .mockImplementation(() => {
          throw new Error("storage disabled");
        });

      const key = resolveIdempotencyKey("checkout-a");
      expect(typeof key).toBe("string");
      expect(key.length).toBeGreaterThanOrEqual(8);

      getSpy.mockRestore();
      setSpy.mockRestore();
    });
  });
});
