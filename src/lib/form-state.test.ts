import { describe, expect, it } from "vitest";
import { z } from "zod";
import { formError } from "./form-state";

const schema = z.object({
  fullName: z.string().min(2).max(5),
  aum: z.coerce.number().positive(),
  score: z.coerce.number().max(4),
  party: z.string().regex(/^x$/, "Choose who the meeting was with")
});
const valid = { fullName: "Ab", aum: "1", score: "1", party: "x" };
const errorFor = (patch: object) => formError(schema.safeParse({ ...valid, ...patch }).error!).error;

describe("formError", () => {
  it("labels the field and rewords length and range limits", () => {
    expect(errorFor({ fullName: "A" })).toBe("Full Name: must be at least 2 characters");
    expect(errorFor({ fullName: "Abcdef" })).toBe("Full Name: must be at most 5 characters");
    expect(errorFor({ aum: "0" })).toBe("Aum: must be more than 0");
    expect(errorFor({ score: "5" })).toBe("Score: must be at most 4");
  });

  it("passes pattern messages through as written", () => {
    expect(errorFor({ party: "y" })).toBe("Choose who the meeting was with");
  });
});
