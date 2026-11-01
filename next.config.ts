import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The made-up comparable-sales report the daily reader check reads (Adam,
  // 1 Nov 2026; lib/documents/reader-check), bundled with the job and with the
  // staff page, whose test runs the same check. Made-up data only.
  outputFileTracingIncludes: {
    "/api/cron/reader-check": ["./samples/cma/long-report.pdf", "./samples/cma/long-report.json"],
    "/dashboard/admin": ["./samples/cma/long-report.pdf", "./samples/cma/long-report.json"],
  },
  async redirects() {
    return [
      {
        // /privacy.html held an older, different privacy policy (Meta's app
        // review links to it, so the URL has to keep working signed out).
        // Brief of 2 Oct 2026: one policy, in one place. 301 rather than
        // Next's default 308 because it is the code every crawler has
        // followed longest.
        source: "/privacy.html",
        destination: "/privacy",
        statusCode: 301,
      },
    ];
  },
  experimental: {
    serverActions: {
      // Property creation can upload up to three evidence documents (agency
      // agreement, contract for sale, comparable-sales report) in the same
      // submission, each up to the 20MB cap enforced in
      // src/lib/storage/evidence.ts (MAX_EVIDENCE_BYTES). Next.js defaults
      // Server Action request bodies to 1MB, which was silently failing
      // property creation ("Error: Body exceeded 1 MB limit...") whenever a
      // real, multi-MB document was attached. Raised well past 3x20MB to
      // leave room for multipart overhead.
      bodySizeLimit: "75mb",
    },
  },
};

export default nextConfig;
