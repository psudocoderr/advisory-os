import { getServerSession, type NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { TOO_MANY_ATTEMPTS } from "@/lib/login-limits";
import { clearLoginFailures, clientIp, loginBlocked, recordLoginFailure, throttleKeys } from "@/lib/login-throttle";
import type { Role } from "@prisma/client";

export const authOptions: NextAuthOptions = {
  session: {
    strategy: "jwt",
    maxAge: 8 * 60 * 60
  },
  pages: {
    signIn: "/login"
  },
  providers: [
    CredentialsProvider({
      name: "Email and password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" }
      },
      async authorize(credentials, req) {
        if (!credentials?.email || !credentials.password) return null;
        const email = credentials.email.toLowerCase().trim();
        const keys = throttleKeys(email, clientIp(req?.headers));
        // Before any lookup or hashing: a throttled request costs nothing.
        if (await loginBlocked(keys)) throw new Error(TOO_MANY_ATTEMPTS);
        const user = await prisma.user.findUnique({ where: { email } });
        const valid = !!user?.isActive && (await bcrypt.compare(credentials.password, user.passwordHash));
        if (!user || !valid) {
          await recordLoginFailure(keys);
          return null;
        }
        await clearLoginFailures(keys);
        return { id: user.id, email: user.email, name: user.name, role: user.role };
      }
    })
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = (user as { role: Role }).role;
        return token;
      }
      // Every server-side session read lands here, so re-reading the account
      // makes deactivation and role changes take effect on the next request
      // instead of when the JWT expires. Throwing is how next-auth v4 drops a
      // session: getServerSession returns null and the cookie is cleared.
      // Returning a partial token would instead yield a session with no id.
      const account = token.id
        ? await prisma.user.findUnique({ where: { id: token.id }, select: { role: true, isActive: true } })
        : null;
      if (!account?.isActive) throw new Error("Session revoked: account inactive or removed");
      token.role = account.role;
      return token;
    },
    async session({ session, token }) {
      session.user.id = token.id as string;
      session.user.role = token.role as Role;
      return session;
    }
  }
};

export async function requireSession() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  return session;
}

export async function requireAdmin() {
  const session = await requireSession();
  if (session.user.role !== "ADMIN") redirect("/dashboard");
  return session;
}

export function scopedUserFilter(session: { user: { id: string; role: Role } }) {
  return session.user.role === "ADMIN" ? {} : { assignedToId: session.user.id };
}

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email: string;
      name: string;
      role: Role;
    };
  }

  interface User {
    role: Role;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: Role;
  }
}
