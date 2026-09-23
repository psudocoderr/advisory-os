/**
 * Content-Security-Policy for every page.
 *
 * Scripts need a per-request nonce: Next.js inlines the scripts that hydrate
 * each page, and the nonce is what lets those run while an injected <script>
 * does not. 'strict-dynamic' extends that trust to the chunks they load.
 *
 * Styles keep 'unsafe-inline'. An injected style cannot run code, and nonces
 * do not cover style attributes, so tightening it would break rendering for
 * little gain.
 *
 * Everything the app loads is its own, so nothing external is allowed.
 */
export function buildContentSecurityPolicy(nonce: string, { dev = false }: { dev?: boolean } = {}): string {
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    // Development needs eval for React's debugging and fast refresh.
    "script-src": ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(dev ? ["'unsafe-eval'"] : [])],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:"],
    "font-src": ["'self'"],
    "connect-src": ["'self'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"]
  };

  const policy = Object.entries(directives).map(([name, values]) => `${name} ${values.join(" ")}`);
  // Local development is plain http; upgrading would break it.
  if (!dev) policy.push("upgrade-insecure-requests");
  return policy.join("; ");
}
