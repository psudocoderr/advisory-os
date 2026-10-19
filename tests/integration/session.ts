import type { Session } from "next-auth";

/** Who the mocked `getServerSession` returns (setup.ts); set with `signIn()`. */
export const auth = { session: null as Session | null };
