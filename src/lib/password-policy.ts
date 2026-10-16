/**
 * The one password rule for every account, whichever path sets it: the admin
 * form (createUser) and the recovery script (scripts/bootstrap-admin.ts).
 * They used to differ, 8 characters in the form and 12 in the script, and the
 * weaker rule was the one the web UI applied to new ADMIN accounts (flags S15).
 */
export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 128;

/** Published in this repository (.env.example, git history). Never acceptable. */
export const PUBLISHED_PASSWORDS = ["ChangeMeAdmin123!", "ChangeMeAdvisor123!"];

/** Why this password is not allowed, or null if it is. */
export function passwordProblem(password: string): string | null {
  if (PUBLISHED_PASSWORDS.includes(password)) {
    return "That password is published in this repository. Choose a different one.";
  }
  if (password.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (password.length > MAX_PASSWORD_LENGTH) return `Use at most ${MAX_PASSWORD_LENGTH} characters.`;
  return null;
}
