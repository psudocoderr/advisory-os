import type { z } from "zod";

/**
 * What a popup form's server action reports back to FormDialog.
 *
 * `error` keeps the dialog open with the message shown; `ok` changes on every
 * success (it is a timestamp), which is what tells the dialog to close.
 */
export type FormState = { error?: string; ok?: number };

/** The first validation problem, worded for the person filling in the form. */
export function formError(error: z.ZodError): FormState {
  const issue = error.issues[0];
  // Custom and pattern messages (PAN, mobile) are written as full sentences already.
  if (!issue || issue.code === "custom" || issue.code === "invalid_format") return { error: issue?.message };
  const field = String(issue.path[0] ?? "");
  const label = field.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
  const message = sizeMessage(issue);
  return { error: label ? `${label}: ${message}` : message };
}

/** zod 4's length and range defaults read "Too small: expected string to have >=2 characters". */
function sizeMessage(issue: z.core.$ZodIssue): string {
  if (issue.code !== "too_small" && issue.code !== "too_big") return issue.message;
  const small = issue.code === "too_small";
  const limit = small ? issue.minimum : issue.maximum;
  const bound = issue.inclusive ? (small ? "at least" : "at most") : small ? "more than" : "less than";
  if (issue.origin === "string") return `must be ${bound} ${limit} characters`;
  if (issue.origin === "number") return `must be ${bound} ${limit}`;
  return issue.message;
}
