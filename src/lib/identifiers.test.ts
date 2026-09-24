import { describe, expect, it } from "vitest";
import { z } from "zod";
import { panSchema, parsePhone, phoneShape, splitPhone, toE164 } from "./identifiers";
import { maskPan, maskPhone } from "./format";

describe("panSchema", () => {
  it("accepts a PAN typed in lowercase or with spaces around it", () => {
    expect(panSchema.parse(" abcde1234f ")).toBe("ABCDE1234F");
  });

  it.each(["ABCDE1234", "ABCDE12345", "ABCD11234F", "1BCDE1234F", "ABCDE1234FF"])("rejects %s", (pan) => {
    expect(panSchema.safeParse(pan).success).toBe(false);
  });
});

describe("parsePhone", () => {
  it("stores an Indian mobile in E.164", () => {
    expect(parsePhone("+91", "98765 43210")).toEqual({ ok: true, value: "+919876543210" });
  });

  it.each([
    ["starts with 5", "5876543210"],
    ["has 9 digits", "987654321"],
    ["has 11 digits", "98765432101"],
    ["contains a letter", "98765o3210"]
  ])("rejects an Indian number that %s", (_, number) => {
    expect(parsePhone("+91", number).ok).toBe(false);
  });

  it("accepts an overseas number for an NRI client", () => {
    expect(parsePhone("+44", "7400-123456")).toEqual({ ok: true, value: "+447400123456" });
    expect(parsePhone("+971", "501234567")).toEqual({ ok: true, value: "+971501234567" });
  });

  it("keeps overseas numbers within the 15-digit E.164 limit", () => {
    // +971 uses 3 digits, leaving 12 for the number.
    expect(parsePhone("+971", "123456789012").ok).toBe(true);
    expect(parsePhone("+971", "1234567890123").ok).toBe(false);
    expect(parsePhone("+44", "12345").ok).toBe(false);
  });

  it("rejects a country code outside the list", () => {
    expect(parsePhone("+999", "123456789").ok).toBe(false);
  });
});

describe("toE164", () => {
  const schema = z.object({ name: z.string(), ...phoneShape }).transform(toE164);

  it("replaces the two form fields with one stored number", () => {
    expect(schema.parse({ name: "A", phoneCountry: "+65", phone: "81234567" })).toEqual({
      name: "A",
      phone: "+6581234567"
    });
  });

  it("defaults to India when no country code is sent", () => {
    expect(schema.parse({ name: "A", phone: "9876543210" }).phone).toBe("+919876543210");
  });

  it("reports the problem against the phone field", () => {
    const result = schema.safeParse({ name: "A", phoneCountry: "+91", phone: "12345" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toEqual(["phone"]);
  });
});

describe("splitPhone and maskPhone", () => {
  it("reads the longest matching country code", () => {
    expect(splitPhone("+971501234567")).toEqual({ countryCode: "+971", national: "501234567" });
    expect(splitPhone("+14155550123")).toEqual({ countryCode: "+1", national: "4155550123" });
  });

  it("masks with the country code in front", () => {
    expect(maskPhone("+919876543210")).toBe("+91 98XXXXXX10");
    expect(maskPhone("+447400123456")).toBe("+44 74XXXXXX56");
  });

  it("still masks a number stored before E.164", () => {
    expect(maskPhone("9876543210")).toBe("98XXXXXX10");
  });

  it("masks a PAN to a fixed shape", () => {
    expect(maskPan("ABCDE1234F")).toBe("ABXXXXXX4F");
  });
});
