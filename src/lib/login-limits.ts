/** Failed-login limits, shared by the server throttle and the login form. See login-throttle.ts. */
export const LOGIN_LIMITS = {
  windowMinutes: 15,
  perEmail: 10,
  perIp: 30
} as const;

/** What the login form receives when sign-in is refused for volume. */
export const TOO_MANY_ATTEMPTS = "TooManyAttempts";
