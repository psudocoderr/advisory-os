import { describe, expect, it } from "vitest";
import { startOfTodayIst } from "./follow-ups";

describe("startOfTodayIst", () => {
  it("is the India calendar day, as stored (UTC midnight of that date)", () => {
    // 11:30 IST on 19 October.
    expect(startOfTodayIst(new Date("2026-10-19T06:00:00Z")).toISOString()).toBe("2026-10-19T00:00:00.000Z");
  });

  it("turns over at midnight IST, not midnight UTC", () => {
    // 01:30 IST on 20 October is still 19 October in UTC.
    expect(startOfTodayIst(new Date("2026-10-19T20:00:00Z")).toISOString()).toBe("2026-10-20T00:00:00.000Z");
    // 05:00 IST on 19 October.
    expect(startOfTodayIst(new Date("2026-10-18T23:30:00Z")).toISOString()).toBe("2026-10-19T00:00:00.000Z");
  });
});
