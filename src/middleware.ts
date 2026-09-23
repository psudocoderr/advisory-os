import { NextResponse, type NextRequest } from "next/server";
import { buildContentSecurityPolicy } from "@/lib/csp";

export function middleware(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const csp = buildContentSecurityPolicy(nonce, { dev: process.env.NODE_ENV === "development" });

  // Next.js reads the nonce from the request's CSP header and stamps it on the
  // scripts it renders, so the header has to be on the request as well as the
  // response.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    {
      // Pages only. Static assets and API responses do not run scripts.
      source: "/((?!api|_next/static|_next/image|favicon.ico).*)",
      // Prefetches are not rendered as documents, so they need no nonce.
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" }
      ]
    }
  ]
};
