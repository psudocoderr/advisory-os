import type { Metadata } from "next";
import { Providers } from "@/components/providers";
import "./globals.css";

// The CSP nonce set in src/middleware.ts is new on every request, so no page
// can be prerendered: a page built ahead of time would carry no nonce and its
// scripts would be blocked.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Advisory OS",
  description: "Internal advisory CRM, knowledge portal, and certification system"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
