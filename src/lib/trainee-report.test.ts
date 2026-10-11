import { describe, expect, it } from "vitest";
import { csvCell } from "./trainee-report";

describe("csvCell", () => {
  it("neutralises spreadsheet formulas in text", () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
  });
  it("quotes commas, quotes and newlines", () => {
    expect(csvCell("KYC, part 1")).toBe('"KYC, part 1"');
    expect(csvCell("a\nb")).toBe('"a\nb"');
  });
  it("leaves numbers (including negative theta) and empty values alone", () => {
    expect(csvCell(-0.42)).toBe("-0.42");
    expect(csvCell(null)).toBe("");
  });
});
