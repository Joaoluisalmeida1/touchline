import type { NextConfig } from "next";

/**
 * Security headers on every response. The CSP deliberately has no script-src: a script policy in Next needs
 * per-request nonces, and getting it wrong breaks the whole app. These directives block clickjacking (frame-ancestors),
 * <base> hijacking, plugins and forms posting to other origins. HSTS is already added by Vercel on every domain.
 */
const securityHeaders = [
  { key: "Content-Security-Policy", value: "base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'" },
  { key: "X-Frame-Options", value: "DENY" }, // frame-ancestors for older browsers
  { key: "X-Content-Type-Options", value: "nosniff" },
  // cross-origin requests only get the origin, never paths like /join/<invite-code>
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
