/** @type {import('next').NextConfig} */

const securityHeaders = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "SAMEORIGIN",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

const nextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
      {
        // Never cache API responses (streaming chat, analytics, …).
        source: "/api/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store, max-age=0" },
          ...Object.entries(securityHeaders).map(([key, value]) => ({
            key,
            value,
          })),
        ],
      },
      {
        source: "/(.*)",
        headers: Object.entries(securityHeaders).map(([key, value]) => ({
          key,
          value,
        })),
      },
    ];
  },
};

export default nextConfig;