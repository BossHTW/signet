import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pages read SQLite on every request; no component caching for the demo.
  cacheComponents: false,
  agentRules: false,
  serverExternalPackages: ["better-sqlite3"],
  turbopack: { rules: { "*.css": { loaders: ["@tailwindcss/turbopack"], as: "*.css" } } },
};

export default nextConfig;
