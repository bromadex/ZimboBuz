import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server build for Docker (Azure and on-premise installs).
  output: "standalone",
  // Logo and website picture uploads go through form actions (up to 1 MB per
  // picture, checked in src/lib/files.ts); the default limit is 1 MB in total.
  experimental: { serverActions: { bodySizeLimit: "2mb" } },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
