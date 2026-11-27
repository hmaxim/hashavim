import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  output: "standalone",
  // Keep file tracing inside this task folder even if a parent lockfile exists.
  outputFileTracingRoot: path.join(__dirname),
};

export default nextConfig;
