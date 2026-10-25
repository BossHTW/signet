import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return { beforeFiles: [{ source: "/", destination: "/landing.html" }, { source: "/deck", destination: "/deck.html" }, { source: "/memo", destination: "/memo.html" }], afterFiles: [], fallback: [] };
  },
  // Pages read SQLite on every request; no component caching for the demo.
  cacheComponents: false,
  agentRules: false,
  serverExternalPackages: ["better-sqlite3", "@moss-js/moss", "@moss-js/moss-core"],
  turbopack: { rules: { "*.css": { loaders: ["@tailwindcss/turbopack"], as: "*.css" } } },
};

export default nextConfig;
