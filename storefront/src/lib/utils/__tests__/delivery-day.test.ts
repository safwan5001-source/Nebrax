import { describe, expect, it } from "vitest";
import {
  dateInTimezone,
  formatDeliveryDay,
  formatDeliveryWindow,
} from "../delivery-day";

const labels = { todayLabel: "اليوم", tomorrowLabel: "غداً" };

describe("delivery-day (FLOWERS-H9b)", () => {
  it("reads the calendar date on the store's wall clock, not UTC", () => {
    // 22:30 UTC on the 7th is already the 8th in Riyadh (UTC+3).
    const now = new Date("2026-10-07T22:30:00Z");
    expect(dateInTimezone(now, "Asia/Riyadh")).toBe("2026-10-08");
    expect(dateInTimezone(now, "UTC")).toBe("2026-10-07");
  });

  it("says today / tomorrow relative to the store timezone", () => {
    const now = new Date("2026-10-07T22:30:00Z"); // 2026-10-08 01:30 in Riyadh
    const base = { timezone: "Asia/Riyadh", locale: "ar", now, ...labels };
    expect(formatDeliveryDay({ ...base, date: "2026-10-08" })).toBe("اليوم");
    expect(formatDeliveryDay({ ...base, date: "2026-10-09" })).toBe("غداً");
  });

  it("formats a further date as a localized weekday and day", () => {
    const text = formatDeliveryDay({
      date: "2026-10-12",
      timezone: "Asia/Riyadh",
      locale: "en",
      now: new Date("2026-10-07T07:00:00Z"),
      todayLabel: "Today",
      tomorrowLabel: "Tomorrow",
    });
    // Word order differs between ICU versions/regions; the parts are the contract.
    expect(text).toMatch(/Monday/);
    expect(text).toMatch(/October/);
    expect(text).toMatch(/\b12\b/);
  });

  it("rolls the month for tomorrow", () => {
    expect(
      formatDeliveryDay({
        date: "2026-11-01",
        timezone: "UTC",
        locale: "en",
        now: new Date("2026-10-31T10:00:00Z"),
        todayLabel: "Today",
        tomorrowLabel: "Tomorrow",
      }),
    ).toBe("Tomorrow");
  });

  it("rejects a malformed date instead of printing garbage", () => {
    expect(
      formatDeliveryDay({
        date: "tomorrow",
        timezone: "UTC",
        locale: "en",
        ...labels,
      }),
    ).toBeNull();
  });

  it("formats a window and rejects malformed clocks", () => {
    expect(formatDeliveryWindow("19:00", "22:00", "en")).toBe(
      "7:00 PM – 10:00 PM",
    );
    expect(formatDeliveryWindow("25:00", "22:00", "en")).toBeNull();
    expect(formatDeliveryWindow("19:00", "x", "en")).toBeNull();
  });
});
