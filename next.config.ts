import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
