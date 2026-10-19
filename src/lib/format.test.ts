import { describe, expect, it } from "vitest";
import { compactInr, dateLabel, inr, maskPan, maskPhone, titleCase } from "./format";

describe("money", () => {
  it("formats rupees with Indian grouping and no paise", () => {
    expect(inr(1234567.89)).toBe("₹12,34,568");
    expect(inr("2500")).toBe("₹2,500");
  });

  it("shortens to lakh and crore at their thresholds", () => {
    expect(compactInr(99999)).toBe("₹99,999");
    expect(compactInr(100000)).toBe("₹1.0L");
    expect(compactInr(9999999)).toBe("₹100.0L");
    expect(compactInr(10000000)).toBe("₹1.00Cr");
  });
});

describe("masking", () => {
  it("shows only the first and last two characters of a PAN", () => {
    expect(maskPan("ABCDE1234F")).toBe("ABXXXXXX4F");
    expect(maskPan("AB")).toBe("••••");
  });

  it("masks a mobile number but keeps its country code", () => {
    expect(maskPhone("+919876543210")).toBe("+91 98XXXXXX10");
    expect(maskPhone("+97150123456")).toBe("+971 50XXXXXX56");
    expect(maskPhone("9876543210")).toBe("98XXXXXX10");
    expect(maskPhone("+91123")).toBe("••••");
  });

  it("never leaves the middle digits of a stored number visible", () => {
    for (const phone of ["+919876543210", "+447700900123", "+12025550143"]) {
      const middle = phone.slice(-8, -2);
      expect(maskPhone(phone)).not.toContain(middle);
    }
  });
});

describe("labels", () => {
  it("dates read like 5 Oct 2026", () => {
    expect(dateLabel(new Date(2026, 9, 5))).toBe("5 Oct 2026");
  });

  it("turns enum names into words", () => {
    expect(titleCase("MEETING_HELD")).toBe("Meeting Held");
    expect(titleCase("PASSED")).toBe("Passed");
  });
});
