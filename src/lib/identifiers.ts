import { z } from "zod";

/**
 * PAN and mobile number rules, shared by the server actions, the form fields
 * and the masked display.
 *
 * Mobile numbers are stored in E.164 form ("+919876543210") so NRI/OCI clients
 * abroad fit the same column as clients in India. The database enforces the
 * same shape with CHECK constraints (migration 20260924120000_unique_pan_phone).
 */

/** Country codes offered in the form. India first; the rest cover where NRI/OCI clients usually live. */
export const COUNTRY_CODES = [
  { code: "+91", label: "India" },
  { code: "+1", label: "US / Canada" },
  { code: "+44", label: "UK" },
  { code: "+971", label: "UAE" },
  { code: "+65", label: "Singapore" },
  { code: "+61", label: "Australia" },
  { code: "+64", label: "New Zealand" },
  { code: "+966", label: "Saudi Arabia" },
  { code: "+974", label: "Qatar" },
  { code: "+965", label: "Kuwait" },
  { code: "+968", label: "Oman" },
  { code: "+973", label: "Bahrain" },
  { code: "+60", label: "Malaysia" },
  { code: "+852", label: "Hong Kong" },
  { code: "+49", label: "Germany" }
] as const;

export const DEFAULT_COUNTRY_CODE = "+91";

const PAN_PATTERN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const INDIAN_MOBILE = /^[6-9][0-9]{9}$/;
/** E.164 allows at most 15 digits, country code included. */
const E164_MAX_DIGITS = 15;

export const panSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(PAN_PATTERN, "PAN must be 10 characters, like ABCDE1234F");

export type PhoneResult = { ok: true; value: string } | { ok: false; error: string };

/** Turns a country code and a typed number into E.164, or explains what is wrong with it. */
export function parsePhone(countryCode: string, raw: string): PhoneResult {
  if (!COUNTRY_CODES.some((country) => country.code === countryCode)) {
    return { ok: false, error: "Choose a country code for the mobile number" };
  }
  const digits = raw.replace(/[\s-]/g, "");
  if (!/^[0-9]+$/.test(digits)) {
    return { ok: false, error: "Mobile number can only contain digits" };
  }
  if (countryCode === "+91") {
    return INDIAN_MOBILE.test(digits)
      ? { ok: true, value: `+91${digits}` }
      : { ok: false, error: "Indian mobile numbers are 10 digits starting with 6, 7, 8 or 9" };
  }
  const maxDigits = E164_MAX_DIGITS - (countryCode.length - 1);
  if (digits.length < 6 || digits.length > maxDigits) {
    return { ok: false, error: `Mobile numbers for ${countryCode} are 6 to ${maxDigits} digits` };
  }
  return { ok: true, value: `${countryCode}${digits}` };
}

/** Form fields for a mobile number; pair with `toE164` in the schema's transform. */
export const phoneShape = {
  phoneCountry: z.string().default(DEFAULT_COUNTRY_CODE),
  phone: z.string()
};

/** Schema transform that swaps `phoneCountry` + `phone` for a single E.164 `phone`. */
export function toE164<T extends { phoneCountry: string; phone: string }>(value: T, ctx: z.RefinementCtx) {
  const { phoneCountry, ...rest } = value;
  const result = parsePhone(phoneCountry, value.phone);
  if (!result.ok) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: result.error, path: ["phone"] });
    return z.NEVER;
  }
  return { ...rest, phone: result.value };
}

/** Splits a stored number into its country code and national part, for display. */
export function splitPhone(phone: string): { countryCode: string | null; national: string } {
  if (!phone.startsWith("+")) return { countryCode: null, national: phone.replace(/\D/g, "") };
  // Longest match first, so +971 is not read as +9 followed by 71.
  const country = [...COUNTRY_CODES]
    .sort((a, b) => b.code.length - a.code.length)
    .find(({ code }) => phone.startsWith(code));
  if (!country) return { countryCode: null, national: phone.replace(/\D/g, "") };
  return { countryCode: country.code, national: phone.slice(country.code.length) };
}
